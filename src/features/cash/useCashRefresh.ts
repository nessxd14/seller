import { useEffect } from 'react'
import { supabase } from '../../infrastructure/supabase/supabaseClient'
import { createUuid } from '../../application/shared/createUuid'

/** Realtime cuando está habilitado; el sondeo mantiene frescura sin depender de él. */
export function useCashRefresh(refresh: () => Promise<void>, key: string) {
  useEffect(() => {
    let running = false
    const update = () => {
      if (running || document.visibilityState === 'hidden') return
      running = true
      void refresh().finally(() => { running = false })
    }
    const visibility = () => { if (document.visibilityState === 'visible') update() }
    update()
    const interval = window.setInterval(update, 15_000)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', visibility)
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
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', visibility)
      if (channel) void supabase.removeChannel(channel)
    }
  }, [refresh, key])
}
