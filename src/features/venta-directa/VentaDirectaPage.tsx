import { AlertTriangle, Ban, CheckCircle2, Minus, Printer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { FeatureShell, FeatureState } from '../shared/FeatureShell'
import { Modal } from '../../components/Modal'
import { VtdTicketPreviewModal } from '../../components/VtdTicketPreviewModal'
import { useCashSession } from '../../context/CashSessionContext'
import { ventaDirectaService } from '../../infrastructure/services'
import type { VentaDirectaRecord } from '../../application/shared/models'
import { antiguedadMinutos, esErrorAutorizacion, VTD_ANTIGUEDAD_AVISO_MIN } from '../../domain/sales/vtd'

const money = (cents: number) => (cents / 100).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Brief VTD 2.4/2.5 — bandeja de VTD abiertos, acotada al turno de caja actual ("vida útil
 * = el turno" — un VTD huérfano de turno cerrado ya no lo puede tocar el cajero desde acá,
 * pasa a requerir gerente). Pestaña propia dentro de Ventas (B2), no mezclada con Pedidos.
 */
export function VentaDirectaPage({ notify }: { notify: (message: string) => void }) {
  const { sessionId } = useCashSession()
  const [ventas, setVentas] = useState<VentaDirectaRecord[] | null>(null)
  const [ajustando, setAjustando] = useState<VentaDirectaRecord | null>(null)
  const [ticketing, setTicketing] = useState<VentaDirectaRecord | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [, setTick] = useState(0)

  const load = () => { if (sessionId) void ventaDirectaService.listAbiertas(sessionId).then(setVentas) }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load() cierra sobre sessionId, no necesita re-crearse como dependencia
  useEffect(() => { load() }, [sessionId])
  // Refresca la antigüedad mostrada cada 30s — es solo un aviso visual, no re-fetchea.
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 30000); return () => clearInterval(id) }, [])

  const manejarError = (error: unknown, accion: string) => {
    if (esErrorAutorizacion(error)) {
      notify(error instanceof Error ? error.message : `No autorizado para ${accion}`)
    } else {
      notify(error instanceof Error ? error.message : `No se pudo ${accion}`)
    }
  }

  const completar = async (venta: VentaDirectaRecord) => {
    setBusyId(venta.id)
    try {
      await ventaDirectaService.completar(venta.id)
      notify(`${venta.numero} completada — stock descontado`)
      load()
    } catch (error) {
      manejarError(error, 'completar la venta')
    } finally {
      setBusyId(null)
    }
  }

  const anular = async (venta: VentaDirectaRecord) => {
    if (!window.confirm(`¿Anular ${venta.numero}? Se devuelve todo lo entregado y, si hubo cobro, el dinero.`)) return
    setBusyId(venta.id)
    try {
      await ventaDirectaService.anular(venta.id, venta.sesionCajaId || sessionId || undefined)
      notify(`${venta.numero} anulada`)
      load()
    } catch (error) {
      manejarError(error, 'anular la venta')
    } finally {
      setBusyId(null)
    }
  }

  if (!sessionId) return <FeatureShell eyebrow="ALMACÉN" title="Venta Directa" subtitle="Ventas abiertas de este turno de caja"><FeatureState type="empty" text="Abrí la caja para ver la bandeja de venta directa" /></FeatureShell>
  if (ventas === null) return <FeatureShell eyebrow="ALMACÉN" title="Venta Directa" subtitle="Ventas abiertas de este turno de caja"><FeatureState type="skeleton" text="Cargando…" /></FeatureShell>

  return (
    <FeatureShell eyebrow="ALMACÉN" title="Venta Directa" subtitle="Ventas abiertas de este turno de caja — se cierran solas al cerrar caja">
      {!ventas.length
        ? <FeatureState type="empty" text="No hay ventas directas abiertas en este turno" />
        : <div className="vtd-bandeja-cards">
            {ventas.map((venta) => {
              const antiguedad = antiguedadMinutos(venta.creadoEn)
              const vieja = antiguedad >= VTD_ANTIGUEDAD_AVISO_MIN
              return (
                <article className={`vtd-card ${vieja ? 'vtd-card-vieja' : ''}`} key={venta.id}>
                  <div className="vtd-card-top">
                    <strong>{venta.numero}</strong>
                    <span className={`vtd-modo-tag ${venta.modo === 'PRECOBRADO' ? 'pagado' : 'por-cobrar'}`}>{venta.modo === 'PRECOBRADO' ? 'PAGADO' : 'POR COBRAR'}</span>
                  </div>
                  {vieja && <p className="vtd-card-aviso"><AlertTriangle size={11} /> Abierta hace {antiguedad} min</p>}
                  <ul className="vtd-card-lines">
                    {venta.lines.map((line) => <li key={line.id}>{line.cantidadPresentacion} × {line.name}{line.presentacionNombre ? ` (${line.presentacionNombre})` : ''}</li>)}
                  </ul>
                  <div className="vtd-card-total"><span>Total</span><strong>Bs {money(venta.totalCents)}</strong></div>
                  <div className="vtd-card-actions">
                    <button disabled={busyId === venta.id} onClick={() => setTicketing(venta)}><Printer size={12} /> Ticket</button>
                    <button disabled={busyId === venta.id} onClick={() => setAjustando(venta)}><Minus size={12} /> Ajustar</button>
                    <button className="vtd-card-completar" disabled={busyId === venta.id} onClick={() => void completar(venta)}><CheckCircle2 size={12} /> Completar</button>
                    <button className="danger-button" disabled={busyId === venta.id} onClick={() => void anular(venta)}><Ban size={12} /> Anular</button>
                  </div>
                </article>
              )
            })}
          </div>}
      {ajustando && <AjustarVentaModal venta={ajustando} onClose={() => setAjustando(null)} onDone={() => { setAjustando(null); load() }} notify={notify} />}
      {ticketing && <VtdTicketPreviewModal venta={ticketing} onClose={() => setTicketing(null)} />}
    </FeatureShell>
  )
}

