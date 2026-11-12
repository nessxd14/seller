import { useCallback, useEffect, useState } from 'react'
import type { AuthSession } from '../../application/auth/AuthSessionProvider'
import type { PisoTurno } from '../../application/ports/pisoRepository'
import { pisoRepository } from '../../infrastructure/services'
import { sucursalLabel } from '../transfers/TransfersPage'
import { VentasCajaPiso } from './VentasCajaPiso'

const REFRESCO_MS = 60_000
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false })
const mensaje = (e: unknown, porDefecto: string) => (e instanceof Error && e.message ? e.message : porDefecto)
// Sucursales físicas donde se puede atender, en el orden en que se ofrecen.
const SUCURSALES_FISICAS = [2, 1]

interface Props {
  session: AuthSession
  /** "Armar venta" para el reponedor, "Armar pedido" para el vendedor. */
  textoArmar: string
  /** Sube cuando se guarda una venta no realizada, para releer los contadores del turno. */
  version: number
  onArmar: () => void
  onTraslado: () => void
  onNoRealizada: () => void
}

export function InicioPiso({ session, textoArmar, version, onArmar, onTraslado, onNoRealizada }: Props) {
  // undefined = todavía no se sabe; null = sin turno.
  const [turno, setTurno] = useState<PisoTurno | null | undefined>(undefined)
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [eligiendoSucursal, setEligiendoSucursal] = useState(false)
  const [pantalla, setPantalla] = useState<'inicio' | 'caja'>('inicio')

  const cargar = useCallback(() => {
    pisoRepository.turnoActual()
      .then((t) => { setTurno(t); setError('') })
      .catch((e: unknown) => setError(mensaje(e, 'No se pudo leer tu turno.')))
  }, [])

  useEffect(() => {
    const consultar = () => { if (document.visibilityState === 'visible') cargar() }
    consultar()
    const id = window.setInterval(consultar, REFRESCO_MS)
    window.addEventListener('focus', consultar)
    document.addEventListener('visibilitychange', consultar)
    return () => { window.clearInterval(id); window.removeEventListener('focus', consultar); document.removeEventListener('visibilitychange', consultar) }
  }, [cargar, version])

  const iniciar = async (sucursalId?: number) => {
    setTrabajando(true)
    setError('')
    try {
      setTurno(await pisoRepository.iniciarTurno(sucursalId))
      setEligiendoSucursal(false)
    } catch (e) { setError(mensaje(e, 'No se pudo iniciar el turno.')) } finally { setTrabajando(false) }
  }
  const alIniciar = () => {
    if (session.user.sucursalId != null) void iniciar(session.user.sucursalId)
    else setEligiendoSucursal(true)
  }

  const finalizar = async () => {
    if (!window.confirm('¿Finalizar tu turno?')) return
    setTrabajando(true)
    setError('')
    try {
      await pisoRepository.finalizarTurno()
      setTurno(null)
      setPantalla('inicio')
    } catch (e) { setError(mensaje(e, 'No se pudo finalizar el turno.')) } finally { setTrabajando(false) }
  }

  if (turno && pantalla === 'caja') return <><header className="piso-header"><div><h1>Ventas de caja</h1></div></header><VentasCajaPiso onVolver={() => { setPantalla('inicio'); cargar() }} /></>

  return <><header className="piso-header"><div><h1>Inicio</h1><small>{session.user.name}</small></div></header><section className="piso-inicio" aria-label="Inicio">
    {error && <p className="piso-error" role="alert">{error}</p>}
    {turno === undefined && !error && <p className="piso-vacio" role="status">Cargando…</p>}

    {turno === null && <>
      <div className="piso-turno-card">
        <h2>Empieza tu turno</h2>
        <p className="piso-hoja-sub">Tu turno también queda como asistencia.</p>
        {eligiendoSucursal
          ? <div className="piso-campo" role="group" aria-label="¿Dónde atiendes?">¿Dónde atiendes hoy?
            <div className="piso-chips">
              {SUCURSALES_FISICAS.map((id) => <button key={id} type="button" disabled={trabajando} onClick={() => void iniciar(id)}>{sucursalLabel[id] ?? `Sucursal ${id}`}</button>)}
            </div>
          </div>
          : <button type="button" className="piso-enviar" disabled={trabajando} onClick={alIniciar}>Iniciar turno</button>}
      </div>
      <div className="piso-acciones-inicio">
        <button type="button" className="piso-enviar" disabled>Ventas de caja</button>
        <button type="button" className="piso-secundario" disabled>Venta no realizada</button>
        <p className="piso-hoja-sub">Se activan al iniciar el turno.</p>
      </div>
      <p className="piso-nota-rol">{textoArmar}, Traslados y Mis ventas funcionan con o sin turno.</p>
    </>}

    {turno && <>
      <p className="piso-turno-chip"><span className="piso-estado cobrado">En turno</span> <small>desde {hora(turno.inicio)}</small></p>
      <div className="piso-acciones-inicio">
        <button type="button" className="piso-enviar" onClick={() => setPantalla('caja')}>Ventas de caja{turno.porReclamar > 0 && <b className="piso-insignia" aria-label={`${turno.porReclamar} por reclamar`}>{turno.porReclamar}</b>}</button>
        <button type="button" className="piso-secundario" onClick={onNoRealizada}>Venta no realizada</button>
        <div className="piso-acciones-pequenas">
          <button type="button" className="piso-secundario" onClick={onArmar}>{textoArmar}</button>
          <button type="button" className="piso-secundario" onClick={onTraslado}>Pedir traslado</button>
        </div>
      </div>
      <div className="piso-cuenta">
        <span>Mi turno</span>
        <ul className="piso-contadores">
          <li><b>{turno.cobradas}</b> cobradas</li>
          <li><b>{turno.porCobrar}</b> por cobrar</li>
          <li><b>{turno.noRealizadas}</b> no realizadas</li>
        </ul>
        <small>Cobradas incluye las ventas de caja que reclamaste. Los números se cuentan desde que iniciaste el turno.</small>
      </div>
      <button type="button" className="piso-texto-boton" disabled={trabajando} onClick={() => void finalizar()}>Finalizar turno</button>
    </>}
  </section></>
}
