// Historial de precios (pestaña "Precios" en Productos + precio sugerido en el editor
// de pedido/cotización) — ver db/migrations/2026-09-28_historial_precios.sql. Solo
// existe en modo Supabase: no hay equivalente mock, así que los llamadores deben
// guardar detrás de featureFlags.supabase (mismo criterio que evaluarTope/evaluarCredito
// en ContactoCliente.supabase.ts / hermes/client.ts).
import { supabase } from './supabaseClient'
import type { PrecioCategoria, PrecioFuente } from '../../domain/pricing/categoriaPrecio'

const num = (value: number | string | null | undefined): number => (value == null ? 0 : Number(value))

export interface HistorialPrecioRow {
  fuente: PrecioFuente
  documentoId: number
  numero: string
  fecha: string
  clienteId: number | null
  cliente: string | null
  categoria: PrecioCategoria
  estado: string
  cantidadBase: number
  presentacion: string
  precioUnitario: number
  precioUnidadBase: number
  precioListaUnidadBase: number | null
  modificado: boolean
  atipico: boolean
}

interface HistorialPrecioRawRow {
  fuente: PrecioFuente
  documento_id: number
  numero: string
  fecha: string
  cliente_id: number | null
  cliente: string | null
  categoria: PrecioCategoria
  estado: string
  cantidad_base: number | string
  presentacion: string
  precio_unitario: number | string
  precio_unidad_base: number | string
  precio_lista_unidad_base: number | string | null
  modificado: boolean
  atipico: boolean
}

const rowToHistorial = (row: HistorialPrecioRawRow): HistorialPrecioRow => ({
  fuente: row.fuente,
  documentoId: row.documento_id,
  numero: row.numero,
  fecha: row.fecha,
  clienteId: row.cliente_id,
  cliente: row.cliente,
  categoria: row.categoria,
  estado: row.estado,
  cantidadBase: num(row.cantidad_base),
  presentacion: row.presentacion,
  precioUnitario: num(row.precio_unitario),
  precioUnidadBase: num(row.precio_unidad_base),
  precioListaUnidadBase: row.precio_lista_unidad_base == null ? null : num(row.precio_lista_unidad_base),
  modificado: row.modificado,
  atipico: row.atipico,
})

export const historialPrecios = async (
  productoId: number,
  opts?: { clienteId?: number; desde?: string; hasta?: string },
): Promise<HistorialPrecioRow[]> => {
  const { data, error } = await supabase.rpc('historial_precios', {
    p_producto_id: productoId,
    p_cliente_id: opts?.clienteId ?? null,
    p_desde: opts?.desde ?? null,
    p_hasta: opts?.hasta ?? null,
  })
  if (error) throw error
  return ((data ?? []) as HistorialPrecioRawRow[]).map(rowToHistorial)
}

export interface ResumenPreciosProducto {
  lista: {
    unidadBase: string
    retail: number | null
    mayoreo: number | null
    institucional: number | null
    corporativo: number | null
    municipal: number | null
  }
  dias: number
  categorias: Array<{
    categoria: PrecioCategoria
    lineas: number
    unidades: number
    mediana: number
    minimo: number
    maximo: number
    ultimo: { precio: number; fecha: string; numero: string; cliente: string | null }
  }>
}

interface ResumenPreciosRaw {
  lista: {
    unidad_base: string
    retail: number | string | null
    mayoreo: number | string | null
    institucional: number | string | null
    corporativo: number | string | null
    municipal: number | string | null
  }
  dias: number
  categorias: Array<{
    categoria: PrecioCategoria
    lineas: number
    unidades: number | string
    mediana: number | string
    minimo: number | string
    maximo: number | string
    ultimo: { precio: number | string; fecha: string; numero: string; cliente: string | null }
  }>
}

const numOrNull = (value: number | string | null | undefined): number | null => (value == null ? null : Number(value))

export const resumenPreciosProducto = async (productoId: number, dias = 90): Promise<ResumenPreciosProducto> => {
  const { data, error } = await supabase.rpc('resumen_precios_producto', { p_producto_id: productoId, p_dias: dias })
  if (error) throw error
  const raw = data as ResumenPreciosRaw
  return {
    lista: {
      unidadBase: raw.lista.unidad_base,
      retail: numOrNull(raw.lista.retail),
      mayoreo: numOrNull(raw.lista.mayoreo),
      institucional: numOrNull(raw.lista.institucional),
      corporativo: numOrNull(raw.lista.corporativo),
      municipal: numOrNull(raw.lista.municipal),
    },
    dias: raw.dias,
    categorias: raw.categorias.map((c) => ({
      categoria: c.categoria,
      lineas: c.lineas,
      unidades: num(c.unidades),
      mediana: num(c.mediana),
      minimo: num(c.minimo),
      maximo: num(c.maximo),
      ultimo: { precio: num(c.ultimo.precio), fecha: c.ultimo.fecha, numero: c.ultimo.numero, cliente: c.ultimo.cliente },
    })),
  }
}

export interface PrecioSugerido {
  factor: number
  ultimoCliente: { precio: number; fecha: string; numero: string; fuente: PrecioFuente } | null
  categoria: { categoria: string; mediana: number; lineas: number; dias: number } | null
}

interface PrecioSugeridoRaw {
  factor: number | string
  ultimo_cliente: { precio: number | string; fecha: string; numero: string; fuente: PrecioFuente } | null
  categoria: { categoria: string; mediana: number | string; lineas: number; dias: number } | null
}

export const precioSugerido = async (
  productoId: number,
  opts?: { clienteId?: number; categoria?: string; presentacionId?: number },
): Promise<PrecioSugerido> => {
  const { data, error } = await supabase.rpc('precio_sugerido', {
    p_producto_id: productoId,
    p_cliente_id: opts?.clienteId ?? null,
    p_categoria: opts?.categoria ?? null,
    p_presentacion_id: opts?.presentacionId ?? null,
  })
  if (error) throw error
  const raw = data as PrecioSugeridoRaw
  return {
    factor: num(raw.factor),
    ultimoCliente: raw.ultimo_cliente
      ? { precio: num(raw.ultimo_cliente.precio), fecha: raw.ultimo_cliente.fecha, numero: raw.ultimo_cliente.numero, fuente: raw.ultimo_cliente.fuente }
      : null,
    categoria: raw.categoria
      ? { categoria: raw.categoria.categoria, mediana: num(raw.categoria.mediana), lineas: raw.categoria.lineas, dias: raw.categoria.dias }
      : null,
  }
}
