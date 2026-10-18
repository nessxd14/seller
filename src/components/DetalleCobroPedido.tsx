import { useCallback, useEffect, useRef, useState } from 'react'
import { consultarDetalleCobroPedido } from '../infrastructure/supabase/CobroPedido.supabase'
import type { DetalleCobro } from '../domain/orders/detalleCobro'
import { DetalleCobroContenido } from './DetalleCobroContenido'
import { featureFlags } from '../config/featureFlags'

export function DetalleCobroPedido({ pedidoId }: { pedidoId: string }) {
  const [result, setResult] = useState<{ id: string; data: DetalleCobro | null; error: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const cancelRequests = useCallback(() => { generation.current++ }, [])
  const current = result?.id === pedidoId ? result : null
  const cargar = useCallback(async (cursor: number | null = null) => {
    const request = ++generation.current
    setBusy(true)
    try {
      const data = await consultarDetalleCobroPedido(pedidoId, cursor)
      if (request !== generation.current) return
      setResult(previous => ({ id: pedidoId, error: '', data: cursor != null && previous?.id === pedidoId && previous.data ? { ...data, historial: [...previous.data.historial, ...data.historial.filter(e => !previous.data!.historial.some(old => old.id === e.id))] } : data }))
    } catch (error) {
      if (request === generation.current) setResult(previous => ({ id: pedidoId, data: previous?.id === pedidoId ? previous.data : null, error: error instanceof Error ? error.message : 'No se pudo consultar el detalle' }))
    } finally { if (request === generation.current) setBusy(false) }
  }, [pedidoId])
  useEffect(() => {
    if (!featureFlags.supabase) return
    void cargar()
    const update = () => { if (!document.hidden) void cargar() }
    window.addEventListener('focus', update)
    window.addEventListener('pago-cliente-registrado', update)
    window.addEventListener('saldo-cliente-actualizado', update)
    const timer = window.setInterval(update, 30_000)
    return () => { cancelRequests(); clearInterval(timer); window.removeEventListener('focus', update); window.removeEventListener('pago-cliente-registrado', update); window.removeEventListener('saldo-cliente-actualizado', update) }
  }, [cargar, cancelRequests])
  if (!featureFlags.supabase) return null
  return <section className="cobro-traza" aria-label="Detalle de partidas y responsables de cobros">
    <header><h2>Partidas y responsables de cobros</h2><button type="button" disabled={busy} onClick={() => void cargar()}>Actualizar detalle</button></header>
    {!current ? <p role="status">Consultando partidas e historial…</p> : <>
      {current.error && <p role="alert">{current.error}</p>}
      {current.data && <DetalleCobroContenido data={current.data} cargandoMas={busy} onMas={() => void cargar(current.data!.siguiente)} />}
    </>}
  </section>
}
