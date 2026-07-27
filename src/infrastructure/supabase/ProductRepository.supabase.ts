import { supabase } from './supabaseClient'
import type { ProductRepository, Page, PageRequest } from '../../application/ports/repositories'
import type { Product } from '../../types'

interface ProductoRow {
  id: number
  nombre: string
  sku_interno: string | null
  marca: string | null
  unidad_base: string | null
  precio_base: number | string | null
  precio_mayoreo: number | string | null
  precio_institucion: number | string | null
  precio_municipal: number | string | null
  activo: boolean
  imagen_url: string | null
  stock_min: number | string | null
  punto_reorden: number | string | null
}

const num = (value: number | string | null | undefined): number => (value == null ? 0 : Number(value))

/**
 * Channel-price resolution with retail fallback (TAREA 2, option a confirmed by Ness): a
 * missing precio_mayoreo/precio_institucion/precio_municipal must NEVER be charged as Bs 0 —
 * it falls back to precio_base (retail) and is flagged as "heredado" (inherited, not
 * negotiated) so the UI can mark it distinctly from a real, deliberately-set channel price.
 * Never applied to retail itself — retail has no fallback target, it IS the fallback source.
 */
const precioCanal = (valor: number | string | null, retail: number): { precio: number; heredado: boolean } =>
  valor == null ? { precio: retail, heredado: true } : { precio: Number(valor), heredado: false }

const rowToProduct = (row: ProductoRow): Product => {
  const retail = num(row.precio_base)
  const mayoreo = precioCanal(row.precio_mayoreo, retail)
  const institucional = precioCanal(row.precio_institucion, retail)
  const municipal = precioCanal(row.precio_municipal, retail)
  return {
    id: row.id,
    sku: row.sku_interno ?? String(row.id),
    codigoBarra: row.sku_interno ?? '',
    codigoFabrica: row.sku_interno ?? '',
    nombre: row.nombre,
    descripcion: row.marca ?? '',
    categoria: row.marca ?? 'General',
    imagen: '',
    imagenUrl: row.imagen_url ?? undefined,
    color: '#585b63',
    precioRetail: retail,
    precioMayoreo: mayoreo.precio,
    precioInstitucional: institucional.precio,
    precioMunicipal: municipal.precio,
    stockTienda: 0,
    stockAlmacen: 0,
    preciosHeredados: { mayoreo: mayoreo.heredado, institucional: institucional.heredado, municipal: municipal.heredado },
  }
}

export class SupabaseProductRepository implements ProductRepository {
  async search(input: { query?: string; category?: string; active?: boolean; page: PageRequest }): Promise<Page<Product>> {
    const { query, active, page } = input
    const from = (page.page - 1) * page.pageSize
    const to = from + page.pageSize - 1
    let builder = supabase.from('producto').select('*', { count: 'exact' })
    if (query && query.trim()) {
      const escaped = query.trim().replace(/[%,]/g, '')
      builder = builder.or(`nombre.ilike.%${escaped}%,sku_interno.ilike.%${escaped}%`)
    }
    if (active !== undefined) builder = builder.eq('activo', active)
    const { data, error, count } = await builder.range(from, to)
    if (error) throw error
    return {
      items: (data ?? []).map((row) => rowToProduct(row as ProductoRow)),
      page: page.page,
      pageSize: page.pageSize,
      total: count ?? 0,
    }
  }

  async getById(id: string): Promise<Product | null> {
    const numericId = Number(id)
    if (!Number.isFinite(numericId)) return null
    const { data, error } = await supabase.from('producto').select('*').eq('id', numericId).maybeSingle()
    if (error) throw error
    return data ? rowToProduct(data as ProductoRow) : null
  }

  /** Exact-match lookup by internal SKU (barcode-scanner style Enter-to-search). */
  async findBySku(sku: string): Promise<Product | null> {
    const { data, error } = await supabase.from('producto').select('*').eq('sku_interno', sku).maybeSingle()
    if (error) throw error
    return data ? rowToProduct(data as ProductoRow) : null
  }
}

export const productRepository = new SupabaseProductRepository()

export interface StockByLocation { ubicacionId: number; sucursalId?: number; cantidadBase: number }

/**
 * On-demand stock lookup for a single product — never bulk-preloads stock_actual
 * (it has 1000+ rows and PostgREST caps at 1000). Called only when a product is
 * selected/added to a line in the editor.
 */
