import { supabase } from './supabaseClient'
import type { MutationContext, SaleCheckoutLine, SalePortRecord, SaleRepository } from '../../application/ports/repositories'
import { NotFoundError } from '../../application/errors/AppError'
import { centsToNumeric, locationToSucursalId, methodToMetodoPago, numericToCents } from './mappers'
import { getOpenSession } from './CashRepository.supabase'
import type { VentaTicketRecord } from '../../application/shared/models'

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

// Brief Caja-1 B1: el ticket post-venta (VentaTicket.tsx) se arma desde la venta YA
// GUARDADA — numero, líneas y venta_pago reales — nunca desde el carrito. Mismo patrón
// de fetch que VentaDirectaRepository.supabase.ts's fetchVtdById (header + cliente +
// venta_linea + producto + venta_pago), pero con el detalle de pago por método/recibido/
// estado_verificacion que ese repositorio no expone (basta con paidCents ahí).
export async function getTicket(id: string): Promise<VentaTicketRecord | null> {
  const numericId = Number(id)
  if (!Number.isFinite(numericId)) return null
  const { data: header, error: headerError } = await supabase
    .from('venta')
    .select('id, numero, estado, creado_en, creado_por, subtotal, descuento_total, total, cliente_acreedor, saldo_favor_aplicado, cliente(nombre, documento), sesion_caja(caja(nombre))')
    .eq('id', numericId)
    .maybeSingle()
  if (headerError) throw headerError
  if (!header) return null
  const [{ data: lineas, error: lineasError }, { data: pagos, error: pagosError }] = await Promise.all([
    supabase.from('venta_linea').select('id, cantidad, cantidad_presentacion, precio_unitario, es_personalizado, descripcion, unidad_medida, producto(nombre, sku_interno), presentacion(nombre)').eq('venta_id', numericId),
    supabase.from('venta_pago').select('metodo, monto, recibido, estado_verificacion').eq('venta_id', numericId),
  ])
  if (lineasError) throw lineasError
  if (pagosError) throw pagosError

  type HeaderRow = { id: number; numero: string | null; estado: string; creado_en: string; creado_por: string | null; subtotal: number | string; descuento_total: number | string; total: number | string; cliente?: { nombre: string; documento: string } | null; sesion_caja?: { caja?: { nombre: string } | null } | null }
  type LineaRow = { id: number; cantidad: number | string; cantidad_presentacion: number | string | null; precio_unitario: number | string; es_personalizado?: boolean; descripcion?: string | null; unidad_medida?: string | null; producto?: { nombre: string; sku_interno: string | null } | null; presentacion?: { nombre: string } | null }
  type PagoRow = { metodo: string; monto: number | string; recibido: number | string | null; estado_verificacion: string }
  const num = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v))
  const h = header as unknown as HeaderRow & { cliente_acreedor?: boolean; saldo_favor_aplicado?: number | string }

  return {
    ventaId: String(h.id),
    numero: h.numero,
    estado: h.estado,
    creadoEn: h.creado_en,
    cajero: h.creado_por ?? undefined,
    cajaNombre: h.sesion_caja?.caja?.nombre,
    clienteNombre: h.cliente?.nombre,
    clienteNit: h.cliente?.documento,
    clienteAcreedor: h.cliente_acreedor === true,
    saldoFavorAplicadoBs: num(h.saldo_favor_aplicado),
    lineas: ((lineas ?? []) as unknown as LineaRow[]).map((l) => {
      const cantidad = num(l.cantidad_presentacion ?? l.cantidad)
      const precioUnitarioBs = num(l.precio_unitario)
      return {
        id: String(l.id),
        nombre: l.producto?.nombre ?? l.descripcion ?? '',
        sku: l.producto?.sku_interno ?? '',
        cantidad,
        presentacionNombre: l.presentacion?.nombre ?? l.unidad_medida ?? undefined,
        precioUnitarioBs,
        subtotalBs: Math.round(cantidad * precioUnitarioBs * 100) / 100,
      }
    }),
    subtotalBs: num(h.subtotal),
    descuentoBs: num(h.descuento_total),
    totalBs: num(h.total),
    pagos: ((pagos ?? []) as PagoRow[]).map((p) => ({ metodo: p.metodo, montoBs: num(p.monto), recibidoBs: p.recibido != null ? num(p.recibido) : undefined, estadoVerificacion: p.estado_verificacion })),
  }
}

