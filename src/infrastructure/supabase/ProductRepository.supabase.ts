import { supabase } from './supabaseClient'
import type { ProductRepository, Page, PageRequest } from '../../application/ports/repositories'
import type { Product } from '../../types'
import { hoyLocal, sumarDiasIso } from '../../domain/common/fechas'

interface ProductoRow {
  id: number
  nombre: string
  sku_interno: string | null
  marca: string | null
  unidad_base: string | null
  precio_base: number | string | null
  precio_mayoreo: number | string | null
  precio_institucion: number | string | null
  precio_corporativo: number | string | null
  activo: boolean
  imagen_url: string | null
  stock_min: number | string | null
  punto_reorden: number | string | null
  familia_id: number | null
  // Mismo patrón que producto(nombre,sku_interno) en TransferRepository.supabase.ts:
  // embed por nombre de tabla destino (no alias), PostgREST resuelve la FK
  // producto_familia_id_fkey solo y devuelve un objeto (relación to-one).
  familia?: { nombre: string } | null
}

const num = (value: number | string | null | undefined): number => (value == null ? 0 : Number(value))

/**
 * Channel-price resolution with retail fallback (TAREA 2, option a confirmed by Ness): a
 * missing precio_mayoreo/precio_institucion/precio_corporativo must NEVER be charged as Bs 0 —
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
  const corporativo = precioCanal(row.precio_corporativo, retail)
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
    precioCorporativo: corporativo.precio,
    stockTienda: 0,
    stockAlmacen: 0,
    preciosHeredados: { mayoreo: mayoreo.heredado, institucional: institucional.heredado, corporativo: corporativo.heredado },
    // Brief S2: agrupar resultados de búsqueda por familia (el caso "goma eva" — variantes
    // del mismo artículo dispersas). Solo 32% de cobertura (ver comentario histórico en
    // ProductCatalog.tsx) — la mayoría de los productos no tiene familia, y eso está bien:
    // agrupan en un balde "Otros" en vez de forzar una familia que no existe.
    familiaId: row.familia_id ?? undefined,
    familiaNombre: row.familia?.nombre ?? undefined,
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

const PRODUCT_COLUMNS = 'id,nombre,sku_interno,marca,unidad_base,precio_base,precio_mayoreo,precio_institucion,precio_corporativo,activo,imagen_url,stock_min,punto_reorden,familia_id,familia(nombre)'

export class SupabaseProductRepository implements ProductRepository {
  async search(input: { query?: string; category?: string; active?: boolean; page: PageRequest }): Promise<Page<Product>> {
    const { query, active, page } = input
    const from = (page.page - 1) * page.pageSize
    const to = from + page.pageSize - 1
    let builder = supabase.from('producto').select(PRODUCT_COLUMNS, { count: 'exact' })
    const trimmed = query?.trim()
    if (trimmed) {
      // Dentro de un or=(...) de PostgREST, la coma separa condiciones y el paréntesis
      // cierra el grupo: sin escapar, cualquiera de los dos rompe el filtro (400).
      const escaped = trimmed.replace(/[%,()]/g, '')
      builder = builder.or(`nombre.ilike.%${escaped}%,sku_interno.ilike.%${escaped}%`)
    }
    if (active !== undefined) builder = builder.eq('activo', active)
    const { data, error, count } = await builder.order('nombre', { ascending: true }).order('id', { ascending: true }).range(from, to)
    if (error) throw error
    // supabase-js infiere el embed `familia(nombre)` como array a partir del string de
    // select (sin un tipo Database generado no puede ver que familia_id -> familia es
    // una FK to-one) — en runtime PostgREST sí devuelve un objeto. Pasar por `unknown`
    // evita el falso positivo de "may be a mistake" sin mentirle al resto del tipo.
    let rows = (data ?? []) as unknown as ProductoRow[]
    let total = count ?? 0

    // Brief: nombre/sku_interno no cubren el código de barras real (identificador.valor,
    // tipo='barra'/'fabrica' — distinto de sku_interno, ligado a la presentación base del
    // producto, no a producto directamente). Un cajero que escanea o tipea el código
    // impreso no encontraba nada. Solo se intenta en la página 1 y cuando la búsqueda
    // directa no llenó la página — no vale la pena pagar esta consulta extra en cada
    // tecla si ya hay resultados de sobra por nombre.
    if (trimmed && page.page === 1 && rows.length < page.pageSize) {
      const escaped = trimmed.replace(/[%,()]/g, '')
      const { data: porCodigo } = await supabase
        .from('identificador')
        .select('presentacion:presentacion_id(producto_id)')
        .in('tipo', ['barra', 'fabrica'])
        .eq('activo', true)
        .ilike('valor', `%${escaped}%`)
        .limit(20)
      const idsYaTraidos = new Set(rows.map((r) => r.id))
      const idsPorCodigo = [...new Set(
        (porCodigo ?? [])
          .map((row) => (row as unknown as { presentacion: { producto_id: number } | null }).presentacion?.producto_id)
          .filter((id): id is number => id != null && !idsYaTraidos.has(id))
      )]
      if (idsPorCodigo.length) {
        let extra = supabase.from('producto').select(PRODUCT_COLUMNS).in('id', idsPorCodigo)
        if (active !== undefined) extra = extra.eq('activo', active)
        const { data: extraRows } = await extra
        if (extraRows?.length) {
          // Los que matchearon por código van primero — si alguien escaneó, es
          // casi seguro el que busca, no uno más entre 40 resultados por nombre.
          rows = [...(extraRows as unknown as ProductoRow[]), ...rows]
          total += extraRows.length
        }
      }
    }

    // Separate batched call, scoped to just this page's product ids — kept apart from
    // `producto`'s own paginated fetch above so the search's count/pagination can never be
    // affected by the identifier join (see fetchBarcodeCodes doc comment).
    const codes = await fetchBarcodeCodes(rows.map((row) => row.id))
    return {
      items: rows.map((row) => rowToProduct(row, codes.get(row.id))),
      page: page.page,
      pageSize: page.pageSize,
      total,
    }
  }

  async getById(id: string): Promise<Product | null> {
    const numericId = Number(id)
    if (!Number.isFinite(numericId)) return null
    const { data, error } = await supabase.from('producto').select(PRODUCT_COLUMNS).eq('id', numericId).maybeSingle()
    if (error) throw error
    if (!data) return null
    const codes = await fetchBarcodeCodes([numericId])
    return rowToProduct(data as unknown as ProductoRow, codes.get(numericId))
  }

  /** Exact-match lookup by internal SKU (barcode-scanner style Enter-to-search). */
  async findBySku(sku: string): Promise<Product | null> {
    const { data, error } = await supabase.from('producto').select(PRODUCT_COLUMNS).eq('sku_interno', sku).maybeSingle()
    if (error) throw error
    if (!data) return null
    const row = data as unknown as ProductoRow
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

// Brief S9: coalesce(ps.control_stock, s.control_stock_default) para las 2 filas de
// `sucursal` — mismos valores que resuelve permite_sobregiro_sucursal() en Cation, sin
// volver a pedirlas en cada llamada de getStockBySucursalBatch. `sucursal.control_stock_default`
// puede cambiar (hoy Tienda=LIBRE, Almacén=ESTRICTO, pero eso es dato, no un id hardcodeado
// — el día que Tienda termine de inventariarse pasa a ESTRICTO sin tocar este archivo),
// así que el caché vive por sesión de página, no por request.
let sucursalControlDefaultsCache: Promise<Map<number, string>> | null = null
const getSucursalControlDefaults = (): Promise<Map<number, string>> => {
  if (!sucursalControlDefaultsCache) {
    sucursalControlDefaultsCache = (async () => {
      const { data, error } = await supabase.from('sucursal').select('id,control_stock_default')
      if (error) throw error
      return new Map(((data ?? []) as Array<{ id: number; control_stock_default: string | null }>).map((row) => [row.id, row.control_stock_default ?? 'ESTRICTO']))
    })()
  }
  return sucursalControlDefaultsCache
}

type StockBatchEntry = { tienda: number; almacen: number; tiendaLibre: boolean; almacenLibre: boolean; tiendaVendible: number; almacenVendible: number; tiendaReservado: number; almacenReservado: number; tiendaMotivo: string | null; almacenMotivo: string | null }

interface SaldoVendibleRow { producto_id: number; vendible: number | string | null; reservado: number | string | null; motivo: string | null }

/**
 * Stock por sucursal para un LOTE de productos (una página de grilla, nunca el catálogo
 * entero). stock_actual tiene 1.284 filas totales y máx. 3 ubicaciones por producto, así
 * que una página de 60 productos son ~65 filas: muy lejos del tope de 1.000 de PostgREST.
 * Una sola ida y vuelta, no N+1.
 *
 * Brief S9: también trae si cada sucursal permite sobregiro (vender sin stock) para cada
 * producto — tiendaLibre/almacenLibre. Se calcula del lado del cliente con la MISMA
 * fórmula que permite_sobregiro_sucursal() (SQL, la única fuente de verdad — la consultan
 * también registrar_venta y registrar_salida): coalesce(producto_sucursal.control_stock,
 * sucursal.control_stock_default) = 'LIBRE'. Duplicación aceptada explícitamente por el
 * brief (no hay forma de llamar una función SQL en batch desde PostgREST sin una vista);
 * si esto diverge de permite_sobregiro_sucursal, el bug está acá, no allá. Alternativa
 * evaluada y descartada por ahora: una vista v_producto_control_stock que eliminaría esta
 * duplicación por completo — no se creó porque este brief es frontend-only y no toca el
 * esquema; queda anotado para cuando se justifique la migración.
 *
 * Brief S10 (reserva de stock): tienda/almacen siguen siendo stock_actual crudo (el
 * físico, para isLineUnderstocked y los avisos informativos). tiendaVendible/almacenVendible/
 * *Reservado/*Motivo salen de saldo_vendible(producto_ids, sucursal_id) — la RPC que
 * calcula lo realmente disponible para vender, FIFO por antigüedad contra otros pedidos.
 * No se reimplementa ese cálculo acá (misma regla que W3): dos llamadas, una por sucursal,
 * porque saldo_vendible toma un solo sucursal_id a la vez.
 */
export const getStockBySucursalBatch = async (
  productIds: number[],
): Promise<Map<number, StockBatchEntry>> => {
  const ids = [...new Set(productIds)].filter((id) => Number.isFinite(id))
  const result = new Map<number, StockBatchEntry>()
  if (!ids.length) return result
  const [{ data, error }, sucursalDefaults, { data: overridesData, error: overridesError }, { data: vendibleTiendaData, error: vendibleTiendaError }, { data: vendibleAlmacenData, error: vendibleAlmacenError }] = await Promise.all([
    supabase.from('stock_actual').select('producto_id,cantidad_base,ubicacion:ubicacion_id(sucursal_id,excluye_disponible)').in('producto_id', ids),
    getSucursalControlDefaults(),
    supabase.from('producto_sucursal').select('producto_id,sucursal_id,control_stock').in('producto_id', ids),
    supabase.rpc('saldo_vendible', { p_producto_ids: ids, p_sucursal_id: 2 }),
    supabase.rpc('saldo_vendible', { p_producto_ids: ids, p_sucursal_id: 1 }),
  ])
  if (error) throw error
  if (overridesError) throw overridesError
  if (vendibleTiendaError) throw vendibleTiendaError
  if (vendibleAlmacenError) throw vendibleAlmacenError
  const overrideByKey = new Map<string, string>()
  for (const row of (overridesData ?? []) as Array<{ producto_id: number; sucursal_id: number; control_stock: string | null }>) {
    if (row.control_stock) overrideByKey.set(`${row.producto_id}:${row.sucursal_id}`, row.control_stock)
  }
  // Sucursal 1 = Almacén Central, 2 = Tienda, 3 = Shopify (virtual, se ignora).
  const esLibre = (productoId: number, sucursalId: number) =>
    (overrideByKey.get(`${productoId}:${sucursalId}`) ?? sucursalDefaults.get(sucursalId)) === 'LIBRE'
  const vendibleTiendaByProduct = new Map(((vendibleTiendaData ?? []) as SaldoVendibleRow[]).map((row) => [row.producto_id, row]))
  const vendibleAlmacenByProduct = new Map(((vendibleAlmacenData ?? []) as SaldoVendibleRow[]).map((row) => [row.producto_id, row]))
  for (const id of ids) {
    const vt = vendibleTiendaByProduct.get(id)
    const va = vendibleAlmacenByProduct.get(id)
    result.set(id, {
      tienda: 0,
      almacen: 0,
      tiendaLibre: esLibre(id, 2),
      almacenLibre: esLibre(id, 1),
      tiendaVendible: num(vt?.vendible),
      almacenVendible: num(va?.vendible),
      tiendaReservado: num(vt?.reservado),
      almacenReservado: num(va?.reservado),
      tiendaMotivo: vt?.motivo ?? null,
      almacenMotivo: va?.motivo ?? null,
    })
  }
  const rows = (data ?? []) as unknown as Array<{
    producto_id: number
    cantidad_base: number | string
    ubicacion?: { sucursal_id: number | null; excluye_disponible: boolean | null } | null
  }>
  for (const row of rows) {
    const entry = result.get(row.producto_id)
    if (!entry) continue
    if (row.ubicacion?.excluye_disponible === true) continue
    if (row.ubicacion?.sucursal_id === 2) entry.tienda += num(row.cantidad_base)
    else if (row.ubicacion?.sucursal_id === 1) entry.almacen += num(row.cantidad_base)
  }
  return result
}

export interface StockByLocation { ubicacionId: number; sucursalId?: number; cantidadBase: number; excluyeDisponible?: boolean }

/**
 * On-demand stock lookup for a single product — never bulk-preloads stock_actual
 * (it has 1000+ rows and PostgREST caps at 1000). Called only when a product is
 * selected/added to a line in the editor.
 */
export const getStockByProduct = async (
  productId: number,
): Promise<{ onHand: StockByLocation[]; saldoDisponible: number }> => {
  const [{ data: stockRows, error: stockError }, { data: saldoRows, error: saldoError }] = await Promise.all([
    supabase.from('stock_actual').select('ubicacion_id,cantidad_base,ubicacion:ubicacion_id(sucursal_id,excluye_disponible)').eq('producto_id', productId),
    supabase.rpc('saldo_disponible_pedido', { p_producto_ids: [productId] }),
  ])
  if (stockError) throw stockError
  if (saldoError) throw saldoError
  const typedStockRows = (stockRows ?? []) as unknown as Array<{ ubicacion_id: number; cantidad_base: number | string; ubicacion?: { sucursal_id: number | string | null; excluye_disponible: boolean | null } | null }>
  const onHand: StockByLocation[] = typedStockRows.map((row) => ({
    ubicacionId: row.ubicacion_id,
    sucursalId: row.ubicacion?.sucursal_id != null ? num(row.ubicacion.sucursal_id) : undefined,
    cantidadBase: num(row.cantidad_base),
    excluyeDisponible: row.ubicacion?.excluye_disponible === true ? true : undefined,
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

/**
 * TAREA 2 (Tanda 3) — "Frecuentes" real: los N productos más vendidos de los últimos 30
 * días, sumando cantidad_base de v_reporte_productos_vendidos por producto_id. Reemplaza
 * los chips de categoría falsos (producto.categoria no existe en el esquema — ver brief).
 * Paginado en lotes de 1.000 igual que fetchAllMarcas, para no perder ventas silenciosamente
 * si el rango de 30 días supera el tope de PostgREST.
 */
export const listFrecuentes = async (limit = 12): Promise<Product[]> => {
  const desde = sumarDiasIso(hoyLocal(), -30)
  // Frecuencia = en cuántas ventas distintas apareció el producto (una fila de
  // v_reporte_productos_vendidos por línea de venta), NO cuántas unidades se movieron.
  // Sin esto, una sola venta mayorista de miles de unidades domina el ranking un mes
  // entero, y un producto que se vende veinte veces por día en unidades sueltas nunca
  // entra. Desempata por unidades totales descendente.
  const acc = new Map<number, { veces: number; unidades: number }>()
  let from = 0
  for (;;) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await supabase
      .from('v_reporte_productos_vendidos')
      .select('producto_id,cantidad_base')
      .gte('fecha', desde)
      .order('producto_id', { ascending: true })
      .range(from, to)
    if (error) throw error
    const rows = (data ?? []) as Array<{ producto_id: number; cantidad_base: number | string }>
    rows.forEach((row) => {
      const entry = acc.get(row.producto_id) ?? { veces: 0, unidades: 0 }
      entry.veces += 1
      entry.unidades += num(row.cantidad_base)
      acc.set(row.producto_id, entry)
    })
    if (rows.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  const topIds = [...acc.entries()]
    .sort((a, b) => b[1].veces - a[1].veces || b[1].unidades - a[1].unidades)
    .slice(0, limit)
    .map(([id]) => id)
  if (!topIds.length) return []
  const { data: rows, error } = await supabase.from('producto').select(PRODUCT_COLUMNS).in('id', topIds).eq('activo', true)
  if (error) throw error
  const codes = await fetchBarcodeCodes(topIds)
  const productos = ((rows ?? []) as unknown as ProductoRow[]).map((row) => rowToProduct(row, codes.get(row.id)))
  // v_reporte_productos_vendidos no garantiza el orden de vuelta de `producto` — reordenar
  // por ranking de ventas, que es el punto de este chip.
  const rank = new Map(topIds.map((id, i) => [id, i]))
  return productos.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
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
