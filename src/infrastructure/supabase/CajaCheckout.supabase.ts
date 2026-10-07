import { supabase } from './supabaseClient'
import { buildVentaLineas } from './SaleRepository.supabase'
import { methodToMetodoPago } from './mappers'
import { bloqueos, construirCobro } from '../../domain/sales/pedidoCaja'
import type { CajaCheckoutInput, CajaReceipt } from '../../application/shared/cajaCheckout'
interface ReceiptRow {
  id: string | number; numero: string; total: number; ventas: (string | number)[]; reintento?: boolean
  vendedor: string | null; cliente: string | null; lineas: CajaReceipt['lineas']; pagos: CajaReceipt['pagos']
  creado_en: string; saldo_favor?: number; descuento?: number; cambio?: number
}
const toReceipt = (data: ReceiptRow): CajaReceipt => ({ id: String(data.id), numero: data.numero, totalCents: Math.round(Number(data.total) * 100), saleIds: data.ventas.map(String), isRetry: data.reintento === true, vendedor: data.vendedor, cliente: data.cliente, lineas: data.lineas, pagos: data.pagos, creadoEn: data.creado_en, balanceCents: Math.round(Number(data.saldo_favor ?? 0)*100), discountCents: Math.round(Number(data.descuento ?? 0)*100), changeCents: Math.round(Number(data.cambio ?? 0)*100) })

export async function comprobantesCaja(sessionId: string): Promise<CajaReceipt[]> {
  const { data, error } = await supabase.from('cobro_caja').select('documento').eq('sesion_id', Number(sessionId)).order('creado_en', { ascending: false }).limit(500)
  if (error) throw Object.assign(new Error(error.message), error)
  return (data ?? []).map(row => toReceipt(row.documento as ReceiptRow))
}
export async function vendedoresCaja(): Promise<{ id: string; nombre: string }[]> {
  const { data, error } = await supabase.rpc('vendedores_caja')
  if (error) throw Object.assign(new Error(error.message), error)
  return data ?? []
}
export async function checkoutCaja(input: CajaCheckoutInput, idempotencyKey: string): Promise<CajaReceipt> {
  if (input.pedido && bloqueos(input.pedido.lineas).length) throw new Error('Verifica o quita todas las líneas del pedido antes de cobrar.')
  const pedido = input.pedido ? construirCobro(input.pedido.lineas) : null
  const { data, error } = await supabase.rpc('checkout_caja', {
    p_lineas: [...buildVentaLineas(input.lines), ...(pedido?.lineas ?? [])],
    p_pedido_ids: input.pedido ? [Number(input.pedido.pedido.pedidoId)] : [],
    p_quitadas: pedido?.quitadas ?? [], p_vtd_ids: input.vtds.map(v => Number(v.ventaId)),
    p_pagos: input.payments.map(p => ({ metodo: methodToMetodoPago(p.method), monto: p.amountCents / 100, ...(p.receivedCents != null ? { recibido: p.receivedCents / 100 } : {}) })),
    p_sesion_id: Number(input.cashSessionId), p_cliente_id: input.customerId ? Number(input.customerId) : null,
    p_descuento: input.discountCents / 100, p_saldo: input.balanceCents / 100,
    p_vendedor_id: input.vendedorId ?? null, p_idempotencia: idempotencyKey,
  })
  if (error) throw Object.assign(new Error(error.message), error)
  if (!data?.id || !data?.numero || !Array.isArray(data.ventas)) throw new Error('No se pudo comprobar el documento de cobro. Reintenta el mismo intento.')
  return toReceipt(data as ReceiptRow)
}
