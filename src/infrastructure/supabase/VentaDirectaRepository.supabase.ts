import { supabase } from './supabaseClient'
import type { MutationContext, VentaDirectaAbrirLine, VentaDirectaRepository } from '../../application/ports/repositories'
import type { CobrarVtdResultado, VentaDirectaRecord, VtdEstado, VtdLine, VtdPorCobrar } from '../../application/shared/models'
import type { SaleCheckoutPayment } from '../../application/ports/repositories'
import { NotFoundError } from '../../application/errors/AppError'
import { centsToNumeric, methodToMetodoPago, numericToCents, SUCURSAL_ALMACEN_ID } from './mappers'

interface VentaRow {
  id: number
  numero: string | null
  estado: VtdEstado
  ubicacion_id: number
  sesion_caja_id: number | null
  cliente_id: number | null
  subtotal: number | string
  descuento_total: number | string
  total: number | string
  creado_por: string | null
  creado_en: string
  completado_en: string | null
  // Brief Caja VTD — 2026-09-28_caja_cobro_vtd.sql: false solo en VTD históricos sin pago
  // (nunca regularizados). Ausente en filas anteriores a la migración... no debería pasar,
  // pero `?? true` cubre ese caso degradando a "exigible" en vez de ocultar el cobro.
  cobro_exigible?: boolean | null
  cliente?: { nombre: string } | null
}

interface VentaLineaRow {
  id: number
  producto_id: number
  presentacion_id: number | null
  cantidad_presentacion: number | string | null
  cantidad: number | string
  precio_unitario: number | string
  producto?: { nombre: string; sku_interno: string | null } | null
  presentacion?: { nombre: string } | null
}

interface VentaPagoRow { monto: number | string }

const num = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v))

const lineaRowToVtdLine = (row: VentaLineaRow): VtdLine => ({
  id: String(row.id),
  productId: String(row.producto_id),
  name: row.producto?.nombre ?? '',
  sku: row.producto?.sku_interno ?? '',
  presentacionId: row.presentacion_id ?? undefined,
  presentacionNombre: row.presentacion?.nombre,
  cantidadPresentacion: num(row.cantidad_presentacion ?? row.cantidad),
  precioUnitarioCents: numericToCents(num(row.precio_unitario)),
})

const rowToVtd = (header: VentaRow, lines: VentaLineaRow[], pagos: VentaPagoRow[]): VentaDirectaRecord => {
  const paidCents = pagos.reduce((sum, p) => sum + numericToCents(num(p.monto)), 0)
  return {
    id: String(header.id),
    // B1: `numero` siempre viene poblado para filas creadas por abrir_venta (asignado en la
    // misma transacción); una venta de mostrador vieja (registrar_venta, sin numero VTD) no
    // debería pasar por este repositorio, pero se cubre el caso igual sin reventar la UI.
    numero: header.numero ?? `#${header.id}`,
    estado: header.estado,
    modo: paidCents > 0 ? 'PRECOBRADO' : 'POSTCOBRADO',
    ubicacionId: header.ubicacion_id,
    sesionCajaId: header.sesion_caja_id != null ? String(header.sesion_caja_id) : '',
    customerId: header.cliente_id != null ? String(header.cliente_id) : undefined,
    customerName: header.cliente?.nombre,
    subtotalCents: numericToCents(num(header.subtotal)),
    discountCents: numericToCents(num(header.descuento_total)),
    totalCents: numericToCents(num(header.total)),
    paidCents,
    cobroExigible: header.cobro_exigible ?? true,
    creadoPor: header.creado_por ?? undefined,
    creadoEn: header.creado_en,
    completadoEn: header.completado_en ?? undefined,
    lines: lines.map(lineaRowToVtdLine),
  }
}

const LINE_SELECT = '*, producto(nombre,sku_interno), presentacion(nombre)'

const fetchVtdById = async (id: number): Promise<VentaDirectaRecord | null> => {
  const { data: header, error: headerError } = await supabase.from('venta').select('*, cliente(nombre)').eq('id', id).maybeSingle()
  if (headerError) throw headerError
  if (!header) return null
  const [{ data: lines, error: linesError }, { data: pagos, error: pagosError }] = await Promise.all([
    supabase.from('venta_linea').select(LINE_SELECT).eq('venta_id', id),
    supabase.from('venta_pago').select('monto').eq('venta_id', id),
  ])
  if (linesError) throw linesError
  if (pagosError) throw pagosError
  return rowToVtd(header as VentaRow, (lines ?? []) as VentaLineaRow[], (pagos ?? []) as VentaPagoRow[])
}

