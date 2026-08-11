import { supabase } from './supabaseClient'
import { ConflictError, NotFoundError } from '../../application/errors/AppError'

// Brief S11 Bloque B: puede_eliminarse_pedido/eliminar_pedido/guardar_version_pedido son
// la única fuente de verdad para estas reglas (append-only del Kardex, versión
// autocontenida) — este archivo solo pregunta y muestra, nunca reimplementa la decisión.

export interface PuedeEliminarsePedido {
  existe: boolean
  estado: string
  lineas: number
  despachadas: number
  movioKardex: boolean
  puedeBorrarse: boolean
}

export async function puedeEliminarsePedido(pedidoId: number): Promise<PuedeEliminarsePedido> {
  const { data, error } = await supabase.rpc('puede_eliminarse_pedido', { p_pedido_id: pedidoId })
  if (error) throw error
  const row = data as { existe: boolean; estado: string; lineas: number | string; despachadas: number | string; movio_kardex: boolean; puede_borrarse: boolean }
  return {
    existe: Boolean(row?.existe),
    estado: row?.estado ?? '',
    lineas: Number(row?.lineas ?? 0),
    despachadas: Number(row?.despachadas ?? 0),
    movioKardex: Boolean(row?.movio_kardex),
    puedeBorrarse: Boolean(row?.puede_borrarse),
  }
}

export async function eliminarPedido(pedidoId: number, motivo: string, usuario: string): Promise<void> {
  const { error } = await supabase.rpc('eliminar_pedido', { p_pedido_id: pedidoId, p_motivo: motivo, p_usuario: usuario })
  if (error) {
    if (error.message.includes('no existe')) throw new NotFoundError('El pedido ya no existe')
    if (error.message.includes('no se puede eliminar')) throw new ConflictError(error.message)
    throw error
  }
}

// Snapshot autocontenido a propósito (nombre de producto, SKU, cantidades y precios tal
// como estaban): una versión vieja sigue mostrando lo que decía aunque después cambie el
// catálogo o se borre un producto. Ver guardar_version_pedido en Cation.
export interface PedidoVersionLinea {
  lineaId: number
  productoId: number | null
  productoNombre: string | null
  sku: string | null
  descripcion: string | null
  esPersonalizado: boolean
  cantidadBase: number
  cantidadPresentacion: number | null
  presentacionId: number | null
  precioUnitario: number
  cantidadDespachada: number | null
  estado: string
}

export interface PedidoVersion {
  version: number
  motivo: string | null
  usuario: string | null
  creadoEn: string
  lineas: PedidoVersionLinea[]
}

interface PedidoVersionRow {
  version: number
  motivo: string | null
  usuario: string | null
  creado_en: string
  snapshot: { cabecera?: Record<string, unknown>; lineas?: unknown[] } | null
}

const rowToVersion = (row: PedidoVersionRow): PedidoVersion => ({
  version: row.version,
  motivo: row.motivo,
  usuario: row.usuario,
  creadoEn: row.creado_en,
  lineas: ((row.snapshot?.lineas ?? []) as Array<Record<string, unknown>>).map((l) => ({
    lineaId: Number(l.linea_id),
    productoId: l.producto_id != null ? Number(l.producto_id) : null,
    productoNombre: (l.producto_nombre as string | null) ?? null,
    sku: (l.sku as string | null) ?? null,
    descripcion: (l.descripcion as string | null) ?? null,
    esPersonalizado: Boolean(l.es_personalizado),
    cantidadBase: Number(l.cantidad_base ?? 0),
    cantidadPresentacion: l.cantidad_presentacion != null ? Number(l.cantidad_presentacion) : null,
    presentacionId: l.presentacion_id != null ? Number(l.presentacion_id) : null,
    precioUnitario: Number(l.precio_unitario ?? 0),
    cantidadDespachada: l.cantidad_despachada != null ? Number(l.cantidad_despachada) : null,
    estado: (l.estado as string) ?? '',
  })),
})

export async function listVersionesPedido(pedidoId: number): Promise<PedidoVersion[]> {
  const { data, error } = await supabase.from('pedido_version').select('*').eq('pedido_id', pedidoId).order('version', { ascending: true })
  if (error) throw error
  return ((data ?? []) as PedidoVersionRow[]).map(rowToVersion)
}

// Brief S11 (nota del usuario, no del brief original): la grilla de pedidos resalta las
// filas editadas (más de una versión) — se necesita el conteo por pedido en una sola
// consulta para no hacer N+1 por página.
export async function contarVersionesPedidos(pedidoIds: number[]): Promise<Map<number, number>> {
  const result = new Map<number, number>()
  if (!pedidoIds.length) return result
  const { data, error } = await supabase.from('pedido_version').select('pedido_id').in('pedido_id', pedidoIds)
  if (error) throw error
  for (const row of (data ?? []) as Array<{ pedido_id: number }>) {
    result.set(row.pedido_id, (result.get(row.pedido_id) ?? 0) + 1)
  }
  return result
}
