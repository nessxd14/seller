import { supabase } from './supabaseClient'
import { cobroNoDisponible, etiquetasCobro, type CobroPedido, type EstadoCobroPedido } from '../../domain/orders/cobroPedido'
import { leerDetalleCobro } from '../../domain/orders/detalleCobro'

const importe = (value: unknown) => {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') throw new Error('Importe ausente')
  const cents = Math.round(Number(value) * 100)
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Importe inválido')
  return cents
}

function leerCobro(value: unknown): CobroPedido {
  if (!value || typeof value !== 'object') throw new Error('Cobro inválido')
  const row = value as Record<string, unknown>
  if (typeof row.estado !== 'string' || !Object.hasOwn(etiquetasCobro, row.estado)) throw new Error('Estado inválido')
  const partidas = Number(row.partidas)
  if (row.partidas == null || !Number.isSafeInteger(partidas) || partidas < 0) throw new Error('Partidas inválidas')
  const result: CobroPedido = {
    estado: row.estado as EstadoCobroPedido, partidas,
    totalCents: importe(row.total), aplicadoCents: importe(row.aplicado),
    enRevisionCents: importe(row.en_revision), pendienteCents: importe(row.pendiente),
    porCobrarCents: importe(row.por_cobrar),
  }
  if (result.estado === 'pagado' && (!partidas || result.totalCents <= 0 || result.pendienteCents || result.enRevisionCents || result.aplicadoCents < result.totalCents)) throw new Error('Pago inconsistente')
  if (row.partidas_saldadas != null) {
    const saldadas = Number(row.partidas_saldadas)
    if (!Number.isSafeInteger(saldadas) || saldadas < 0 || saldadas > partidas) throw new Error('Conteo de saldadas inválido')
    if (result.estado === 'pagado' && saldadas !== partidas) throw new Error('Pedido saldado inconsistente')
    result.partidasSaldadas = saldadas
  }

  return result
}

export async function consultarDetalleCobroPedido(pedidoId: string, antesId: number | null = null) {
  if (!/^\d+$/.test(pedidoId) || !Number.isSafeInteger(Number(pedidoId)) || Number(pedidoId) <= 0) throw new Error('Pedido inválido')
  const { data, error } = await supabase.rpc('consultar_detalle_cobro_pedido', { p_pedido_id: Number(pedidoId), p_antes_id: antesId, p_limite: 50 })
  if (error) {
    if (error.code === 'PGRST202') throw new Error('El detalle de partidas y responsables todavía está pendiente de activar en la base.')
    if (error.code === '42501') throw new Error('Tu sesión no tiene permiso para consultar este historial.')
    throw new Error('No se pudo consultar el detalle de cobros. Reintenta la consulta.')
  }
  return leerDetalleCobro(data)
}



// Una lectura por lote; nunca se deduce el cobro del saldo global del cliente.
export async function consultarCobrosPedidos(pedidoIds: string[]): Promise<Map<string, CobroPedido>> {
  const ids = [...new Set(pedidoIds)]
  const result = new Map(ids.map(id => [id, cobroNoDisponible]))
  const valid = ids.filter(id => /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) > 0)
  for (let offset = 0; offset < valid.length; offset += 200) {
    const batch = valid.slice(offset, offset + 200)
    try {
      const { data, error } = await supabase.rpc('consultar_cobros_pedidos', { p_pedido_ids: batch.map(Number) })
      if (error || !Array.isArray(data)) continue
      for (const row of data) {
        const id = String(row?.pedido_id)
        if (!batch.includes(id)) continue
        try { result.set(id, leerCobro(row)) } catch { /* Un dato inválido nunca se convierte en pagado. */ }
      }
    } catch { /* Una caída conserva el estado no disponible sólo para este lote. */ }
  }
  return result
}
