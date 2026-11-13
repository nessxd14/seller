import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ArqueoProgramado, Denominaciones } from '../../../application/shared/models'
import { featureFlags } from '../../../config/featureFlags'
import { useCashSession } from '../../../context/CashSessionContext'
import { authSessionProvider, turnoService } from '../../../infrastructure/services'

export const ARQUEOS_POR_TURNO = 3
const POLL_MS = 60_000
const CUENTA_REGRESIVA_MS = 1_000

export type EstadoArqueoPendiente = 'nada' | 'pendiente' | 'fuera_de_hora'

export interface ArqueoPendiente {
  estado: EstadoArqueoPendiente
  arqueo?: ArqueoProgramado
  restanteMs?: number
  total: typeof ARQUEOS_POR_TURNO
  /** true mientras el hook está activo (cajero con turno propio abierto). */
  activo: boolean
  /** Todos los arqueos del turno (sin dinero para el cajero). */
  arqueos: ArqueoProgramado[]
  /** Hora actual según el servidor (ms). */
  ahoraMs: number
  refrescar: () => Promise<void>
  registrar: (denominaciones: Denominaciones) => Promise<{ numero: number; estado: 'CUMPLIDO' | 'CUMPLIDO_TARDE' }>
}

/** Pura: el arqueo más antiguo que ya tocó y sigue sin hacerse, y si está en hora o tarde. */
export function derivarArqueoPendiente(arqueos: ArqueoProgramado[], ahoraMs: number): { estado: EstadoArqueoPendiente; arqueo?: ArqueoProgramado; restanteMs?: number } {
  const debidos = arqueos
    .filter((a) => a.estado === 'VENCIDO' || (a.estado === 'PROGRAMADO' && Date.parse(a.programadoEn) <= ahoraMs))
    .sort((a, b) => a.numero - b.numero)
  const arqueo = debidos[0]
  if (!arqueo) return { estado: 'nada' }
  const venceMs = Date.parse(arqueo.venceEn)
  if (arqueo.estado === 'VENCIDO' || ahoraMs > venceMs) return { estado: 'fuera_de_hora', arqueo, restanteMs: 0 }
  return { estado: 'pendiente', arqueo, restanteMs: venceMs - ahoraMs }
}

/** Pura: próximo instante (ms, hora del servidor) en que cambia algo: un arqueo que toca o que vence. */
function proximoCambio(arqueos: ArqueoProgramado[], ahoraMs: number): number | null {
  let proximo: number | null = null
  for (const a of arqueos) {
    if (a.estado !== 'PROGRAMADO') continue
    const candidatos = [Date.parse(a.programadoEn), Date.parse(a.venceEn) + 1]
    for (const c of candidatos) if (c > ahoraMs && (proximo === null || c < proximo)) proximo = c
  }
  return proximo
}

/**
 * Arqueos periódicos del cajero. Activo solo con rol cajero y un turno abierto propio
 * (useCashSession().sessionId ya es "mi turno abierto" para el cajero). Nunca recibe ni
 * calcula esperado/diferencia: conteo ciego.
 */
export function useArqueoPendiente(): ArqueoPendiente {
  const { sessionId } = useCashSession()
  const [esCajero, setEsCajero] = useState(false)
  const activo = featureFlags.supabase && esCajero && Boolean(sessionId)

  const [arqueos, setArqueos] = useState<ArqueoProgramado[]>([])
  const [offsetMs, setOffsetMs] = useState(0)
  const [ahoraMs, setAhoraMs] = useState(() => Date.now())
  const offsetRef = useRef(0)
  const vigente = useRef(0)

  useEffect(() => {
    if (!featureFlags.supabase) return
    let cancelado = false
    const leer = () => { void authSessionProvider.getSession().then((s) => { if (!cancelado) setEsCajero(s?.user.role === 'cajero' && s.user.active) }).catch(() => { if (!cancelado) setEsCajero(false) }) }
    leer()
    const baja = authSessionProvider.subscribe?.(leer)
    return () => { cancelado = true; baja?.() }
  }, [])

  const refrescar = useCallback(async () => {
    if (!activo || !sessionId) return
    const ronda = ++vigente.current
    try {
      const r = await turnoService.arqueos(sessionId)
      if (ronda !== vigente.current) return
      const offset = Date.parse(r.ahoraServidor) - Date.now()
      const offsetValido = Number.isFinite(offset) ? offset : 0
      offsetRef.current = offsetValido
      setOffsetMs(offsetValido)
      setAhoraMs(Date.now() + offsetValido)
      setArqueos(r.arqueos)
    } catch { /* informativo: conserva lo último cargado; nunca bloquea la venta */ }
  }, [activo, sessionId])

  // Al desactivarse (cierre de turno, cambio de usuario) no queda nada de la sesión anterior.
  useEffect(() => {
    if (activo) return
    vigente.current++
    void Promise.resolve().then(() => setArqueos([]))
  }, [activo])

  useEffect(() => {
    if (!activo) return
    const actualizar = () => { void refrescar() }
    const tick = () => { if (document.visibilityState !== 'hidden') actualizar() }
    const visibilidad = () => { if (document.visibilityState === 'visible') actualizar() }
    actualizar()
    window.addEventListener('focus', actualizar)
    document.addEventListener('visibilitychange', visibilidad)
    const timer = window.setInterval(tick, POLL_MS)
    return () => { window.removeEventListener('focus', actualizar); document.removeEventListener('visibilitychange', visibilidad); clearInterval(timer) }
  }, [activo, refrescar])

  const derivado = useMemo(() => derivarArqueoPendiente(arqueos, ahoraMs), [arqueos, ahoraMs])

  // Reloj: salta justo al próximo programado_en / vence_en y, con un arqueo en hora, cuenta cada segundo.
  useEffect(() => {
    if (!activo) return
    const ahora = () => Date.now() + offsetRef.current
    const siguiente = proximoCambio(arqueos, ahora())
    const timeout = siguiente === null ? undefined : window.setTimeout(() => setAhoraMs(ahora()), Math.max(0, siguiente - ahora()))
    const intervalo = derivado.estado === 'pendiente' ? window.setInterval(() => setAhoraMs(ahora()), CUENTA_REGRESIVA_MS) : undefined
    return () => { if (timeout !== undefined) clearTimeout(timeout); if (intervalo !== undefined) clearInterval(intervalo) }
  }, [activo, arqueos, derivado.estado, ahoraMs, offsetMs])

  const registrar = useCallback(async (denominaciones: Denominaciones) => {
    if (!sessionId) throw new Error('No hay un turno abierto')
    try {
      return await turnoService.arqueoPeriodico(sessionId, denominaciones)
    } finally {
      await refrescar()
    }
  }, [sessionId, refrescar])

  if (!activo) return { estado: 'nada', total: ARQUEOS_POR_TURNO, activo: false, arqueos: [], ahoraMs, refrescar, registrar }
  return { ...derivado, total: ARQUEOS_POR_TURNO, activo: true, arqueos, ahoraMs, refrescar, registrar }
}
