import { AlertTriangle, Clock3, FileText, ShoppingCart, Trash2, Truck, Warehouse } from 'lucide-react'
import { useEffect, useState } from 'react'
import { FeatureShell, FeatureState } from '../shared/FeatureShell'
import { Modal } from '../../components/Modal'
import { usePos } from '../../context/PosContext'
import { borradorOperacionService, productRepository } from '../../infrastructure/services'
import type { BorradorOperacionRecord, BorradorOperacionTipo } from '../../application/shared/models'
import type { BorradorContenidoTraslado, BorradorContenidoVenta, BorradorContenidoVentaDirecta } from '../../domain/sales/borradorContenido'
import { revalidarCarrito, type CambioLinea } from '../../domain/sales/borradorRevalidacion'

const tipoLabel: Record<BorradorOperacionTipo, string> = { VENTA: 'Venta', VENTA_DIRECTA: 'Venta directa', TRASLADO: 'Traslado', COTIZACION: 'Cotización' }
const tipoIcon: Record<BorradorOperacionTipo, typeof ShoppingCart> = { VENTA: ShoppingCart, VENTA_DIRECTA: Warehouse, TRASLADO: Truck, COTIZACION: FileText }

const faltante = (expiraEn: string): { texto: string; vencido: boolean } => {
  const ms = new Date(expiraEn).getTime() - Date.now()
  if (ms <= 0) return { texto: 'Vencido', vencido: true }
  const horas = Math.floor(ms / 3600000)
  const minutos = Math.floor((ms % 3600000) / 60000)
  return { texto: horas > 0 ? `Vence en ${horas} h ${minutos} min` : `Vence en ${minutos} min`, vencido: false }
}

/**
 * Brief S1 — bandeja de borradores: guardado explícito y cross-device (borrador_operacion,
 * RLS por usuario), presentada aparte de Suspendidas ("es una acción distinta"). El barrido
 * de verdad lo hace un pg_cron a los 7 días — acá solo se MARCA vencido a las 24 h, nunca
 * se oculta (brief: "no desaparece de golpe").
 */
