import { useCallback, useEffect, useRef, useState } from 'react'
import { consultarSaldoDisponible, type SaldoDisponible } from '../infrastructure/supabase/SaldoCliente.supabase'
import { featureFlags } from '../config/featureFlags'

export function useSaldoCliente(clienteId?: string, pedidoId?: string) {
  const [result, setResult] = useState<{ key: string; saldo: SaldoDisponible | null; error: string } | null>(null)
  const generation = useRef(0)
  const key = `${clienteId ?? ''}:${pedidoId ?? ''}`
  const refresh = useCallback(async () => {
    const request = ++generation.current
    if (!featureFlags.supabase || !clienteId) return
    try {
      const saldo = await consultarSaldoDisponible(clienteId, pedidoId)
      if (generation.current === request) setResult({ key, saldo, error: '' })
    } catch (error) {
      if (generation.current === request) setResult({ key, saldo: null, error: error instanceof Error ? error.message : 'Saldo no disponible' })
    }
  }, [clienteId, pedidoId, key])
  const cancelRequests = useCallback(() => { generation.current++ }, [])
  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => { if (active) void refresh() })
    const update = () => { if (!document.hidden) void refresh() }
    window.addEventListener('focus', update)
    window.addEventListener('saldo-cliente-actualizado', update)
    const timer = window.setInterval(update, 30000)
    return () => { active = false; cancelRequests(); clearInterval(timer); window.removeEventListener('focus', update); window.removeEventListener('saldo-cliente-actualizado', update) }
  }, [refresh, cancelRequests])
  const current = result?.key === key ? result : null
  return { saldo: current?.saldo ?? null, error: current?.error ?? '', loading: !!clienteId && featureFlags.supabase && !current, refresh }
}
