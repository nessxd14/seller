import { useEffect } from 'react'
import { supabase } from '../../infrastructure/supabase/supabaseClient'
import { createUuid } from '../../application/shared/createUuid'
import { createRefreshGate } from '../../hooks/refreshGate'

/** Realtime cuando está habilitado; el sondeo mantiene frescura sin depender de él. */
export function useCashRefresh(refresh: () => Promise<void>, key: string) {
  useEffect(() => {
    let running = false
    const update = () => {
      if (running || document.visibilityState === 'hidden') return
      running = true
      void refresh().finally(() => { running = false })
    }
    const gate = createRefreshGate()
    const onFocusOrVisible = () => gate(update)
    update()
    const interval = window.setInterval(update, 60_000)
    window.addEventListener('focus', onFocusOrVisible)
    document.addEventListener('visibilitychange', onFocusOrVisible)
    // La publicación supabase_realtime está vacía hoy: el sondeo es la única fuente de frescura.
    let channel: ReturnType<typeof supabase.channel> | undefined
    // Los adaptadores de pruebas pueden no implementar Realtime.
    if (typeof supabase.channel === 'function') {
      channel = supabase.channel(`cash-${key}-${createUuid()}`)
      for (const table of ['movimiento_caja', 'sesion_caja', 'caja_gasto', 'venta_pago']) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, update)
      }
      channel.subscribe()
    }
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocusOrVisible)
      document.removeEventListener('visibilitychange', onFocusOrVisible)
      if (channel) void supabase.removeChannel(channel)
    }
  }, [refresh, key])
}
