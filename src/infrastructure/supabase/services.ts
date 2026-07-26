import type { CashSessionRecord, CustomerRecord, OrderView, QuoteDraft } from '../../application/shared/models'
import { quoteRepository } from './QuoteRepository.supabase'
import { orderRepository } from './OrderRepository.supabase'
import { customerRepository } from './CustomerRepository.supabase'
import { productRepository as supabaseProductRepository, getStockByProduct as supabaseGetStockByProduct } from './ProductRepository.supabase'
import { cashRepository, getAdvancesForOrder, getOpenSession } from './CashRepository.supabase'
import { saleRepository } from './SaleRepository.supabase'
import { mockAuthSessionProvider } from '../mock/MockAuthSessionProvider'

const currentActorId = async (): Promise<string> => (await mockAuthSessionProvider.getSession())?.user.id ?? 'pos'

const bigPage = { page: 1, pageSize: 200 }

export const quoteService = {
  async list(): Promise<QuoteDraft[]> {
    const { items } = await quoteRepository.list({ page: bigPage })
    return items
  },
  async save(quote: QuoteDraft): Promise<QuoteDraft> {
    const actorId = await currentActorId()
    const existing = quote.id ? await quoteRepository.getById(quote.id) : null
    return quoteRepository.save(quote, { actorId, expectedVersion: existing?.version })
  },
  async duplicate(id: string): Promise<QuoteDraft> {
    const actorId = await currentActorId()
    return quoteRepository.duplicate(id, { actorId })
  },
  /**
   * In the mock backend, converting a quote is a two-step client-side flow
   * (quoteService.markConverted then orderService.save). Against Supabase, the
   * `convertir_cotizacion_a_pedido` RPC does this atomically, so this stub only
   * exists to keep the facade's type shape uniform with the mock service — the
   * supabase-flagged branch in QuotationsPage.convert() never calls it, it calls
   * orderService.save({ sourceQuoteId }) directly instead.
   */
  async markConverted(id: string, orderId: string): Promise<never> {
    void id; void orderId
    throw new Error('En modo Supabase, usa orderService.save({ sourceQuoteId }) para convertir una cotización.')
  },
}

export const orderService = {
  async list(): Promise<OrderView[]> {
    const { items } = await orderRepository.list({ page: bigPage })
    return items
  },
  async save(order: OrderView): Promise<OrderView> {
    const actorId = await currentActorId()
    return orderRepository.save(order, { actorId })
  },
  /** Dispatch is a warehouse/WMS operation (entregar_personalizado / kardex) out of scope for this POS feature. */
  async partialDispatch(id: string): Promise<never> {
    void id
    throw new Error('El despacho se gestiona desde el WMS en modo Supabase.')
  },
}

export const customerService = {
  async list(): Promise<CustomerRecord[]> {
    const { items } = await customerRepository.list({ page: bigPage })
    return items
  },
  async save(customer: CustomerRecord): Promise<CustomerRecord> {
    const actorId = await currentActorId()
    return customerRepository.save(customer, { actorId })
  },
}

export const productRepository = supabaseProductRepository
export const getStockByProduct = supabaseGetStockByProduct

const bigPageCash = { page: 1, pageSize: 200 }

export const cashService = {
  async list(): Promise<CashSessionRecord[]> {
    const { items } = await cashRepository.list({ page: bigPageCash })
    return items
  },
  getOpenSession,
  async open(openingCents: number): Promise<CashSessionRecord> {
    const actorId = await currentActorId()
    return cashRepository.open({ register: 'Caja Tienda', openingCents }, { actorId })
  },
  async close(id: string, countedCents: number): Promise<CashSessionRecord> {
    const actorId = await currentActorId()
    return cashRepository.close(id, countedCents, { actorId })
  },
  async addMovement(sessionId: string, type: 'income' | 'expense', method: 'cash' | 'qr' | 'transfer', amountCents: number, note: string): Promise<CashSessionRecord> {
    const actorId = await currentActorId()
    return cashRepository.addMovement(sessionId, { type, method, amountCents, note }, { actorId })
  },
  async registerAdvance(orderId: string, amountCents: number, method: 'cash' | 'qr' | 'transfer', sessionId: string): Promise<{ movementId: string }> {
    const actorId = await currentActorId()
    return cashRepository.registerAdvance({ orderId, amountCents, method, sessionId }, { actorId })
  },
  getAdvancesForOrder,
  // Backend truth is authoritative (esperado_efectivo comes from cerrar_caja's RPC
  // response); this client-side estimate is only used for the pre-close preview.
  expected(session: CashSessionRecord): number {
    return session.openingCents + session.movements.reduce((sum, movement) => sum + (movement.type === 'income' ? movement.amountCents : -movement.amountCents), 0)
  },
}

export const saleService = {
  async checkout(input: { lines: Array<{ productId: string; quantity: number; unitPriceCents: number; listPriceCents?: number }>; payments: Array<{ method: 'cash' | 'qr' | 'transfer'; amountCents: number }>; cashSessionId: string; customerId?: string; discountCents?: number }) {
    const actorId = await currentActorId()
    return saleRepository.checkout(input, { actorId })
  },
}
