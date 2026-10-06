// Piso — pedido que el vendedor arma en su teléfono. Llama directo a las RPC ya desplegadas
// (guardar/retirar/anular/mis_pedidos_vendedor); aquí solo se mapea snake_case → camelCase.
import { supabase } from './supabaseClient'
import { toError } from './postgrestError'
import type { PedidoVendedorCobroInput, PedidoVendedorCobroResultado, PedidoVendedorEnCola, PedidoVendedorEstado, PedidoVendedorLinea, PedidoVendedorLineaInput, PedidoVendedorRecord } from '../../application/shared/models'
import { centsToNumeric, methodToMetodoPago } from './mappers'

const num = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v))
const numOrNull = (v: number | string | null | undefined): number | null => (v == null ? null : Number(v))

interface LineaRow {
  linea_id: number | string; orden: number; producto_id: number | null; nombre: string | null; sku: string | null
  presentacion_id: number | null; presentacion: string | null; es_base: boolean | null; factor: number | string | null
  es_personalizado: boolean | null; unidad_medida: string | null; cantidad: number | string
  precio_lista: number | string | null; precio_minimo: number | string | null; precio_unitario: number | string; subtotal: number | string
  resultado: string | null; cantidad_final: number | string | null; precio_final: number | string | null; motivo_caja: string | null
}
interface PedidoRow {
  pedido_id: number | string; codigo: string; numero_dia: number; fecha: string; estado: PedidoVendedorEstado; vendedor: string | null
  nota: string | null; total: number | string; enviado_en: string | null; tomado_por: string | null; venta_numero: string | null
  anulado_origen: string | null; anulado_motivo: string | null; reintento?: boolean; lineas?: LineaRow[] | null
}

const rowToLinea = (r: LineaRow): PedidoVendedorLinea => ({
  lineaId: String(r.linea_id), orden: r.orden, productoId: r.producto_id, nombre: r.nombre ?? '', sku: r.sku,
  presentacionId: r.presentacion_id, presentacion: r.presentacion, esBase: r.es_base !== false, factor: r.factor == null ? 1 : num(r.factor),
  esPersonalizado: r.es_personalizado === true, unidadMedida: r.unidad_medida, cantidad: num(r.cantidad),
  precioLista: numOrNull(r.precio_lista), precioMinimo: numOrNull(r.precio_minimo), precioUnitario: num(r.precio_unitario), subtotal: num(r.subtotal),
  resultado: r.resultado, cantidadFinal: numOrNull(r.cantidad_final), precioFinal: numOrNull(r.precio_final), motivoCaja: r.motivo_caja,
})

export const rowToPedido = (r: PedidoRow): PedidoVendedorRecord => ({
  pedidoId: String(r.pedido_id), codigo: r.codigo, numeroDia: r.numero_dia, fecha: r.fecha, estado: r.estado, vendedor: r.vendedor ?? '',
  nota: r.nota, total: num(r.total), enviadoEn: r.enviado_en, tomadoPor: r.tomado_por, ventaNumero: r.venta_numero,
  anuladoOrigen: r.anulado_origen, anuladoMotivo: r.anulado_motivo, reintento: r.reintento === true,
  lineas: (r.lineas ?? []).map(rowToLinea),
})

export const lineaToPayload = (l: PedidoVendedorLineaInput): Record<string, unknown> =>
  'esPersonalizado' in l
    ? { es_personalizado: true, descripcion: l.descripcion, unidad_medida: l.unidadMedida, cantidad: l.cantidad, precio_unitario: l.precioUnitario }
    : {
        producto_id: l.productoId,
        ...(l.presentacionId != null ? { presentacion_id: l.presentacionId } : {}),
        cantidad: l.cantidad,
        ...(l.precioUnitario != null ? { precio_unitario: l.precioUnitario } : {}),
      }

/** Reemplaza TODAS las líneas del pedido. `clave` (UUID generado una vez por pedido) hace seguros los reintentos. */
export async function guardar(input: { clave: string; lineas: PedidoVendedorLineaInput[]; enviar?: boolean; nota?: string | null }): Promise<PedidoVendedorRecord> {
  const { data, error } = await supabase.rpc('guardar_pedido_vendedor', {
    p_clave: input.clave,
    p_lineas: input.lineas.map(lineaToPayload),
    p_enviar: input.enviar === true,
    p_nota: input.nota ?? null,
  })
  if (error) throw toError(error)
  return rowToPedido(data as PedidoRow)
}

export async function retirar(pedidoId: string): Promise<PedidoVendedorRecord> {
  const { data, error } = await supabase.rpc('retirar_pedido_vendedor', { p_pedido_id: Number(pedidoId) })
  if (error) throw toError(error)
  return rowToPedido(data as PedidoRow)
}