export function BorradoresPage({ notify, onRetomado }: { notify: (message: string) => void; onRetomado: () => void }) {
  const { loadSuspendedSale, loadTrasladoDraft, loadVtdDraft } = usePos()
  const [borradores, setBorradores] = useState<BorradorOperacionRecord[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [revisando, setRevisando] = useState<{ borrador: BorradorOperacionRecord; cambios: CambioLinea[]; aplicar: () => void } | null>(null)
  const [, setTick] = useState(0)

  const load = () => void borradorOperacionService.list().then(setBorradores)
  useEffect(() => { load() }, [])
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 30000); return () => clearInterval(id) }, [])

  const eliminar = async (borrador: BorradorOperacionRecord) => {
    if (!window.confirm(`¿Eliminar el borrador ${borrador.titulo || tipoLabel[borrador.tipo]}?`)) return
    setBusyId(borrador.id)
    try {
      await borradorOperacionService.remove(borrador.id)
      notify('Borrador eliminado')
      load()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo eliminar el borrador')
    } finally {
      setBusyId(null)
    }
  }

  const retomar = async (borrador: BorradorOperacionRecord) => {
    if (borrador.tipo === 'COTIZACION') { notify('Retomar cotizaciones desde acá no está soportado todavía'); return }
    setBusyId(borrador.id)
    try {
      const contenido = borrador.contenido as BorradorContenidoVenta | BorradorContenidoVentaDirecta | BorradorContenidoTraslado
      // Brief S1: "revalidar productos y precios contra la base y avisar qué cambió" — el
      // canal de precios de VTD/Traslado es siempre retail (VTD es retail-only; el
      // traslado no factura, pero igual conviene detectar productos borrados).
      const channel = contenido.tipo === 'VENTA' ? contenido.channel : 'retail'
      const { cart, cambios } = await revalidarCarrito(contenido.cart, channel, (id) => productRepository.getById(id))
      const aplicar = () => {
        if (contenido.tipo === 'VENTA') loadSuspendedSale({ channel: contenido.channel, cart, discount: contenido.discount, customer: contenido.customer })
        else if (contenido.tipo === 'VENTA_DIRECTA') loadVtdDraft({ cart, vtdUbicacionId: contenido.vtdUbicacionId, vtdPrecobrado: contenido.vtdPrecobrado })
        else loadTrasladoDraft({ cart, trasladoMotivo: contenido.trasladoMotivo, trasladoOrigenId: contenido.trasladoOrigenId, trasladoDestinoId: contenido.trasladoDestinoId })
        setRevisando(null)
        onRetomado()
        notify(`Borrador retomado${cambios.length ? ' — revisá los cambios marcados' : ''}`)
      }
      if (cambios.length) setRevisando({ borrador, cambios, aplicar })
      else aplicar()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo retomar el borrador')
    } finally {
      setBusyId(null)
    }
  }

  if (borradores === null) return <FeatureShell eyebrow="OPERACIONES" title="Borradores" subtitle="Guardados manuales, disponibles desde cualquier sesión"><FeatureState type="skeleton" text="Cargando…" /></FeatureShell>

  return (
    <FeatureShell eyebrow="OPERACIONES" title="Borradores" subtitle="Guardados manuales, disponibles desde cualquier sesión — se marcan vencidos a las 24 h">
      {!borradores.length
        ? <FeatureState type="empty" text="No guardaste ningún borrador todavía" />
        : <div className="borradores-cards">
            {borradores.map((borrador) => {
              const { texto, vencido } = faltante(borrador.expiraEn)
              const Icon = tipoIcon[borrador.tipo]
              return (
                <article className={`borrador-card ${vencido ? 'borrador-card-vencido' : ''}`} key={borrador.id}>
                  <div className="borrador-card-top">
                    <span className="borrador-card-tipo"><Icon size={12} /> {tipoLabel[borrador.tipo]}</span>
                    {vencido ? <span className="borrador-card-vencido-tag"><AlertTriangle size={11} /> Vencido</span> : <span className="borrador-card-expira"><Clock3 size={11} /> {texto}</span>}
                  </div>
                  <strong className="borrador-card-titulo">{borrador.titulo || `${tipoLabel[borrador.tipo]} sin título`}</strong>
                  <small className="borrador-card-fecha">Guardado {new Date(borrador.actualizadoEn).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}</small>
                  <div className="borrador-card-actions">
                    <button className="primary-button" disabled={busyId === borrador.id || borrador.tipo === 'COTIZACION'} onClick={() => void retomar(borrador)}>Retomar</button>
                    <button className="danger-button" disabled={busyId === borrador.id} onClick={() => void eliminar(borrador)}><Trash2 size={12} /></button>
                  </div>
                </article>
              )
            })}
          </div>}
      {revisando && (
        <Modal title="Cambios desde que se guardó" subtitle="El borrador es una foto del momento — revisá antes de continuar" onClose={() => setRevisando(null)}>
          <div className="modal-body">
            <ul className="borrador-cambios-list">
              {revisando.cambios.map((c, i) => (
                <li key={i}>
                  {c.tipo === 'eliminado'
                    ? <span><strong>{c.nombre}</strong> ya no existe en el catálogo — se sacó de la línea.</span>
                    : <span><strong>{c.nombre}</strong>: precio guardado Bs {c.precioAnterior?.toFixed(2)}, precio actual Bs {c.precioActual?.toFixed(2)}.</span>}
                </li>
              ))}
            </ul>
          </div>
          <footer className="modal-actions">
            <button className="secondary-button" onClick={() => setRevisando(null)}>Cancelar</button>
            <button className="primary-button" onClick={revisando.aplicar}>Continuar de todas formas</button>
          </footer>
        </Modal>
      )}
    </FeatureShell>
  )
}
