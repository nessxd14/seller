import { ArrowLeft, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AuthSession } from '../../application/auth/AuthSessionProvider'
import type { TransferRecord } from '../../application/shared/models'
import { Modal } from '../../components/Modal'
import {
  ETIQUETA_PILDORA, TIENDA_ID, cuandoTexto, despachadaEnPresentacion, factorLinea, nombrePresentacion, nombreSucursalPiso, numeroCorto,
  pildoraTraslado, separarTraslados, trasladosDeSucursal, unidadesFaltantes,
} from '../../domain/sales/trasladoPiso'
import { mensajeErrorTraslado, puedeSolicitarTraslado, recibibleTraslado } from '../../domain/sales/transfers'
import { pisoRepository, transferService } from '../../infrastructure/services'
import { PedirTrasladoPiso } from './PedirTrasladoPiso'
import { RecibirTrasladoPiso } from './RecibirTrasladoPiso'
import { TrasladoTicketMovil } from '../../mobile/TrasladoTicketMovil'

const REFRESCO_MS = 60_000
const fmt = (n: number) => n.toLocaleString('es-BO', { maximumFractionDigits: 2 })
const productos = (n: number) => `${n} ${n === 1 ? 'producto' : 'productos'}`

type Pantalla = { tipo: 'lista' } | { tipo: 'recibir'; traslado: TransferRecord } | { tipo: 'pedir' }

interface Props {
  session: AuthSession
  aviso: (mensaje: string) => void
  /** Abre directo la pantalla de pedir (desde Inicio). */
  iniciarPedido?: boolean
  /** Solo el cajero (sin navegación inferior) vuelve a su pantalla con este botón. */
  onVolver?: () => void
}

/** Sucursal del reponedor: perfil, si no el turno abierto, si no Tienda. */
function useSucursalPiso(session: AuthSession): number {
  const [sucursal, setSucursal] = useState<number | null>(session.user.sucursalId ?? null)
  useEffect(() => {
    if (sucursal != null) return
    let cancelado = false
    pisoRepository.turnoActual()
      .then((t) => { if (!cancelado) setSucursal(t?.sucursalId ?? TIENDA_ID) })
      .catch(() => { if (!cancelado) setSucursal(TIENDA_ID) })
    return () => { cancelado = true }
  }, [sucursal])
  return sucursal ?? TIENDA_ID
}