const buildLineasJsonb = (lines: VentaDirectaAbrirLine[]) =>
  lines.map((line) => ({
    producto_id: Number(line.productId),
    ...(line.presentacionId != null
      ? { presentacion_id: line.presentacionId, cantidad_presentacion: line.cantidadPresentacion }
      : { cantidad_base: line.cantidadPresentacion }),
    precio_unitario: centsToNumeric(line.unitPriceCents),
    ...(line.listPriceCents != null ? { precio_lista: centsToNumeric(line.listPriceCents) } : {}),
  }))

export class SupabaseVentaDirectaRepository implements VentaDirectaRepository {
  async listAbiertas(sesionCajaId: string): Promise<VentaDirectaRecord[]> {
    const numericId = Number(sesionCajaId)
    if (!Number.isFinite(numericId)) return []
    const { data: headers, error } = await supabase.from('venta').select('*, cliente(nombre)').eq('sesion_caja_id', numericId).eq('estado', 'ABIERTA').not('numero', 'is', null).order('creado_en', { ascending: true })
    if (error) throw error
    const rows = (headers ?? []) as VentaRow[]
    const ids = rows.map((r) => r.id)
    if (!ids.length) return []
    const [{ data: allLines, error: linesError }, { data: allPagos, error: pagosError }] = await Promise.all([
      supabase.from('venta_linea').select(LINE_SELECT).in('venta_id', ids),
      supabase.from('venta_pago').select('venta_id, monto').in('venta_id', ids),
    ])
    if (linesError) throw linesError
    if (pagosError) throw pagosError
    return rows.map((header) =>
      rowToVtd(
        header,
        (allLines ?? []).filter((l) => (l as VentaLineaRow & { venta_id: number }).venta_id === header.id) as VentaLineaRow[],
        (allPagos ?? []).filter((p) => (p as VentaPagoRow & { venta_id: number }).venta_id === header.id) as VentaPagoRow[],
      ),
    )
  }

  async getById(id: string): Promise<VentaDirectaRecord | null> {
    const numericId = Number(id)
    if (!Number.isFinite(numericId)) return null
    return fetchVtdById(numericId)
  }

  async abrir(
    input: { lines: VentaDirectaAbrirLine[]; ubicacionId: number; cashSessionId: string; payments?: SaleCheckoutPayment[]; customerId?: string; discountCents?: number },
    context: MutationContext & { idempotencyKey: string },
  ): Promise<VentaDirectaRecord & { isRetry?: boolean }> {
    const actor = context.actorId ?? 'pos'
    const pagos = input.payments?.length ? input.payments.map((p) => ({ metodo: methodToMetodoPago(p.method), monto: centsToNumeric(p.amountCents) })) : null
    const { data, error } = await supabase.rpc('abrir_venta', {
      p_lineas: buildLineasJsonb(input.lines),
      p_ubicacion_id: input.ubicacionId,
      p_sesion_caja_id: Number(input.cashSessionId),
      p_pagos: pagos,
      p_cliente_id: input.customerId ? Number(input.customerId) : null,
      p_descuento_total: centsToNumeric(input.discountCents ?? 0),
      p_usuario: actor,
      p_idempotencia: context.idempotencyKey,
    })
    if (error) throw error
    const result = data as { venta_id: number; reintento?: boolean }
    const created = await fetchVtdById(result.venta_id)
    if (!created) throw new NotFoundError('No se pudo releer la venta directa recién abierta')
    return { ...created, isRetry: result.reintento === true }
  }

  async completar(id: string, context: MutationContext): Promise<VentaDirectaRecord> {
    const actor = context.actorId ?? 'pos'
    const numericId = Number(id)
    const { error } = await supabase.rpc('completar_venta', { p_venta_id: numericId, p_usuario: actor })
    if (error) throw error
    const updated = await fetchVtdById(numericId)
    if (!updated) throw new NotFoundError('No se pudo releer la venta directa completada')
    return updated
  }

  async ajustar(id: string, ajustes: Array<{ lineaId: string; cantidadPresentacion: number }>, cashSessionId: string | undefined, motivo: string, context: MutationContext): Promise<VentaDirectaRecord> {
    const actor = context.actorId ?? 'pos'
    const numericId = Number(id)
    const { error } = await supabase.rpc('ajustar_venta_abierta', {
      p_venta_id: numericId,
      p_ajustes: ajustes.map((a) => ({ linea_id: Number(a.lineaId), cantidad_presentacion: a.cantidadPresentacion })),
      p_sesion_caja_id: cashSessionId ? Number(cashSessionId) : null,
      p_usuario: actor,
      p_motivo: motivo,
    })
    if (error) throw error
    const updated = await fetchVtdById(numericId)
    if (!updated) throw new NotFoundError('No se pudo releer la venta directa ajustada')
    return updated
  }

