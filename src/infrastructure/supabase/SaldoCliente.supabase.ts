import { supabase } from './supabaseClient'
import { toError } from './postgrestError'

export interface SaldoDisponible {
  sinCuenta: boolean
  saldoConfirmado: number
  disponible: number
  enRevision: number
  pedidoPendiente: number
  aplicadoPedido: number
  esAcreedor: boolean
}

export async function consultarSaldoDisponible(clienteId: string, pedidoId?: string): Promise<SaldoDisponible> {
  const { data, error } = await supabase.rpc('consultar_saldo_disponible', { p_cliente_id: Number(clienteId), p_pedido_id: pedidoId ? Number(pedidoId) : null })
  if (error) throw toError(error)
  if (!data || typeof data.sinCuenta !== 'boolean') throw new Error('No se pudo verificar el saldo disponible')
  if (['saldoConfirmado','disponible','enRevision','pedidoPendiente','aplicadoPedido'].some(key => data[key] != null && !Number.isFinite(Number(data[key])))) throw new Error('El saldo recibido no es válido')
  return { sinCuenta: data.sinCuenta, saldoConfirmado: Number(data.saldoConfirmado ?? 0), disponible: Number(data.disponible ?? 0), enRevision: Number(data.enRevision ?? 0), pedidoPendiente: Number(data.pedidoPendiente ?? 0), aplicadoPedido: Number(data.aplicadoPedido ?? 0), esAcreedor: data.esAcreedor === true }
}

export async function aplicarSaldoPedido(input: { pedidoId: string; saldoBs: number; sesionId: string; key: string; dineroNuevoBs?: number; metodo?: string }) {
  const { data, error } = await supabase.rpc('aplicar_saldo_pedido', { p_pedido_id: Number(input.pedidoId), p_monto: input.saldoBs, p_sesion_caja_id: Number(input.sesionId), p_idempotencia: input.key, p_monto_nuevo: input.dineroNuevoBs ?? 0, p_metodo: input.metodo ?? 'EFECTIVO' })
  if (error) throw toError(error)
  if (!data?.usoId) throw new Error('No se pudo verificar la aplicación del saldo')
  avisarSaldoActualizado()
  return data as { usoId: number; saldoAplicado: number; saldoRestante: number; reintento: boolean }
}

export function avisarSaldoActualizado() { window.dispatchEvent(new Event('saldo-cliente-actualizado')) }
