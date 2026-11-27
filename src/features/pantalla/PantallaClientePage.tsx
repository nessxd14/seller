import { useCallback, useEffect, useRef, useState } from 'react'
import { cajaDeEstaPantalla } from './transporte'
import { usePantallaReceptor } from './usePantallaReceptor'
import { faseVisible } from './pantallaVista'
import { Cobro, Gracias, Reposo, Venta } from './PantallaVistas'
import './pantalla-cliente.css'

const SALIDA_OCULTA_MS = 3_000
const REINTENTO_CAJA_MS = 5_000

type WakeLockSentinelLike = { release(): Promise<void> }

/** Pantalla fija frente al cliente (rol `pantalla`): sin navegación, menús ni botón de salir. */
export function PantallaClientePage({ onCerrarSesion }: { onCerrarSesion: () => void }) {
  // undefined = leyendo, null = la cuenta no tiene caja asignada.
  const [cajaId, setCajaId] = useState<number | null | undefined>(undefined)
  const [intento, setIntento] = useState(0)
  const [iniciada, setIniciada] = useState(false)
  const [confirmarSalida, setConfirmarSalida] = useState(false)
  const wakeLock = useRef<WakeLockSentinelLike | null>(null)
  const pulsacion = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelado = false
    let reintento: ReturnType<typeof setTimeout> | undefined
    cajaDeEstaPantalla()
      .then((id) => { if (!cancelado) setCajaId(id) })
      // Un fallo de red no es «sin caja asignada»: se reintenta en silencio.
      .catch(() => { if (!cancelado) reintento = setTimeout(() => setIntento((n) => n + 1), REINTENTO_CAJA_MS) })
    return () => { cancelado = true; if (reintento) clearTimeout(reintento) }
  }, [intento])

  const vista = usePantallaReceptor(cajaId ?? null)

  const pedirWakeLock = useCallback(async () => {
    try {
      if (!('wakeLock' in navigator) || wakeLock.current) return
      const sentinel = await navigator.wakeLock.request('screen')
      wakeLock.current = sentinel
      // Android lo suelta al apagar la pantalla o cambiar de pestaña: se vuelve a pedir al volver.
      sentinel.addEventListener('release', () => { if (wakeLock.current === sentinel) wakeLock.current = null })
    } catch { /* sin wake lock la tablet sigue funcionando */ }
  }, [])

  useEffect(() => {
    if (!iniciada) return
    const alVolver = () => { if (document.visibilityState === 'visible') void pedirWakeLock() }
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      document.removeEventListener('visibilitychange', alVolver)
      void wakeLock.current?.release().catch(() => undefined)
      wakeLock.current = null
    }
  }, [iniciada, pedirWakeLock])

  // Pantalla completa y wake lock exigen un gesto del usuario: el primer toque.
  const empezar = () => {
    setIniciada(true)
    void document.documentElement.requestFullscreen?.().catch(() => undefined)
    void pedirWakeLock()
  }

  const empezarPulsacion = () => {
    if (pulsacion.current) clearTimeout(pulsacion.current)
    pulsacion.current = setTimeout(() => { pulsacion.current = null; setConfirmarSalida(true) }, SALIDA_OCULTA_MS)
  }
  const cancelarPulsacion = () => { if (pulsacion.current) { clearTimeout(pulsacion.current); pulsacion.current = null } }
  useEffect(() => cancelarPulsacion, [])

  const fase = faseVisible(vista)
  const estado = vista.estado
  const cabecera = <header className="pc-header">
    <div className="pc-logo" onPointerDown={empezarPulsacion} onPointerUp={cancelarPulsacion} onPointerLeave={cancelarPulsacion} onPointerCancel={cancelarPulsacion} onContextMenu={(e) => e.preventDefault()}>
      <strong>ROARI</strong><span>Librería y papelería</span>
    </div>
    <div className="pc-sede"><span>Casa Matriz</span>{cajaId != null && <b className="pc-caja">Caja {cajaId}</b>}</div>
  </header>

  let cuerpo: React.ReactNode
  if (cajaId === null) cuerpo = <section className="pc-reposo"><p className="pc-sin-caja" role="status">Esta cuenta no tiene una caja asignada</p></section>
  else if (cajaId === undefined) cuerpo = <section className="pc-reposo" aria-busy="true" />
  else if (fase === 'venta' && estado) cuerpo = <Venta estado={estado} correccion={vista.correccion} />
  else if (fase === 'cobro' && estado) cuerpo = <Cobro estado={estado} />
  else if (fase === 'gracias' && estado) cuerpo = <Gracias estado={estado} />
  else cuerpo = <Reposo cajaId={cajaId} />

  return <div className="pc-root" data-fase={cajaId == null ? 'reposo' : fase}>
    {cabecera}
    <main className="pc-cuerpo">{cuerpo}</main>
    {vista.sinConexion && cajaId != null && <p className="pc-sin-conexion" role="status">Sin conexión con caja</p>}
    {!iniciada && <button type="button" className="pc-empezar" onClick={empezar}>Toca para empezar</button>}
    {confirmarSalida && <div className="pc-confirmar" role="alertdialog" aria-modal="true" aria-label="Cerrar sesión de esta pantalla">
      <div className="pc-confirmar-caja">
        <p>¿Cerrar sesión de esta pantalla?</p>
        <div><button type="button" onClick={() => setConfirmarSalida(false)}>Cancelar</button><button type="button" className="pc-confirmar-si" onClick={onCerrarSesion}>Cerrar sesión</button></div>
      </div>
    </div>}
  </div>
}
