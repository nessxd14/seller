import { supabase } from './supabaseClient'
import type { MutationContext, SalePortRecord, SaleRepository } from '../../application/ports/repositories'
import { NotFoundError } from '../../application/errors/AppError'
import { centsToNumeric, locationToSucursalId, methodToMetodoPago, numericToCents } from './mappers'
import { getOpenSession } from './CashRepository.supabase'

type EstadoVenta = 'ABIERTA' | 'COMPLETADA' | 'ANULADA'

interface VentaRow {
  id: number
  estado: EstadoVenta
  total: number | string
  subtotal: number | string
}

const num = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v))

const estadoToStatus = (estado: EstadoVenta): SalePortRecord['status'] => {
  switch (estado) {
    case 'ABIERTA': return 'pending_payment'
    case 'COMPLETADA': return 'confirmed'
    case 'ANULADA': return 'cancelled'
  }
}

const rowToSale = (row: VentaRow): SalePortRecord => ({
  id: String(row.id),
  status: estadoToStatus(row.estado),
  totalCents: numericToCents(num(row.total)),
  paidCents: row.estado === 'COMPLETADA' ? numericToCents(num(row.total)) : 0,
  // venta has no version column.
  version: 1,
  updatedAt: new Date().toISOString(),
})

export class SupabaseSaleRepository implements SaleRepository {
  async getById(id: string): Promise<SalePortRecord | null> {
    const numericId = Number(id)
    if (!Number.isFinite(numericId)) return null
    const { data, error } = await supabase.from('venta').select('id, estado, total, subtotal').eq('id', numericId).maybeSingle()
    if (error) throw error
    if (!data) return null
    return rowToSale(data as VentaRow)
  }

  /**
   * The mock backend's two-step confirm() (create pending sale, then confirm) has no
   * equivalent here: registrar_venta (see checkout()) creates and completes a sale in one
   * atomic call. This stub only exists to satisfy the port's shape uniformly with the mock
   * adapter — callers in this brief's scope always use checkout() against Supabase.
   */
  async confirm(): Promise<SalePortRecord> {
    throw new Error('En modo Supabase, usa saleService.checkout() — registrar_venta confirma la venta de forma atómica.')
  }

  async cancel(id: string, _reason: string, context: MutationContext): Promise<SalePortRecord> {
    const actor = context.actorId ?? 'pos'
    const session = await getOpenSession()
    if (!session) throw new Error('No hay una sesión de caja abierta para anular la venta')
    const { error } = await supabase.rpc('anular_venta', { p_venta_id: Number(id), p_usuario: actor, p_sesion_caja_id: Number(session.id) })
    if (error) throw error
    const updated = await this.getById(id)
    if (!updated) throw new NotFoundError('No se pudo releer la venta anulada')
    return updated
  }

  async checkout(
    input: { lines: Array<{ productId: string; quantity: number; unitPriceCents: number; listPriceCents?: number; sourceLocation?: 'Tienda' | 'Almacén' }>; payments: Array<{ method: 'cash' | 'qr' | 'transfer'; amountCents: number }>; cashSessionId: string; customerId?: string; discountCents?: number },
    context: MutationContext
  ) {
    const actor = context.actorId ?? 'pos'
    const lineas = input.lines.map((line) => ({
      producto_id: Number(line.productId),
      cantidad: line.quantity,
      precio_unitario: centsToNumeric(line.unitPriceCents),
      ...(line.listPriceCents != null ? { precio_lista: centsToNumeric(line.listPriceCents) } : {}),
      // Optional: forces this line's stock to be taken from the chosen sucursal — registrar_venta
      // rejects with a clear "Stock insuficiente" error if it doesn't cover the quantity. Absent
      // means the RPC falls back to its automatic Tienda(2)-then-Almacén(1) resolution.
      ...(line.sourceLocation ? { sucursal_origen_id: locationToSucursalId(line.sourceLocation) } : {}),
    }))
    const pagos = input.payments.map((payment) => ({ metodo: methodToMetodoPago(payment.method), monto: centsToNumeric(payment.amountCents) }))
    const { data, error } = await supabase.rpc('registrar_venta', {
      p_lineas: lineas,
      p_pagos: pagos,
      p_sesion_caja_id: Number(input.cashSessionId),
      p_cliente_id: input.customerId ? Number(input.customerId) : null,
      p_descuento_total: centsToNumeric(input.discountCents ?? 0),
      p_usuario: actor,
    })
    if (error) throw error
    const result = data as { venta_id: number; subtotal: number | string; descuento_total: number | string; total: number | string }
    return {
      saleId: String(result.venta_id),
      subtotalCents: numericToCents(num(result.subtotal)),
      discountCents: numericToCents(num(result.descuento_total)),
      totalCents: numericToCents(num(result.total)),
    }
  }
}

export const saleRepository = new SupabaseSaleRepository()
