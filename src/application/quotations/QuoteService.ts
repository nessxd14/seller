import type { QuoteDraft } from '../shared/models'
import type { LocalRepository } from '../../infrastructure/mock/localStore'
import { convertQuoteToOrder } from '../../domain/orders/quoteConversion'
import { money } from '../../domain/common/money'
import type { Quote } from '../../domain/quotations/entities'

export class QuoteService {
  constructor(private readonly repository: LocalRepository<QuoteDraft>) {}
  list() { return this.repository.list() }
  async save(quote: QuoteDraft) {
    const existing = await this.repository.get(quote.id)
    if (existing?.status === 'converted') throw new Error('Una cotización convertida no puede editarse')
    return this.repository.save(quote)
  }
  async duplicate(id: string) {
    const source = await this.repository.get(id)
    if (!source) throw new Error('Cotización no encontrada')
    const copy = { ...structuredClone(source), id: crypto.randomUUID(), number: `COT-MOCK-${Date.now().toString().slice(-6)}`, status: 'draft' as const, createdAt: new Date().toISOString() }
    return this.repository.save(copy)
  }
  async markConverted(id: string, orderId: string) {
    const source = await this.repository.get(id)
    if (!source || source.status !== 'approved') throw new Error('Solo se convierte una cotización aprobada')
    const domainQuote: Quote = { id: source.id, number: source.number, status: 'approved', customer: { customerId: source.customerId, name: source.customerName }, terms: { channel: source.channel, priceListId: `list-${source.channel}`, paymentTerms: source.terms, notes: source.notes }, validUntil: source.validUntil, createdAt: source.createdAt, items: source.lines.map((line) => ({ id: line.id, quoteId: source.id, product: { productId: line.productId, name: line.name, sku: line.sku, identifiers: [line.sku] }, quantity: line.quantity, listPrice: money(line.unitPriceCents), appliedPrice: money(line.unitPriceCents), discountBasisPoints: line.discountBasisPoints, taxes: [] })) }
    const snapshotOrder = convertQuoteToOrder(domainQuote, orderId, `PED-MOCK-${Date.now().toString().slice(-5)}`, new Date().toISOString())
    await this.repository.save({ ...source, status: 'converted' })
    return snapshotOrder
  }
}

