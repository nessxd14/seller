import type { ProductRepository, Page, PageRequest } from '../../application/ports/repositories'
import type { Product } from '../../types'
import { products } from '../../data/products'

export class MockProductRepository implements ProductRepository {
  async search(input: { query?: string; category?: string; active?: boolean; page: PageRequest }): Promise<Page<Product>> {
    const { query, category, page } = input
    const normalized = (query ?? '').toLowerCase().trim()
    const filtered = products.filter((product) =>
      (!normalized || `${product.nombre} ${product.sku}`.toLowerCase().includes(normalized)) &&
      (!category || category === 'Todos' || product.categoria === category)
    )
    const start = (page.page - 1) * page.pageSize
    return { items: filtered.slice(start, start + page.pageSize), page: page.page, pageSize: page.pageSize, total: filtered.length }
  }

  async getById(id: string): Promise<Product | null> {
    return products.find((product) => String(product.id) === id) ?? null
  }

  async findBySku(sku: string): Promise<Product | null> {
    return products.find((product) => product.sku === sku) ?? null
  }
}

export const productRepository = new MockProductRepository()

export const getStockByProduct = async (productId: number): Promise<{ onHand: Array<{ ubicacionId: number; cantidadBase: number }>; saldoDisponible: number }> => {
  const product = products.find((item) => item.id === productId)
  if (!product) return { onHand: [], saldoDisponible: 0 }
  return {
    onHand: [
      { ubicacionId: 2, cantidadBase: product.stockTienda },
      { ubicacionId: 1, cantidadBase: product.stockAlmacen },
    ],
    saldoDisponible: product.stockTienda + product.stockAlmacen,
  }
}

// Mock mode: derive the batch stock map straight from each mock product's own
// stockTienda/stockAlmacen fields — no separate stock_actual table to query.
// Brief S9: el mock no modela producto_sucursal/sucursal.control_stock_default (no hay
// concepto de "control por sucursal" en el backend mock) — tiendaLibre/almacenLibre
// quedan en false (control estricto) para no cambiar el comportamiento de bloqueo que
// el modo mock ya tenía antes de este brief.
// Brief S10: tampoco hay reserva/FIFO en el mock (no hay v_pedido_linea_reserva ni
// saldo_vendible equivalentes) — vendible queda igual al físico y reservado en 0, así
// que isLineBlocking se comporta en mock exactamente como antes de este brief.
export const getStockBySucursalBatch = async (
  productIds: number[],
): Promise<Map<number, { tienda: number; almacen: number; tiendaLibre: boolean; almacenLibre: boolean; tiendaVendible: number; almacenVendible: number; tiendaReservado: number; almacenReservado: number; tiendaMotivo: string | null; almacenMotivo: string | null }>> => {
  const result = new Map<number, { tienda: number; almacen: number; tiendaLibre: boolean; almacenLibre: boolean; tiendaVendible: number; almacenVendible: number; tiendaReservado: number; almacenReservado: number; tiendaMotivo: string | null; almacenMotivo: string | null }>()
  productIds.forEach((id) => {
    const product = products.find((item) => item.id === id)
    if (product) result.set(id, { tienda: product.stockTienda, almacen: product.stockAlmacen, tiendaLibre: false, almacenLibre: false, tiendaVendible: product.stockTienda, almacenVendible: product.stockAlmacen, tiendaReservado: 0, almacenReservado: 0, tiendaMotivo: null, almacenMotivo: null })
  })
  return result
}

// Mock seeds have no presentacion concept — degrade gracefully to a single synthetic
// base presentation so the UI's presentation selector always has at least one option.
export const listPresentations = async (productId: number): Promise<Array<{ id: number; nombre: string; factorUnidadBase: number; esBase: boolean }>> => {
  void productId
  return [{ id: 0, nombre: 'Unidad', factorUnidadBase: 1, esBase: true }]
}

// TAREA 2 (Tanda 3) — el mock no tiene un reporte de ventas real (no hay v_reporte_
// productos_vendidos equivalente en localStorage), así que "Frecuentes" acá es una
// aproximación honesta: los N productos con más stock en tienda, como sustituto
// determinístico para pruebas/demo — no una afirmación real de qué se vende más.
export const listFrecuentes = async (limit = 12): Promise<Product[]> =>
  [...products].sort((a, b) => b.stockTienda - a.stockTienda).slice(0, limit)

// TAREA 6 — mock seed data (src/data/products.ts) predates the marca concept and has
// nothing meaningful to expose here (no marca field on the mock Product shape) — a
// trivial empty list keeps the brand filter dropdown present-but-empty in mock mode
// rather than over-investing in fake mock brand data.
export interface BrandList { marcas: string[]; sinMarca: number }

export const listBrands = async (): Promise<BrandList> => ({ marcas: [], sinMarca: 0 })

export interface LineIdentifiers { barra?: string; fabrica?: string; marca?: string }

// Mock mode has no `identificador` table — stand in with the mock Product's own
// codigoBarra/codigoFabrica fields (they already exist on the mock seed data and read
// naturally as "barra"/"fabrica"), so mock mode's secondary line doesn't look broken/empty
// next to Supabase mode. There is no mock equivalent of producto.marca, so marca stays
// undefined and is simply skipped by the renderer.
export const listLineIdentifiers = async (productIds: string[]): Promise<Record<string, LineIdentifiers>> => {
  const result: Record<string, LineIdentifiers> = {}
  productIds.forEach((id) => {
    const product = products.find((item) => String(item.id) === id)
    if (product) result[id] = { barra: product.codigoBarra || undefined, fabrica: product.codigoFabrica || undefined }
  })
  return result
}