export const getStockByProduct = async (
  productId: number,
): Promise<{ onHand: StockByLocation[]; saldoDisponible: number }> => {
  const [{ data: stockRows, error: stockError }, { data: saldoRows, error: saldoError }] = await Promise.all([
    supabase.from('stock_actual').select('ubicacion_id,cantidad_base,ubicacion:ubicacion_id(sucursal_id)').eq('producto_id', productId),
    supabase.rpc('saldo_disponible_pedido', { p_producto_ids: [productId] }),
  ])
  if (stockError) throw stockError
  if (saldoError) throw saldoError
  const typedStockRows = (stockRows ?? []) as unknown as Array<{ ubicacion_id: number; cantidad_base: number | string; ubicacion?: { sucursal_id: number | string | null } | null }>
  const onHand: StockByLocation[] = typedStockRows.map((row) => ({
    ubicacionId: row.ubicacion_id,
    sucursalId: row.ubicacion?.sucursal_id != null ? num(row.ubicacion.sucursal_id) : undefined,
    cantidadBase: num(row.cantidad_base),
  }))
  const saldoRow = (saldoRows as Array<{ producto_id: number; saldo_libre: number | string }> | null)?.[0]
  return { onHand, saldoDisponible: num(saldoRow?.saldo_libre) }
}

export interface Presentation { id: number; nombre: string; factorUnidadBase: number; esBase: boolean }

/** Presentations for a product (e.g. "Caja" with factor 12, "Unidad" base with factor 1). */
export const listPresentations = async (productId: number): Promise<Presentation[]> => {
  const { data, error } = await supabase
    .from('presentacion')
    .select('id,nombre,factor_unidad_base,es_base,activo')
    .eq('producto_id', productId)
    .order('es_base', { ascending: false })
  if (error) throw error
  const rows = (data ?? []) as Array<{ id: number; nombre: string; factor_unidad_base: number | string; es_base: boolean; activo: boolean | null }>
  return rows.filter((row) => row.activo !== false).map((row) => ({ id: row.id, nombre: row.nombre, factorUnidadBase: num(row.factor_unidad_base), esBase: row.es_base }))
}

export interface LineIdentifiers { barra?: string; fabrica?: string; marca?: string }

/**
 * Batch-fetch barcode/factory-code/brand for a set of product ids, for the secondary
 * "identifiers" line on order/quote rows (item 2.2). Codes live on `identificador`,
 * keyed by presentacion_id — NOT producto_id — so this resolves each product's BASE
 * presentation first, then looks up its identificador rows. Batched via `.in()` across
 * all requested products in two round trips total (not one query per line) to avoid an
 * N+1 waterfall on a multi-line quote/order.
 */
export const listIdentifiersForProducts = async (productIds: string[]): Promise<Record<string, LineIdentifiers>> => {
  const ids = [...new Set(productIds.map(Number))].filter((id) => Number.isFinite(id))
  if (!ids.length) return {}
  const [{ data: productos, error: prodError }, { data: presentaciones, error: presError }] = await Promise.all([
    supabase.from('producto').select('id,marca').in('id', ids),
    supabase.from('presentacion').select('id,producto_id').in('producto_id', ids).eq('es_base', true),
  ])
  if (prodError) throw prodError
  if (presError) throw presError
  const basePresByProduct = new Map<number, number>()
  ;(presentaciones ?? []).forEach((row) => basePresByProduct.set((row as { producto_id: number }).producto_id, (row as { id: number }).id))
  const presIds = [...basePresByProduct.values()]
  const { data: identificadores, error: idError } = presIds.length
    ? await supabase.from('identificador').select('presentacion_id,tipo,valor,activo').in('presentacion_id', presIds).in('tipo', ['barra', 'fabrica'])
    : { data: [] as unknown[], error: null }
  if (idError) throw idError
  const codesByPres = new Map<number, { barra?: string; fabrica?: string }>()
  ;(identificadores ?? []).forEach((row) => {
    const typed = row as { presentacion_id: number; tipo: 'barra' | 'fabrica'; valor: string; activo: boolean | null }
    if (typed.activo === false) return
    const entry = codesByPres.get(typed.presentacion_id) ?? {}
    if (typed.tipo === 'barra' && !entry.barra) entry.barra = typed.valor
    if (typed.tipo === 'fabrica' && !entry.fabrica) entry.fabrica = typed.valor
    codesByPres.set(typed.presentacion_id, entry)
  })
  const result: Record<string, LineIdentifiers> = {}
  ;(productos ?? []).forEach((row) => {
    const typed = row as { id: number; marca: string | null }
    const presId = basePresByProduct.get(typed.id)
    const codes = presId != null ? codesByPres.get(presId) : undefined
    result[String(typed.id)] = { barra: codes?.barra, fabrica: codes?.fabrica, marca: typed.marca ?? undefined }
  })
  return result
}
