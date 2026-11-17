import { ArrowLeft, Plus, QrCode } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AuthSession } from '../../application/auth/AuthSessionProvider'
import type { TrasladoPiso } from '../../application/ports/pisoRepository'
import type { TransferRecord } from '../../application/shared/models'
import {
  ETIQUETA_PILDORA_QR, TONO_PILDORA_QR, detalleTrasladoPiso, pildoraTrasladoPiso, seccionTrasladoPiso, tieneQrAbierto,
} from '../../domain/piso/trasladoQrPiso'
import { TIENDA_ID, nombreSucursalPiso, numeroCorto } from '../../domain/sales/trasladoPiso'
import { mensajeErrorTraslado, puedeSolicitarTraslado } from '../../domain/sales/transfers'
import { pisoRepository, transferService } from '../../infrastructure/services'
import { PedirTrasladoPiso } from './PedirTrasladoPiso'
import { RecibirTrasladoPiso } from './RecibirTrasladoPiso'
import { TrasladoQrHoja, enlaceAlmacen } from './TrasladoQrHoja'
import { TrasladoTicketMovil } from '../../mobile/TrasladoTicketMovil'

const REFRESCO_MS = 60_000
const DIAS_HISTORIAL = 14
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
  const sucursalPerfil = useSucursalPiso(session)
  const [pantalla, setPantalla] = useState<Pantalla>(iniciarPedido ? { tipo: 'pedir' } : { tipo: 'lista' })
  const [traslados, setTraslados] = useState<TrasladoPiso[] | null>(null)
  const [sucursalServidor, setSucursalServidor] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [verQr, setVerQr] = useState<TrasladoPiso | null>(null)
  const [ticket, setTicket] = useState<TransferRecord | null>(null)
  const [abriendo, setAbriendo] = useState(false)
  const sucursal = sucursalServidor ?? sucursalPerfil

  const cargar = useCallback(() => {
    pisoRepository.traslados(DIAS_HISTORIAL)
      .then((r) => { setTraslados(r.traslados); if (r.sucursalId) setSucursalServidor(r.sucursalId); setError('') })
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

  const { retirar, porRecibir, pedidos } = useMemo(() => {
    const lista = traslados ?? []
    return {
      retirar: lista.filter((t) => seccionTrasladoPiso(t) === 'retirar'),
      porRecibir: lista.filter((t) => seccionTrasladoPiso(t) === 'recibir'),
      pedidos: lista.filter((t) => seccionTrasladoPiso(t) === 'pedidos'),
    }
  }, [traslados])

  // Flujo viejo (sin tarea QR, ya despachado): se recibe y cuenta en el celular como siempre.
  const abrirRecepcion = async (t: TrasladoPiso) => {
    if (abriendo) return
    setAbriendo(true)
    try {
      const actual = await transferService.getById(t.id)
      if (!actual) throw new Error('El traslado ya no está disponible')
      if (actual.estado !== 'EN_TRANSITO') { aviso('Ese traslado ya no está por recibir'); cargar(); return }
      setPantalla({ tipo: 'recibir', traslado: actual })
    } catch (e) { aviso(mensajeErrorTraslado(e, 'No se pudo abrir el traslado')) } finally { setAbriendo(false) }
  }

  const imprimirTicket = async (t: TrasladoPiso) => {
    if (abriendo) return
    setAbriendo(true)
    try {
      const completo = await transferService.getById(t.id)
      if (!completo) throw new Error('El traslado ya no está disponible')
      setTicket(completo)
    } catch (e) { aviso(mensajeErrorTraslado(e, 'No se pudo abrir el ticket')) } finally { setAbriendo(false) }
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
        <h2 className="traslado-seccion">Para retirar en almacén <b>{retirar.length}</b></h2>
        {!retirar.length && <p className="piso-vacio">Nada listo para retirar.</p>}
        {retirar.map((t) => <TarjetaTraslado key={t.id} t={t} destacado onVerQr={() => setVerQr(t)} />)}

        {porRecibir.length > 0 && <>
          <h2 className="traslado-seccion">Por recibir <b>{porRecibir.length}</b></h2>
          {porRecibir.map((t) => <article key={t.id} className="traslado-card">
            <div className="traslado-card-fila"><strong>Traslado {numeroCorto(t.numero)} · {productos(t.lineas)}</strong><span className="traslado-pildora ambar">{ETIQUETA_PILDORA_QR.EN_CAMINO}</span></div>
            <small>Salió de {nombreSucursalPiso(t.origenId)}{t.mio ? ' · lo pediste tú' : ''}</small>
            <button type="button" className="piso-enviar" disabled={abriendo} onClick={() => void abrirRecepcion(t)}>Recibir y contar</button>
          </article>)}
        </>}

        <h2 className="traslado-seccion">Mis pedidos</h2>
        {!pedidos.length && <p className="piso-vacio">Sin pedidos en los últimos 14 días.</p>}
        {pedidos.map((t) => <TarjetaTraslado key={t.id} t={t} onVerQr={() => setVerQr(t)} />)}
        <p className="piso-nota-rol">Almacén alista con el QR; tú lo retiras en Almacén escaneando lo que llevas. El stock pasa a Tienda al confirmar.</p>
      </>}
    </section>
    {verQr && <TrasladoQrHoja traslado={verQr} imprimiendo={abriendo} onTicket={() => void imprimirTicket(verQr)} onClose={() => setVerQr(null)} />}
    {ticket && <TrasladoTicketMovil traslado={ticket} onClose={() => setTicket(null)} />}
  </>
}

interface TarjetaProps { t: TrasladoPiso; destacado?: boolean; onVerQr: () => void }

function TarjetaTraslado({ t, destacado = false, onVerQr }: TarjetaProps) {
  const p = pildoraTrasladoPiso(t)
  const enlace = destacado ? enlaceAlmacen(t.id) : null
  return <article className="traslado-card">
    <div className="traslado-card-fila">
      <strong>Traslado {numeroCorto(t.numero)} · {productos(t.lineas)}</strong>
      <span className="traslado-card-acciones">
        <span className={`traslado-pildora ${TONO_PILDORA_QR[p]}`}>{ETIQUETA_PILDORA_QR[p]}</span>
        {!destacado && tieneQrAbierto(t) && <button type="button" className="traslado-qr-icono" aria-label={`Ver QR del traslado ${numeroCorto(t.numero)}`} onClick={onVerQr}><QrCode aria-hidden="true" /></button>}
      </span>
    </div>
    <small>{detalleTrasladoPiso(t)}</small>
    {destacado && <div className="traslado-card-botones">
      <button type="button" className="piso-secundario" onClick={onVerQr}>Ver QR</button>
      {enlace && <a className="piso-enviar traslado-enlace" href={enlace} target="_blank" rel="noreferrer">Retirar en Almacén</a>}
    </div>}
  </article>
}