// Líneas de p_lineas de registrar_venta. Un ítem personalizado va sin producto_id (el id
// negativo del carrito nunca debe llegar al RPC, que rechaza cualquier producto_id en una
// línea personalizada), sin presentacion_id ni sucursal_origen_id: no mueve stock.
export const buildVentaLineas = (lines: SaleCheckoutLine[]) => lines.map((line) => {
  if (line.isCustomItem) {
    return {
      es_personalizado: true,
      descripcion: line.description ?? '',
      unidad_medida: line.unitOfMeasure ?? 'UNIDAD',
      cantidad_base: line.quantity,
      precio_unitario: centsToNumeric(line.unitPriceCents),
      ...(line.listPriceCents != null ? { precio_lista: centsToNumeric(line.listPriceCents) } : {}),
    }
  }
  return {
    producto_id: Number(line.productId),
    ...(line.presentacionId != null
      ? { presentacion_id: line.presentacionId, cantidad_presentacion: line.quantity }
      : { cantidad_base: line.quantity }),
    precio_unitario: centsToNumeric(line.unitPriceCents),
    ...(line.listPriceCents != null ? { precio_lista: centsToNumeric(line.listPriceCents) } : {}),
    // Optional: forces this line's stock to be taken from the chosen sucursal — registrar_venta
    // rejects with a clear "Stock insuficiente" error if it doesn't cover the quantity. Absent
    // means the RPC falls back to its automatic Tienda(2)-then-Almacén(1) resolution.
    ...(line.sourceLocation ? { sucursal_origen_id: locationToSucursalId(line.sourceLocation) } : {}),
  }
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
    input: { lines: SaleCheckoutLine[]; payments: Array<{ method: 'cash' | 'qr' | 'transfer'; amountCents: number; receivedCents?: number }>; cashSessionId: string; customerId?: string; discountCents?: number; balanceCents?: number },
    context: MutationContext & { idempotencyKey: string }
  ) {
    const actor = context.actorId ?? 'pos'
    // Mirrors TransferRepository.supabase.ts's buildLineasJsonb exactly: when a non-base
    // presentation is active, registrar_venta expects presentacion_id + cantidad_presentacion
    // (it resolves factor_unidad_base itself and prices per presentation unit); otherwise
    // cantidad_base — line.quantity is already in whichever unit is active (see PaymentModal).
    // Cuando hay una presentación no base, registrar_venta espera presentacion_id +
    // cantidad_presentacion (ver buildVentaLineas); si no, cantidad_base.
    const lineas = buildVentaLineas(input.lines)
    // Brief Caja-1 A2: "recibido" solo entra en el pago si vino en el input — mandar la
    // clave siempre (incluso undefined) confundiría "no se cobró en efectivo" con "no
    // se registró cuánto entregó", así que solo se agrega cuando hay un valor real.
    const pagos = input.payments.map((payment) => ({
      metodo: methodToMetodoPago(payment.method),
      monto: centsToNumeric(payment.amountCents),
      ...(payment.receivedCents != null ? { recibido: centsToNumeric(payment.receivedCents) } : {}),
    }))
    const usingBalance = (input.balanceCents ?? 0) > 0
    const { data, error } = await supabase.rpc(usingBalance ? 'registrar_venta_con_saldo' : 'registrar_venta', {
      p_lineas: lineas,
      p_pagos: pagos,
      p_sesion_caja_id: Number(input.cashSessionId),
      p_cliente_id: input.customerId ? Number(input.customerId) : null,
      p_descuento_total: centsToNumeric(input.discountCents ?? 0),
      p_usuario: actor,
      p_idempotencia: context.idempotencyKey,
      ...(usingBalance ? { p_saldo_favor: centsToNumeric(input.balanceCents!) } : {}),
    })
    if (error) throw error
    const result = data as { venta_id: number; numero?: string; subtotal: number | string; descuento_total: number | string; total: number | string; reintento?: boolean; saldo_favor_aplicado?:number|string; saldo_favor_restante?:number|string }
    return {
      saleId: String(result.venta_id),
      numero: result.numero,
      subtotalCents: numericToCents(num(result.subtotal)),
      discountCents: numericToCents(num(result.descuento_total)),
      totalCents: numericToCents(num(result.total)),
      isRetry: result.reintento === true,
      balanceAppliedCents: numericToCents(num(result.saldo_favor_aplicado)),
      balanceRemainingCents: result.saldo_favor_restante != null ? numericToCents(num(result.saldo_favor_restante)) : undefined,
    }
  }
}

export const saleRepository = new SupabaseSaleRepository()