/**
 * Brief 2.5: "solo se reduce" (steppers topan en la cantidad original) y "todo a cero está
 * prohibido — la UI debe detectar ese caso antes de llamar y ofrecer directamente el botón
 * de anular". Una línea individual en cero sí se permite.
 */
function AjustarVentaModal({ venta, onClose, onDone, notify }: { venta: VentaDirectaRecord; onClose: () => void; onDone: () => void; notify: (message: string) => void }) {
  const [cantidades, setCantidades] = useState<Record<string, number>>(() => Object.fromEntries(venta.lines.map((l) => [l.id, l.cantidadPresentacion])))
  const [motivo, setMotivo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const dejaTodoEnCero = Object.values(cantidades).every((v) => v === 0)
  const huboCambio = venta.lines.some((l) => cantidades[l.id] !== l.cantidadPresentacion)
  const motivoFalta = huboCambio && !motivo.trim()
  const confirmar = async () => {
    if (dejaTodoEnCero) { setError('Eso vacía la venta entera — usá "Anular" en la bandeja en vez de ajustar.'); return }
    setSubmitting(true)
    setError('')
    try {
      await ventaDirectaService.ajustar(
        venta.id,
        venta.lines.filter((l) => cantidades[l.id] !== l.cantidadPresentacion).map((l) => ({ lineaId: l.id, cantidadPresentacion: cantidades[l.id] })),
        venta.sesionCajaId,
        motivo.trim(),
      )
      notify(`${venta.numero} ajustada`)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo ajustar la venta')
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <Modal title={`Ajustar ${venta.numero}`} subtitle="Solo se puede reducir — para vender más, crear una venta nueva" onClose={onClose}>
      <div className="modal-body vtd-ajuste-lines">
        {venta.lines.map((line) => {
          const cantidad = cantidades[line.id]
          const rechazada = cantidad === 0
          const cambiada = !rechazada && cantidad !== line.cantidadPresentacion
          return (
            <div className="vtd-ajuste-line" key={line.id}>
              <span>{line.name}{line.presentacionNombre ? ` (${line.presentacionNombre})` : ''}{(rechazada || cambiada) && <span className="order-line-inactive-badge">{rechazada ? 'Rechazado' : 'Cambiado'}</span>}</span>
              <div className="qty-control">
                <button type="button" disabled={cantidad <= 0} onClick={() => setCantidades((c) => ({ ...c, [line.id]: Math.max(0, c[line.id] - 1) }))}><Minus size={11} /></button>
                <strong>{cantidad}</strong>
                <button type="button" disabled={cantidad >= line.cantidadPresentacion} onClick={() => setCantidades((c) => ({ ...c, [line.id]: Math.min(line.cantidadPresentacion, c[line.id] + 1) }))}>+</button>
              </div>
              <small>de {line.cantidadPresentacion}</small>
            </div>
          )
        })}
        <label>Motivo{huboCambio && !dejaTodoEnCero ? ' (obligatorio)' : ''}<textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="¿Por qué se rechaza o cambia esta línea?" /></label>
        {error && <p className="mock-note payment-error">{error} {dejaTodoEnCero && <button type="button" className="vtd-retail-error-link" onClick={onClose}>Ir a anular</button>}</p>}
      </div>
      <footer className="modal-actions">
        <button className="secondary-button" onClick={onClose}>Cancelar</button>
        <button className="primary-button" disabled={submitting || !huboCambio || dejaTodoEnCero || motivoFalta} onClick={() => void confirmar()}>{submitting ? 'Guardando…' : 'Confirmar ajuste'}</button>
      </footer>
    </Modal>
  )
}
