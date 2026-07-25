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
