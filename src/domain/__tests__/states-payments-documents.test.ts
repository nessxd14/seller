import { describe, expect, it } from 'vitest'
import { money } from '../common/money'
import { assertTransition, canTransition, orderTransitions, quoteTransitions, saleTransitions } from '../common/stateMachine'
import { convertQuoteToOrder } from '../orders/quoteConversion'
import { paymentSummary, validateMixedPayment } from '../payments/paymentService'
import type { Quote } from '../quotations/entities'

describe('estados, pagos y documentos', () => {
  it('acepta transiciones válidas y rechaza inválidas', () => {
    expect(canTransition(quoteTransitions, 'approved', 'converted')).toBe(true)
    expect(canTransition(orderTransitions, 'draft', 'delivered')).toBe(false)
    expect(() => assertTransition(saleTransitions, 'paid', 'pending_payment')).toThrow('Transición inválida')
  })
  it('distingue pago parcial y completo', () => {
    expect(paymentSummary(money(1000), [{ id: 'a1', paymentId: 'p1', documentType: 'sale', documentId: 's1', amount: money(400), allocatedAt: '2026-07-22' }]).status).toBe('partially_paid')
    expect(paymentSummary(money(1000), [{ id: 'a1', paymentId: 'p1', documentType: 'sale', documentId: 's1', amount: money(1000), allocatedAt: '2026-07-22' }]).status).toBe('paid')
  })
  it('valida pago mixto exacto', () => {
    expect(validateMixedPayment(money(1000), [{ method: 'cash', amount: money(400) }, { method: 'qr', amount: money(600) }]).cents).toBe(1000)
    expect(() => validateMixedPayment(money(1000), [{ method: 'cash', amount: money(400) }, { method: 'qr', amount: money(500) }])).toThrow('exactamente')
  })
  it('convierte cotización sin perder snapshots', () => {
    const quote: Quote = { id: 'q1', number: 'C-1', status: 'approved', customer: { customerId: 'c1', name: 'Colegio ROARI' }, terms: { channel: 'institucional', priceListId: 'pi' }, validUntil: '2026-08-01', createdAt: '2026-07-22', items: [{ id: 'qi1', quoteId: 'q1', product: { productId: 'p1', name: 'Cuaderno', sku: 'CUA-1', identifiers: ['777'] }, quantity: 30, listPrice: money(1800), appliedPrice: money(1600), discountBasisPoints: 0, taxes: [] }] }
    const order = convertQuoteToOrder(quote, 'o1', 'P-1', '2026-07-22')
    quote.items[0].product.name = 'Nombre cambiado'
    expect(order.items[0].product.name).toBe('Cuaderno')
    expect(order.sourceQuoteId).toBe('q1')
  })
})
