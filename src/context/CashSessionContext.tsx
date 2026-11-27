import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { featureFlags } from '../config/featureFlags'
import { createRefreshGate } from '../hooks/refreshGate'
import { turnoService, authSessionProvider } from '../infrastructure/services'

interface CashSessionState {
  sessionId: string | null
  /** Caja de la sesión abierta (sesion_caja.caja_id); null sin sesión. Mock: caja 1. */
  cajaId: number | null
  loading: boolean
  refresh: () => Promise<void>
}

const CashSessionContext = createContext<CashSessionState | null>(null)

/**
 * Shared "is there an open cash session" state for the retail Cobrar flow
 * (CartPanel/PaymentModal) and OrdersPage's anticipo action.
 *
 * Mock mode: always reports an open session (a constant placeholder id) —
 * mock retail checkout has never required an open cash session, so this is
 * zero behavior change.
 *
 * Supabase mode: looks up the real open sesion_caja for Caja Tienda on mount,
 * and again whenever refresh() is called (wired from CashPage after
 * open/close succeed) so other consumers see the updated state without a
 * page reload.
 */
export function CashSessionProvider({ children }: { children: ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(featureFlags.supabase ? null : 'mock-session')
  const [cajaId, setCajaId] = useState<number | null>(featureFlags.supabase ? null : 1)
  const [loading, setLoading] = useState<boolean>(featureFlags.supabase)

  // Kept as a promise-chain (not async/await) so every setState call happens inside a
  // .then()/.finally() callback, never synchronously during the effect's call stack —
  // required by the react-hooks/set-state-in-effect lint rule for the mount-time refresh().
  const refresh = useCallback(() => {
    if (!featureFlags.supabase) {
      return Promise.resolve().then(() => { setSessionId('mock-session'); setCajaId(1); setLoading(false) })
    }
    return Promise.all([turnoService.getSesionAbierta(), authSessionProvider.getSession()])
      .then(([open, session]) => {
        // Un cajero cobra dentro de su propio turno; los responsables supervisan.
        if (session?.user.role === 'cajero') {
          const propia = session.user.active && open?.cajeroId === session.user.id ? open : null
          setSessionId(propia?.id ?? null)
          setCajaId(propia?.cajaId ?? null)
          return
        }
        const visible = session?.user.active && open ? open : null
        setSessionId(visible?.id ?? null)
        setCajaId(visible?.cajaId ?? null)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const update = () => { void refresh().catch(() => { setSessionId(null); setCajaId(null) }) }
    // Sondeo lento y solo con la pestaña visible; al volver a verla se actualiza al instante.
    const tick = () => { if (document.visibilityState !== 'hidden') update() }
    // focus + visibilitychange llegan juntos: el gate deja pasar solo uno cada 15 s.
    const gate = createRefreshGate()
    const onFocusOrVisible = () => gate(update)
    update()
    const unsubscribe = authSessionProvider.subscribe?.(update)
    window.addEventListener('focus', onFocusOrVisible)
    document.addEventListener('visibilitychange', onFocusOrVisible)
    const timer = window.setInterval(tick, 120_000)
    return () => { unsubscribe?.(); window.removeEventListener('focus', onFocusOrVisible); document.removeEventListener('visibilitychange', onFocusOrVisible); clearInterval(timer) }
  }, [refresh])

  const value = useMemo(() => ({ sessionId, cajaId, loading, refresh }), [sessionId, cajaId, loading, refresh])
  return <CashSessionContext.Provider value={value}>{children}</CashSessionContext.Provider>
}

export const useCashSession = () => {
  const context = useContext(CashSessionContext)
  if (!context) throw new Error('useCashSession debe usarse dentro de CashSessionProvider')
  return context
}