export async function anular(pedidoId: string, motivo?: string | null): Promise<PedidoVendedorRecord> {
  const { data, error } = await supabase.rpc('anular_pedido_vendedor', { p_pedido_id: Number(pedidoId), p_motivo: motivo ?? null })
  if (error) throw toError(error)
  return rowToPedido(data as PedidoRow)
}

export async function misPedidos(): Promise<PedidoVendedorRecord[]> {
  const { data, error } = await supabase.rpc('mis_pedidos_vendedor')
  if (error) throw toError(error)
  return ((data ?? []) as PedidoRow[]).map(rowToPedido)
}

/**
 * mis_pedidos_vendedor() no devuelve la clave: para recuperarla (otro teléfono, storage borrado)
 * se lee la tabla. El `.eq('vendedor_id', userId)` es obligatorio: para cajero, gerente y admin la
 * RLS devuelve las filas de todos.
 */
export async function clavesAbiertas(userId: string): Promise<Array<{ pedidoId: string; clave: string }>> {
  const { data, error } = await supabase.from('pedido_vendedor').select('id,clave_cliente')
    .eq('vendedor_id', userId).in('estado', ['ARMANDO', 'ENVIADO'])
  if (error) throw toError(error)
  return ((data ?? []) as Array<{ id: number | string; clave_cliente: string }>).map((r) => ({ pedidoId: String(r.id), clave: r.clave_cliente }))
}

// ── Caja: cola, tomar, devolver y cobrar ───────────────────────────────────────────────

interface ColaRow {
  pedido_id: number | string; codigo: string; numero_dia: number; estado: 'ENVIADO' | 'EN_CAJA'; vendedor: string | null
  enviado_en: string | null; total: number | string; lineas: number | string; tomado_por: string | null; sesion_caja_id: number | string | null
}

/** Pedidos esperando (ENVIADO) y ya dentro de una caja (EN_CAJA), del más viejo al más nuevo. Cajero, gerente y admin. */
export async function cola(): Promise<PedidoVendedorEnCola[]> {
  const { data, error } = await supabase.rpc('pedidos_vendedor_cola')
  if (error) throw toError(error)
  return ((data ?? []) as ColaRow[]).map((r) => ({
    pedidoId: String(r.pedido_id), codigo: r.codigo, numeroDia: r.numero_dia, estado: r.estado, vendedor: r.vendedor ?? '', enviadoEn: r.enviado_en,
    total: num(r.total), lineas: num(r.lineas), tomadoPor: r.tomado_por, sesionCajaId: r.sesion_caja_id != null ? String(r.sesion_caja_id) : null,
  }))
}

/** ENVIADO → EN_CAJA. Repetirlo con el mismo usuario y sesión devuelve el pedido (reintento seguro y reanudación tras recargar). */
export async function tomar(pedidoId: string, sesionCajaId: string): Promise<PedidoVendedorRecord> {
  const { data, error } = await supabase.rpc('tomar_pedido_vendedor', { p_pedido_id: Number(pedidoId), p_sesion_caja_id: Number(sesionCajaId) })
  if (error) throw toError(error)
  return rowToPedido(data as PedidoRow)
}

/** EN_CAJA → ENVIADO: el pedido vuelve a la cola sin cambios. */
export async function devolver(pedidoId: string): Promise<void> {
  const { error } = await supabase.rpc('devolver_pedido_vendedor', { p_pedido_id: Number(pedidoId) })
  if (error) throw toError(error)
}

/**
 * Cobra exactamente un pedido. La clave de idempotencia es siempre la misma para ese pedido
 * (`pedido-vendedor:<id>`): reintentar tras una respuesta perdida devuelve la venta con reintento: true.
 */
export async function cobrar(input: PedidoVendedorCobroInput): Promise<PedidoVendedorCobroResultado> {
  const { data, error } = await supabase.rpc('cobrar_pedido_vendedor', {
    p_pedido_ids: [Number(input.pedidoId)],
    p_lineas: input.lineas,
    p_pagos: input.pagos.map((p) => ({
      metodo: methodToMetodoPago(p.method),
      monto: centsToNumeric(p.amountCents),
      ...(p.method === 'cash' && p.receivedCents != null ? { recibido: centsToNumeric(p.receivedCents) } : {}),
    })),
    p_sesion_caja_id: Number(input.sesionCajaId),
    p_idempotencia: `pedido-vendedor:${input.pedidoId}`,
    p_quitadas: input.quitadas,
  })
  if (error) throw toError(error)
  const r = data as { venta_id: number | string; numero?: string | null; subtotal: number | string; descuento_total: number | string; total: number | string; reintento?: boolean; pedidos?: Array<number | string> }
  return { ventaId: String(r.venta_id), numero: r.numero ?? null, subtotal: num(r.subtotal), descuentoTotal: num(r.descuento_total), total: num(r.total), reintento: r.reintento === true, pedidos: (r.pedidos ?? []).map(String) }
}
