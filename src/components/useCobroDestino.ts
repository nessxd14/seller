import { useEffect, useState } from 'react'
import { hasPermission } from '../application/auth/AuthSessionProvider'
import { featureFlags } from '../config/featureFlags'
import { authSessionProvider, turnoService } from '../infrastructure/services'

/** Dónde quedó el efectivo de un cobro de cliente: en el cajón del turno o en manos de gerencia. */
export type CobroDestino = 'cajon' | 'fuera'

/**
 * Brief Caja D2 — solo gerente/admin (permiso 'admin') decide si el efectivo de un cobro de
 * cliente entró al cajón o lo recibió gerencia directamente (fuera del arqueo). Un cajero nunca
 * ve esta elección: esEncargado queda en false para él y el cobro sigue como siempre.
 */
export function useEsEncargado(): boolean {
  const [esEncargado, setEsEncargado] = useState(false)
  useEffect(() => {
    if (!featureFlags.supabase) return
    let cancelled = false
    try {
      void authSessionProvider.getSession().then((session) => { if (!cancelled) setEsEncargado(hasPermission(session, 'admin')) }).catch(() => undefined)
    } catch { /* sin sesión disponible: se trata como cajero */ }
    return () => { cancelled = true }
  }, [])
  return esEncargado
}

export function useCobroDestino() {
  const esEncargado = useEsEncargado()
  const [destino, setDestino] = useState<CobroDestino | null>(null)
  return { esEncargado, destino, setDestino }
}

/** La elección es obligatoria solo para gerente/admin y solo si el método es Efectivo. */
export const destinoObligatorio = (esEncargado: boolean, method: string | null): boolean => esEncargado && method === 'cash'

export const destinoPendiente = (esEncargado: boolean, method: string | null, destino: CobroDestino | null): boolean =>
  destinoObligatorio(esEncargado, method) && destino === null

/**
 * Después de registrar el cobro (registrar_cobro_hermes), saca el movimiento del arqueo si
 * gerencia lo recibió. Si esta segunda llamada falla, el cobro YA está registrado: se avisa
 * que sigue contando en el cajón y dónde corregirlo, en vez de reportar un cobro fallido.
 */
export async function aplicarDestinoCobro(destino: CobroDestino | null, movementId: string | undefined, notify: (message: string) => void): Promise<void> {
  if (destino !== 'fuera') return
  try {
    if (!movementId) throw new Error('sin movimiento')
    await turnoService.marcarCobroFueraDeArqueo(movementId, true)
  } catch {
    notify('El cobro quedó registrado, pero sigue contado en el cajón. Puedes corregirlo desde la actividad del turno ("Sacar del arqueo").')
  }
}