export function TrasladosPiso({ session, aviso, iniciarPedido = false, onVolver }: Props) {
  const sucursal = useSucursalPiso(session)
  const [pantalla, setPantalla] = useState<Pantalla>(iniciarPedido ? { tipo: 'pedir' } : { tipo: 'lista' })
  const [traslados, setTraslados] = useState<TransferRecord[] | null>(null)
  const [error, setError] = useState('')
  const [detalle, setDetalle] = useState<TransferRecord | null>(null)
  const [ticket, setTicket] = useState<TransferRecord | null>(null)
  const [abriendo, setAbriendo] = useState(false)
  // Se fija al leer la lista: el render no llama a Date.now().
  const [ahora, setAhora] = useState(() => Date.now())

  const cargar = useCallback(() => {
    transferService.list()
      .then((lista) => { setTraslados(lista); setAhora(Date.now()); setError('') })
      .catch((e: unknown) => setError(mensajeErrorTraslado(e, 'No se pudieron cargar los traslados.')))
  }, [])

  useEffect(() => {
    const consultar = () => { if (document.visibilityState === 'visible') cargar() }
    consultar()
    const id = window.setInterval(consultar, REFRESCO_MS)
    window.addEventListener('focus', consultar)
    document.addEventListener('visibilitychange', consultar)
    return () => { window.clearInterval(id); window.removeEventListener('focus', consultar); document.removeEventListener('visibilitychange', consultar) }
  }, [cargar])

  const { porRecibir, misPedidos } = useMemo(() => separarTraslados(trasladosDeSucursal(traslados ?? [], sucursal), ahora), [traslados, sucursal, ahora])

  const abrirRecepcion = async (t: TransferRecord) => {
    if (abriendo) return
    setAbriendo(true)
    try {
      const actual = await transferService.getById(t.id)
      if (!actual) throw new Error('El traslado ya no está disponible')
      if (actual.estado !== 'EN_TRANSITO') { aviso('Ese traslado ya no está por recibir'); cargar(); return }
      setPantalla({ tipo: 'recibir', traslado: actual })
    } catch (e) { aviso(mensajeErrorTraslado(e, 'No se pudo abrir el traslado')) } finally { setAbriendo(false) }
  }

  const volverALista = () => { setPantalla({ tipo: 'lista' }); cargar() }

  if (pantalla.tipo === 'recibir') return <RecibirTrasladoPiso traslado={pantalla.traslado} onVolver={volverALista} onRecibido={volverALista} aviso={aviso} />
  if (pantalla.tipo === 'pedir') {
    return <>
      <PedirTrasladoPiso sucursalId={sucursal} onVolver={volverALista} aviso={aviso} onCreado={(t) => { setTicket(t); aviso('Pedido creado'); volverALista() }} />
      {ticket && <TrasladoTicketMovil traslado={ticket} onClose={() => setTicket(null)} />}
    </>
  }

  const puedePedir = puedeSolicitarTraslado(session)
  return <>
    <header className="piso-header">
      {onVolver && <button type="button" className="piso-icono" aria-label="Volver" onClick={onVolver}><ArrowLeft /></button>}
      <div><h1>Traslados</h1><small>{nombreSucursalPiso(sucursal)} · lo que pides y lo que te llega</small></div>
      {puedePedir && <button type="button" className="piso-icono con-texto" onClick={() => setPantalla({ tipo: 'pedir' })}><Plus /> <span>Pedir</span></button>}
    </header>
    <section className="traslado-cuerpo" aria-label="Traslados">
      {error && <p className="piso-error" role="alert">{error}</p>}
      {traslados === null && !error && <p className="piso-vacio" role="status">Cargando…</p>}
      {traslados !== null && <>
        <h2 className="traslado-seccion">Por recibir <b>{porRecibir.length}</b></h2>
        {!porRecibir.length && <p className="piso-vacio">Nada por recibir.</p>}
        {porRecibir.map((t) => {
          const n = t.lines.filter(recibibleTraslado).length || t.lines.length
          return <article key={t.id} className="traslado-card">
            <div className="traslado-card-fila"><strong>Traslado {numeroCorto(t.numero)} · {productos(n)}</strong><span className="traslado-pildora en_camino">{ETIQUETA_PILDORA.EN_CAMINO}</span></div>
            <small>Salió de {nombreSucursalPiso(t.sucursalOrigenId)} {cuandoTexto(t.despachadoEn, ahora)}{t.solicitadoPor === session.user.name ? ' · lo pediste tú' : ''}</small>
            <button type="button" className="piso-enviar" disabled={abriendo} onClick={() => void abrirRecepcion(t)}>Recibir y contar</button>
          </article>
        })}
        <h2 className="traslado-seccion">Mis pedidos</h2>
        {!misPedidos.length && <p className="piso-vacio">Sin pedidos en los últimos 14 días.</p>}
        {misPedidos.map((t) => {
          const p = pildoraTraslado(t)
          return <button key={t.id} type="button" className="traslado-card traslado-card-boton" onClick={() => setDetalle(t)}>
            <span className="traslado-card-fila"><strong>Traslado {numeroCorto(t.numero)} · {productos(t.lines.length)}</strong><span className={`traslado-pildora ${p.toLowerCase()}`}>{ETIQUETA_PILDORA[p]}</span></span>
            <small>{detalleLinea(t, ahora)}</small>
          </button>
        })}
        <p className="piso-nota-rol">Solo ves los traslados de Tienda. Despachar y recuperar faltantes lo hace almacén.</p>
      </>}
    </section>
    {detalle && <DetalleTraslado traslado={detalle} onClose={() => setDetalle(null)} />}
    {ticket && <TrasladoTicketMovil traslado={ticket} onClose={() => setTicket(null)} />}
  </>
}

function detalleLinea(t: TransferRecord, ahora: number): string {
  if (t.estado === 'SOLICITADO') return `Lo pediste ${cuandoTexto(t.solicitadoEn, ahora)}`
  if (t.estado === 'RECIBIDO') {
    const falto = unidadesFaltantes(t)
    return `Recibido ${cuandoTexto(t.recibidoEn, ahora)} · ${falto > 0 ? `faltaron ${fmt(falto)} unidades` : 'llegó completo'}`
  }
  return `Cancelado · pedido ${cuandoTexto(t.solicitadoEn, ahora)}`
}

/** Solo lectura: nada de despachar, revertir, recuperar ni devoluciones. Sin nombres de otras personas. */
function DetalleTraslado({ traslado, onClose }: { traslado: TransferRecord; onClose: () => void }) {
  return <Modal title={`Traslado ${numeroCorto(traslado.numero)}`} subtitle={`${nombreSucursalPiso(traslado.sucursalOrigenId)} → ${nombreSucursalPiso(traslado.sucursalDestinoId)} · ${ETIQUETA_PILDORA[pildoraTraslado(traslado)]}`} onClose={onClose} className="piso-hoja">
    <div className="modal-body piso-hoja-cuerpo">
      <p className="piso-hoja-sub">{traslado.numero}</p>
      <ul className="traslado-detalle">
        {traslado.lines.map((l) => {
          const unidad = nombrePresentacion(l)
          const f = factorLinea(l)
          return <li key={l.id}>
            <strong>{l.name}</strong>
            <span>Pediste {fmt(l.cantidadPresentacion ?? l.cantidadBase)} {unidad}</span>
            <span>Salió {l.cantidadDespachada != null ? `${fmt(despachadaEnPresentacion(l))} ${unidad}` : '—'}</span>
            <span>Llegó {l.cantidadRecibida != null ? `${fmt(l.cantidadRecibida / f)} ${unidad}` : '—'}</span>
          </li>
        })}
      </ul>
    </div>
    <footer className="modal-actions"><button type="button" className="piso-enviar" onClick={onClose}>Cerrar</button></footer>
  </Modal>
}