  async anular(id: string, cashSessionId: string | undefined, context: MutationContext): Promise<VentaDirectaRecord> {
    const actor = context.actorId ?? 'pos'
    const numericId = Number(id)
    const { error } = await supabase.rpc('anular_venta', { p_venta_id: numericId, p_usuario: actor, p_sesion_caja_id: cashSessionId ? Number(cashSessionId) : null })
    if (error) throw error
    const updated = await fetchVtdById(numericId)
    if (!updated) throw new NotFoundError('No se pudo releer la venta directa anulada')
    return updated
  }

  // Brief Caja VTD — bandeja "Agregar VTD" del carrito: VTD exigibles, no anulados, sin
  // pago. security_invoker: la vista ya filtra por lo que el cajero puede ver.
  async listPorCobrar(): Promise<VtdPorCobrar[]> {
    const { data, error } = await supabase.from('v_vtd_por_cobrar').select('*')
    if (error) throw error
    type Row = {
      venta_id: number; numero: string | null; estado: 'ABIERTA' | 'COMPLETADA'; cliente_id: number | null
      cliente_nombre: string | null; total: number | string; creado_por: string | null; creado_en: string
      sesion_creacion_id: number | null
    }
    return ((data ?? []) as Row[]).map((r) => ({
      ventaId: String(r.venta_id),
      numero: r.numero,
      estado: r.estado,
      clienteId: r.cliente_id != null ? String(r.cliente_id) : undefined,
      clienteNombre: r.cliente_nombre ?? undefined,
      totalBs: num(r.total),
      creadoPor: r.creado_por ?? undefined,
      creadoEn: r.creado_en,
      sesionCreacionId: r.sesion_creacion_id != null ? String(r.sesion_creacion_id) : undefined,
    }))
  }

  // Brief Caja VTD — cobrar_vtd: cobro de uno o más VTD postcobrados en un solo recibo.
  // No toca Kardex (eso sigue siendo completar_venta, desde la bandeja de Venta Directa).
  async cobrarVtd(input: { ventaIds: string[]; sesionCajaId: string; pagos: SaleCheckoutPayment[] }, context: MutationContext & { idempotencyKey: string }): Promise<CobrarVtdResultado> {
    const { data, error } = await supabase.rpc('cobrar_vtd', {
      p_venta_ids: input.ventaIds.map(Number),
      p_sesion_caja_id: Number(input.sesionCajaId),
      p_pagos: input.pagos.map((p) => ({
        metodo: methodToMetodoPago(p.method),
        monto: centsToNumeric(p.amountCents),
        ...(p.receivedCents != null ? { recibido: centsToNumeric(p.receivedCents) } : {}),
        ...(p.referencia ? { referencia: p.referencia } : {}),
      })),
      p_idempotencia: context.idempotencyKey,
    })
    if (error) throw error
    type Result = {
      reintento?: boolean; sesion_caja_id: number
      ventas: { venta_id: number; numero: string | null; total: number | string; estado: string }[]
      total: number | string; cambio?: number | string; pendiente_verificacion?: boolean
    }
    const r = data as Result
    return {
      reintento: r.reintento === true,
      sesionCajaId: String(r.sesion_caja_id),
      ventas: (r.ventas ?? []).map((v) => ({ ventaId: String(v.venta_id), numero: v.numero, totalBs: num(v.total), estado: v.estado })),
      totalBs: num(r.total),
      cambioBs: r.cambio != null ? num(r.cambio) : 0,
      pendienteVerificacion: r.pendiente_verificacion === true,
    }
  }
}

export const ventaDirectaRepository = new SupabaseVentaDirectaRepository()

// Brief ubicación fija: Venta Directa despacha siempre desde esta única ubicación
// ('VENTAS DIRECTAS', sucursal_id=1/Almacén Central), aplicada en Cation 2026-08-26. El
// id no se hardcodea — lo asigna la base y no es estable entre entornos — se resuelve
// consultando por sucursal_id + codigo_zona en cada carga.
export const getUbicacionVentasDirectas = async (): Promise<number> => {
  const { data, error } = await supabase.from('ubicacion').select('id').eq('sucursal_id', SUCURSAL_ALMACEN_ID).eq('codigo_zona', 'VENTAS DIRECTAS').maybeSingle()
  if (error) throw error
  if (!data) throw new NotFoundError('No se encontró la ubicación fija de Venta Directa (VENTAS DIRECTAS) para Almacén Central')
  return data.id as number
}
