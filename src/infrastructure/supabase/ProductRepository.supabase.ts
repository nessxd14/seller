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

const rowToProduct = (row: ProductoRow, codes?: { barra?: string; fabrica?: string }): Product => {
  const retail = num(row.precio_base)
  const mayoreo = precioCanal(row.precio_mayoreo, retail)
  const institucional = precioCanal(row.precio_institucion, retail)
  const municipal = precioCanal(row.precio_municipal, retail)
  return {
    id: row.id,
    sku: row.sku_interno ?? String(row.id),
    codigoBarra: codes?.barra ?? '',
    codigoFabrica: codes?.fabrica ?? '',
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

/**
 * Batch-fetch each product's REAL barcode (`identificador.tipo='barra'`) and factory code
 * (`tipo='fabrica'`) off its BASE presentation, for display purposes (TAREA 1 — these used
 * to be faked as `sku_interno` duplicated into both fields, which is not a real code and was
 * confusing in the search-results dropdown). A product can have more than one `barra`
 * identificador, so `es_principal` wins; ties keep whichever row comes back first. Two
 * round-trips total regardless of how many product ids are passed — mirrors
 * `listIdentifiersForProducts`'s existing batching convention in this same file, scoped here
 * to a bounded set of ids (a search results page, never the full catalog) so this is never at
 * risk of PostgREST's 1000-row cap.
 */
const fetchBarcodeCodes = async (productIds: number[]): Promise<Map<number, { barra?: string; fabrica?: string }>> => {
  const ids = [...new Set(productIds)].filter((id) => Number.isFinite(id))
  const result = new Map<number, { barra?: string; fabrica?: string }>()
  if (!ids.length) return result
  const { data: presentaciones, error: presError } = await supabase
    .from('presentacion')
    .select('id,producto_id')
    .in('producto_id', ids)
    .eq('es_base', true)
  if (presError) throw presError
  const basePresByProduct = new Map<number, number>()
  ;(presentaciones ?? []).forEach((row) => basePresByProduct.set((row as { producto_id: number }).producto_id, (row as { id: number }).id))
  const presIds = [...basePresByProduct.values()]
  if (!presIds.length) return result
  const { data: identificadores, error: idError } = await supabase
    .from('identificador')
    .select('presentacion_id,tipo,valor,activo,es_principal')
    .in('presentacion_id', presIds)
    .in('tipo', ['barra', 'fabrica'])
    .order('es_principal', { ascending: false })
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
  basePresByProduct.forEach((presId, productId) => {
    const codes = codesByPres.get(presId)
    if (codes) result.set(productId, codes)
  })
  return result
}

const PRODUCT_COLUMNS = 'id,nombre,sku_interno,marca,unidad_base,precio_base,precio_mayoreo,precio_institucion,precio_municipal,activo,imagen_url,stock_min,punto_reorden'

export class SupabaseProductRepository implements ProductRepository {
  async search(input: { query?: string; category?: string; active?: boolean; page: PageRequest }): Promise<Page<Product>> {
    const { query, active, page } = input
    const from = (page.page - 1) * page.pageSize
    const to = from + page.pageSize - 1
    let builder = supabase.from('producto').select(PRODUCT_COLUMNS, { count: 'exact' })
    if (query && query.trim()) {
      // Dentro de un or=(...) de PostgREST, la coma separa condiciones y el paréntesis
      // cierra el grupo: sin escapar, cualquiera de los dos rompe el filtro (400).
      const escaped = query.trim().replace(/[%,()]/g, '')
      builder = builder.or(`nombre.ilike.%${escaped}%,sku_interno.ilike.%${escaped}%`)
    }
    if (active !== undefined) builder = builder.eq('activo', active)
    const { data, error, count } = await builder.order('nombre', { ascending: true }).order('id', { ascending: true }).range(from, to)
    if (error) throw error
    const rows = (data ?? []) as ProductoRow[]
    // Separate batched call, scoped to just this page's product ids — kept apart from
    // `producto`'s own paginated fetch above so the search's count/pagination can never be
    // affected by the identifier join (see fetchBarcodeCodes doc comment).
    const codes = await fetchBarcodeCodes(rows.map((row) => row.id))
    return {
      items: rows.map((row) => rowToProduct(row, codes.get(row.id))),
      page: page.page,
      pageSize: page.pageSize,
      total: count ?? 0,
    }
  }

  async getById(id: string): Promise<Product | null> {
    const numericId = Number(id)
    if (!Number.isFinite(numericId)) return null
    const { data, error } = await supabase.from('producto').select(PRODUCT_COLUMNS).eq('id', numericId).maybeSingle()
    if (error) throw error
    if (!data) return null
    const codes = await fetchBarcodeCodes([numericId])
    return rowToProduct(data as ProductoRow, codes.get(numericId))
  }

  /** Exact-match lookup by internal SKU (barcode-scanner style Enter-to-search). */
  async findBySku(sku: string): Promise<Product | null> {
    const { data, error } = await supabase.from('producto').select(PRODUCT_COLUMNS).eq('sku_interno', sku).maybeSingle()
    if (error) throw error
    if (!data) return null
    const row = data as ProductoRow
    const codes = await fetchBarcodeCodes([row.id])
    return rowToProduct(row, codes.get(row.id))
  }

  /**
   * Resolución de un código escaneado: barra, fábrica o SKU interno, en ese orden.
   * Usa la RPC `resolver_identificador` (la misma que ya usa el WMS) para no duplicar
   * la lógica de resolución en dos frontends.
   *
   * Hay 40 códigos de barra ambiguos en la base (un mismo valor mapea a más de un
   * producto), así que el resultado distingue explícitamente los tres casos en vez de
   * elegir uno al azar: el llamador decide qué hacer con la ambigüedad.
   */
  async resolveScannedCode(codigo: string): Promise<
    | { kind: 'found'; product: Product }
    | { kind: 'ambiguous'; productIds: number[] }
    | { kind: 'not_found' }
  > {
    // eslint-disable-next-line no-control-regex -- los lectores físicos a veces mandan basura de control antes del Enter
    const code = codigo.trim().replace(/[\x00-\x1F\x7F]/g, '')
    if (!code) return { kind: 'not_found' }
    const { data, error } = await supabase.rpc('resolver_identificador', { p_codigo: code })
    if (error) throw error
    const rows = (data ?? []) as Array<{ producto_id: number }>
    if (rows.length) {
      const productIds = [...new Set(rows.map((row) => row.producto_id))]
      if (productIds.length > 1) return { kind: 'ambiguous', productIds }
      const product = await this.getById(String(productIds[0]))
      return product ? { kind: 'found', product } : { kind: 'not_found' }
    }
    const bySku = await this.findBySku(code)
    return bySku ? { kind: 'found', product: bySku } : { kind: 'not_found' }
  }
}

export const productRepository = new SupabaseProductRepository()

/**
 * Stock por sucursal para un LOTE de productos (una página de grilla, nunca el catálogo
 * entero). stock_actual tiene 1.284 filas totales y máx. 3 ubicaciones por producto, así
 * que una página de 60 productos son ~65 filas: muy lejos del tope de 1.000 de PostgREST.
 * Una sola ida y vuelta, no N+1.
 */
export const getStockBySucursalBatch = async (
  productIds: number[],
): Promise<Map<number, { tienda: number; almacen: number }>> => {
  const ids = [...new Set(productIds)].filter((id) => Number.isFinite(id))
  const result = new Map<number, { tienda: number; almacen: number }>()
  if (!ids.length) return result
  const { data, error } = await supabase
    .from('stock_actual')
    .select('producto_id,cantidad_base,ubicacion:ubicacion_id(sucursal_id)')
    .in('producto_id', ids)
  if (error) throw error
  const rows = (data ?? []) as unknown as Array<{
    producto_id: number
    cantidad_base: number | string
    ubicacion?: { sucursal_id: number | null } | null
  }>
  for (const row of rows) {
    const entry = result.get(row.producto_id) ?? { tienda: 0, almacen: 0 }
    // Sucursal 1 = Almacén Central, 2 = Tienda, 3 = Shopify (virtual, se ignora).
    if (row.ubicacion?.sucursal_id === 2) entry.tienda += num(row.cantidad_base)
    else if (row.ubicacion?.sucursal_id === 1) entry.almacen += num(row.cantidad_base)
    result.set(row.producto_id, entry)
  }
  return result
}

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

/**
 * TAREA 6 — distinct brand list for the catalog's brand filter dropdown.
 * A dedicated lightweight query rather than deriving brands from a paginated/
 * filtered search result set (which might not include every brand on the
 * current page) — 89 distinct brands across up to 1492 active products, cheap
 * enough for a plain `select distinct`. `sinMarca` counts active products with
 * a null/empty marca, for the dropdown's "Sin marca" option.
 */
export interface BrandList { marcas: string[]; sinMarca: number }

const PAGE_SIZE = 1000

/**
 * PostgREST corta en 1.000 filas por default. Con 1.497 productos activos, un solo
 * `select('marca')` sin paginar pierde en silencio las marcas que solo aparecen en
 * los productos que caen después de la fila 1.000. Se pagina en lotes de 1.000,
 * ordenando por `id` para que la paginación no repita ni salte filas.
 */
const fetchAllMarcas = async (): Promise<string[]> => {
  const marcas: string[] = []
  let from = 0
  for (;;) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await supabase
      .from('producto')
      .select('marca')
      .eq('activo', true)
      .not('marca', 'is', null)
      .order('id', { ascending: true })
      .range(from, to)
    if (error) throw error
    const rows = (data ?? []) as Array<{ marca: string | null }>
    rows.forEach((row) => { if (row.marca) marcas.push(row.marca) })
    if (rows.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return marcas
}

export const listBrands = async (): Promise<BrandList> => {
  const [marcaRows, { count: sinMarcaCount, error: sinMarcaError }] = await Promise.all([
    fetchAllMarcas(),
    supabase.from('producto').select('id', { count: 'exact', head: true }).eq('activo', true).or('marca.is.null,marca.eq.'),
  ])
  if (sinMarcaError) throw sinMarcaError
  const marcas = [...new Set(marcaRows.filter((m) => m.trim()))].sort((a, b) => a.localeCompare(b, 'es'))
  return { marcas, sinMarca: sinMarcaCount ?? 0 }
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
