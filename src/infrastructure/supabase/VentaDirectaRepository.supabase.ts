import { supabase } from './supabaseClient'
import type { MutationContext, VentaDirectaAbrirLine, VentaDirectaRepository } from '../../application/ports/repositories'
import type { VentaDirectaRecord, VtdEstado, VtdLine } from '../../application/shared/models'
import type { SaleCheckoutPayment } from '../../application/ports/repositories'
import { NotFoundError } from '../../application/errors/AppError'
import { centsToNumeric, methodToMetodoPago, numericToCents } from './mappers'

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

  async ajustar(id: string, ajustes: Array<{ lineaId: string; cantidadPresentacion: number }>, cashSessionId: string | undefined, context: MutationContext): Promise<VentaDirectaRecord> {
    const actor = context.actorId ?? 'pos'
    const numericId = Number(id)
    const { error } = await supabase.rpc('ajustar_venta_abierta', {
      p_venta_id: numericId,
      p_ajustes: ajustes.map((a) => ({ linea_id: Number(a.lineaId), cantidad_presentacion: a.cantidadPresentacion })),
      p_sesion_caja_id: cashSessionId ? Number(cashSessionId) : null,
      p_usuario: actor,
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
}

export const ventaDirectaRepository = new SupabaseVentaDirectaRepository()

export interface UbicacionOption { id: number; label: string }

// Brief 2.1: "no hardcodear la ubicación... si hay más de una, el cajero elige" — se
// deriva de la sucursal Almacén Central, nunca de un id fijo de ubicación.
export const listUbicacionesAlmacen = async (sucursalAlmacenId: number): Promise<UbicacionOption[]> => {
  const { data, error } = await supabase.from('ubicacion').select('id, codigo_zona, estante, nivel, compartimiento').eq('sucursal_id', sucursalAlmacenId).order('id')
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id as number,
    label: [row.codigo_zona, [row.estante, row.nivel].filter(Boolean).join(' '), row.compartimiento].filter(Boolean).join(' · '),
  }))
}
