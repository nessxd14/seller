import type { Product, SalesChannel } from '../../types'

// Mapeo de filas de Supabase a los modelos del catálogo. Vive en el dominio (sin importar el
// cliente de Supabase) para que el repositorio de red y el índice en memoria produzcan
// exactamente la misma forma.

export interface ProductoRow {
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

export const num = (value: number | string | null | undefined): number => (value == null ? 0 : Number(value))

export const numOrNull = (value: number | string | null | undefined): number | null => (value == null ? null : num(value))

/**
 * Channel-price resolution with retail fallback (TAREA 2, option a confirmed by Ness): a
 * missing precio_mayoreo/precio_institucion/precio_corporativo must NEVER be charged as Bs 0 —
 * it falls back to precio_base (retail) and is flagged as "heredado" (inherited, not
 * negotiated) so the UI can mark it distinctly from a real, deliberately-set channel price.
 * Never applied to retail itself — retail has no fallback target, it IS the fallback source.
 */
const precioCanal = (valor: number | string | null, retail: number): { precio: number; heredado: boolean } =>
  valor == null ? { precio: retail, heredado: true } : { precio: Number(valor), heredado: false }

export const rowToProduct = (row: ProductoRow, codes?: { barra?: string; fabrica?: string }): Product => {
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

export interface Presentation {
  id: number
  nombre: string
  factorUnidadBase: number
  esBase: boolean
  /** Precio ya resuelto por canal (propio, o precio del canal × factor); null = el producto no tiene precio. */
  precios: Record<SalesChannel, number | null>
  tienePrecioPropio: boolean
  /** Dónde se vende: tienda (mostrador, VTD, celular del piso) y/o almacén (cotizaciones, pedidos mayoristas). Ausente = true. */
  vendeTienda: boolean
  vendeAlmacen: boolean
}

export interface LineIdentifiers { barra?: string; fabrica?: string; marca?: string }

/** Fila de `v_presentacion_precio` con las columnas que lee `listPresentations`. */
export interface PresentacionRow {
  presentacion_id: number; nombre: string; factor_unidad_base: number | string; es_base: boolean; activo: boolean | null
  precio_retail: number | string | null; precio_mayoreo: number | string | null; precio_institucion: number | string | null; precio_corporativo: number | string | null
  tiene_precio_propio: boolean | null; vende_tienda?: boolean | null; vende_almacen?: boolean | null
}

export const rowToPresentation = (row: PresentacionRow): Presentation => ({
  id: row.presentacion_id,
  nombre: row.nombre,
  factorUnidadBase: num(row.factor_unidad_base),
  esBase: row.es_base,
  precios: {
    retail: numOrNull(row.precio_retail),
    mayoreo: numOrNull(row.precio_mayoreo),
    institucional: numOrNull(row.precio_institucion),
    corporativo: numOrNull(row.precio_corporativo),
  },
  tienePrecioPropio: row.tiene_precio_propio === true,
  vendeTienda: row.vende_tienda !== false,
  vendeAlmacen: row.vende_almacen !== false,
})

export interface ResolverRow { producto_id: number; presentacion_id?: number | null; factor_unidad_base?: number | string | null; presentacion_nombre?: string | null }

/** Presentación que resuelve un código de barras: sin precios (el carrito los carga al elegir presentación). */
export type ScannedPresentation = Omit<Presentation, 'precios' | 'tienePrecioPropio' | 'vendeTienda' | 'vendeAlmacen'>

/** La presentación de un código solo se informa cuando TODAS las filas del producto apuntan a la misma. */
export const singlePresentation = (rows: ResolverRow[]): ScannedPresentation | undefined => {
  const ids = new Set(rows.map((row) => row.presentacion_id ?? null))
  if (ids.size !== 1) return undefined
  const [first] = rows
  if (first.presentacion_id == null) return undefined
  const factor = num(first.factor_unidad_base ?? 1) || 1
  return { id: first.presentacion_id, nombre: first.presentacion_nombre ?? '', factorUnidadBase: factor, esBase: factor === 1 }
}
