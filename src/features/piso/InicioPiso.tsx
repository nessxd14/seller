import { useCallback, useEffect, useState } from 'react'
import type { AuthSession } from '../../application/auth/AuthSessionProvider'
import type { PisoTurno, PisoTurnoUltimo } from '../../application/ports/pisoRepository'
import { horaCorta, proximoCorte, turnoTerminoSolo } from '../../domain/piso/turnoPiso'
import { pisoRepository } from '../../infrastructure/services'
import { BotonSalir } from './SalirPiso'
import { sucursalLabel } from '../transfers/TransfersPage'
import { VentasCajaPiso } from './VentasCajaPiso'

const REFRESCO_MS = 60_000
const hora = horaCorta
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
  onSalir: () => void
  onNoRealizada: () => void
}

export function InicioPiso({ session, textoArmar, version, onArmar, onTraslado, onSalir, onNoRealizada }: Props) {
  // undefined = todavía no se sabe; null = sin turno.
  const [turno, setTurno] = useState<PisoTurno | null | undefined>(undefined)
  const [ultimo, setUltimo] = useState<PisoTurnoUltimo | null>(null)
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [eligiendoSucursal, setEligiendoSucursal] = useState(false)
  const nombreSucursal = session.user.sucursalId != null ? (sucursalLabel[session.user.sucursalId] ?? `Sucursal ${session.user.sucursalId}`) : 'tu sucursal'
  const [pantalla, setPantalla] = useState<'inicio' | 'caja'>('inicio')

  const cargar = useCallback(() => {
    pisoRepository.estadoTurno()
      .then((e) => { setTurno(e.turno); setUltimo(e.turno ? null : e.ultimo); setError('') })
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
      setUltimo(null)
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
      setUltimo(null)
      setPantalla('inicio')
    } catch (e) { setError(mensaje(e, 'No se pudo finalizar el turno.')) } finally { setTrabajando(false) }
  }

  if (turno && pantalla === 'caja') return <><header className="piso-header"><div><h1>Ventas de caja</h1></div></header><VentasCajaPiso onVolver={() => { setPantalla('inicio'); cargar() }} /></>

  return <><header className="piso-header"><div><h1>Inicio</h1><small>{session.user.name}</small></div><BotonSalir onClick={onSalir} /></header><section className="piso-inicio" aria-label="Inicio">
    {error && <p className="piso-error" role="alert">{error}</p>}
    {turno === undefined && !error && <p className="piso-vacio" role="status">Cargando…</p>}

    {turno === null && <>
      {turnoTerminoSolo(ultimo) && <section className="piso-turno-termino" role="status" aria-label="Tu turno terminó">
        <h2>Tu turno terminó a las {hora(ultimo.fin)}</h2>
        <p>{ultimo.cierre === 'CAJA'
          ? `Caja cerró su turno a las ${hora(ultimo.fin)} y con eso se cierran los turnos de piso de ${nombreSucursal}.`
          : 'Los turnos de piso se cierran solos a las 14:00 y a las 21:30, o antes si caja cierra su turno.'}</p>
      </section>}
      <div className="piso-turno-card">
        <h2>Empieza tu turno</h2>
        <p className="piso-hoja-sub">Tu turno también queda como asistencia.</p>
        {turnoTerminoSolo(ultimo) && <p className="piso-hoja-sub">Si sigues atendiendo, inicia otro turno. Se cerrará a las {proximoCorte(new Date()) ?? 'el próximo corte'} o cuando caja cierre.</p>}
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
      <p className="piso-turno-chip"><span className="piso-estado cobrado">En turno</span> <small>desde {hora(turno.inicio)} · cierra {turno.cierraA ? `a las ${hora(turno.cierraA)}` : 'en el próximo corte'} o al cerrar caja</small></p>
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
