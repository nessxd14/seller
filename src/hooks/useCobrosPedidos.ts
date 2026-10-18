import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { featureFlags } from '../config/featureFlags'
import { consultarCobrosPedidos } from '../infrastructure/supabase/CobroPedido.supabase'
import { cobroNoDisponible, type CobroPedido } from '../domain/orders/cobroPedido'

export function useCobrosPedidos(pedidoIds: string[]) {
  const key = [...new Set(pedidoIds)].sort().join(',')
  const ids = useMemo(() => key ? key.split(',') : [], [key])
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ key: string; data: Map<string, CobroPedido>; actualizado: Date } | null>(null)
  const generation = useRef(0)
  const refresh = useCallback(() => setRevision(n => n + 1), [])
  useEffect(() => {
    if (!featureFlags.supabase || !ids.length) return
    let active = true
    let inFlight = false
    let pendingRefresh = false
    const update = async () => {
      if (document.hidden || !active) return
      if (inFlight) { pendingRefresh = true; return }
      inFlight = true
      const request = ++generation.current
      try {
        const data = await consultarCobrosPedidos(ids)
        if (active && generation.current === request) setResult({ key, data, actualizado: new Date() })
      } finally {
        inFlight = false
        if (pendingRefresh && active) { pendingRefresh = false; void update() }
      }
    }
    void update()
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    window.addEventListener('saldo-cliente-actualizado', update)
    window.addEventListener('pago-cliente-registrado', update)
    const timer = window.setInterval(update, 30_000)
    return () => {
      active = false
      clearInterval(timer)
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('saldo-cliente-actualizado', update)
      window.removeEventListener('pago-cliente-registrado', update)
    }
  }, [ids, key, revision])
  const current = result?.key === key ? result : null
  const mockCobros = useMemo(() => new Map(ids.map(id => [id, cobroNoDisponible])), [ids])
  return {
    cobros: featureFlags.supabase ? current?.data ?? null : mockCobros,
    actualizado: current?.actualizado ?? null,
    refresh,
    getCobro: (id: string) => !featureFlags.supabase ? cobroNoDisponible : current?.data.get(id) ?? null,
  }
}
