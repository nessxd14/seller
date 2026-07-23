import type { Quote } from '../quotations/entities'
import type { SalesOrder } from './entities'

export const convertQuoteToOrder = (quote: Quote, orderId: string, orderNumber: string, createdAt: string): SalesOrder => {
  if (quote.status !== 'approved') throw new Error('Solo una cotización aprobada puede convertirse en pedido')
  return { id: orderId, number: orderNumber, status: 'draft', customer: structuredClone(quote.customer), terms: structuredClone(quote.terms), items: quote.items.map((item) => ({ ...structuredClone(item), id: `${orderId}-${item.id}`, orderId, allocations: [] })), sourceQuoteId: quote.id, createdAt }
}

