import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { featureFlags } from '../config/featureFlags'
import { turnoService, authSessionProvider } from '../infrastructure/services'

interface CashSessionState {
  sessionId: string | null
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
  const [loading, setLoading] = useState<boolean>(featureFlags.supabase)

  // Kept as a promise-chain (not async/await) so every setState call happens inside a
  // .then()/.finally() callback, never synchronously during the effect's call stack —
  // required by the react-hooks/set-state-in-effect lint rule for the mount-time refresh().
  const refresh = useCallback(() => {
    if (!featureFlags.supabase) {
      return Promise.resolve().then(() => { setSessionId('mock-session'); setLoading(false) })
    }
    return Promise.all([turnoService.getSesionAbierta(), authSessionProvider.getSession()])
      .then(([open, session]) => {
        // Un cajero cobra dentro de su propio turno; los responsables supervisan.
        if (session?.user.role === 'cajero') {
          setSessionId(session.user.active && open?.cajeroId === session.user.id ? open.id : null)
          return
        }
        setSessionId(session?.user.active && open ? open.id : null)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const update = () => { void refresh().catch(() => setSessionId(null)) }
    update()
    const unsubscribe = authSessionProvider.subscribe?.(update)
    window.addEventListener('focus', update)
    const timer = window.setInterval(update, 15_000)
    return () => { unsubscribe?.(); window.removeEventListener('focus', update); clearInterval(timer) }
  }, [refresh])

  const value = useMemo(() => ({ sessionId, loading, refresh }), [sessionId, loading, refresh])
  return <CashSessionContext.Provider value={value}>{children}</CashSessionContext.Provider>
}

export const useCashSession = () => {
  const context = useContext(CashSessionContext)
  if (!context) throw new Error('useCashSession debe usarse dentro de CashSessionProvider')
  return context
}
