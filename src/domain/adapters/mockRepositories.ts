import type { ProductRepository, CustomerRepository } from '../repositories'
import type { Product, ProductPresentation } from '../products/entities'
import type { Customer } from '../customers/entities'

export class MockProductRepository implements ProductRepository {
  constructor(private readonly products: Product[] = [], private readonly presentations: ProductPresentation[] = []) {}
  async findById(id: string) { return this.products.find((item) => item.id === id) ?? null }
  async search(query: string) { const normalized = query.toLowerCase(); return this.products.filter((item) => item.name.toLowerCase().includes(normalized)) }
  async listPresentations(productId: string) { return this.presentations.filter((item) => item.productId === productId) }
}

export class MockCustomerRepository implements CustomerRepository {
  constructor(private readonly customers: Customer[] = []) {}
  async findById(id: string) { return this.customers.find((item) => item.id === id) ?? null }
  async search(query: string) { const normalized = query.toLowerCase(); return this.customers.filter((item) => item.name.toLowerCase().includes(normalized)) }
}

