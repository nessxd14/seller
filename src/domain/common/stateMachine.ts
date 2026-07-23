import type { QuoteStatus } from '../quotations/entities'
import type { SalesOrderStatus } from '../orders/entities'
import type { SaleStatus } from '../sales/entities'
import type { StockTransferStatus } from '../inventory/entities'

type TransitionMap<T extends string> = Record<T, readonly T[]>
export const quoteTransitions: TransitionMap<QuoteStatus> = { draft: ['sent', 'rejected'], sent: ['negotiating', 'approved', 'rejected', 'expired'], negotiating: ['sent', 'approved', 'rejected', 'expired'], approved: ['converted', 'expired'], rejected: [], expired: [], converted: [] }
export const orderTransitions: TransitionMap<SalesOrderStatus> = { draft: ['confirmed', 'cancelled'], confirmed: ['awaiting_stock', 'reserved', 'cancelled'], awaiting_stock: ['reserved', 'cancelled'], reserved: ['preparing', 'cancelled'], preparing: ['ready', 'cancelled'], ready: ['dispatched', 'delivered', 'cancelled'], dispatched: ['delivered'], delivered: [], cancelled: [] }
export const saleTransitions: TransitionMap<SaleStatus> = { pending_payment: ['partially_paid', 'paid', 'cancelled'], partially_paid: ['paid', 'cancelled'], paid: ['partially_returned', 'returned'], cancelled: [], partially_returned: ['returned'], returned: [] }
export const transferTransitions: TransitionMap<StockTransferStatus> = { requested: ['approved', 'cancelled'], approved: ['preparing', 'cancelled'], preparing: ['in_transit', 'cancelled'], in_transit: ['received'], received: [], cancelled: [] }
export const canTransition = <T extends string>(map: TransitionMap<T>, from: T, to: T) => map[from].includes(to)
export const assertTransition = <T extends string>(map: TransitionMap<T>, from: T, to: T) => { if (!canTransition(map, from, to)) throw new Error(`Transición inválida: ${from} → ${to}`) }
