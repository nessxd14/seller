import type { AuditLog } from './auditing/entities'
import type { CashMovement, CashRegister, CashSession } from './cash/entities'
import type { Customer } from './customers/entities'
import type { InventoryMovement, InventoryReservation, StockBalance } from './inventory/entities'
import type { SalesOrder } from './orders/entities'
import type { Payment } from './payments/entities'
import type { Product, ProductPresentation } from './products/entities'
import type { Quote } from './quotations/entities'
import type { Sale } from './sales/entities'
import type { EntityId } from './common/types'

export interface ProductRepository { findById(id: EntityId): Promise<Product | null>; search(query: string): Promise<Product[]>; listPresentations(productId: EntityId): Promise<ProductPresentation[]> }
export interface CustomerRepository { findById(id: EntityId): Promise<Customer | null>; search(query: string): Promise<Customer[]> }
export interface InventoryRepository { getBalances(productId: EntityId): Promise<StockBalance[]>; saveMovement(movement: InventoryMovement): Promise<void>; saveReservation(reservation: InventoryReservation): Promise<void> }
export interface QuoteRepository { findById(id: EntityId): Promise<Quote | null>; save(quote: Quote): Promise<void> }
export interface OrderRepository { findById(id: EntityId): Promise<SalesOrder | null>; save(order: SalesOrder): Promise<void> }
export interface SaleRepository { findById(id: EntityId): Promise<Sale | null>; findByIdempotencyKey(key: string): Promise<Sale | null>; save(sale: Sale): Promise<void> }
export interface PaymentRepository { findByIdempotencyKey(key: string): Promise<Payment | null>; save(payment: Payment): Promise<void> }
export interface CashRepository { getRegister(id: EntityId): Promise<CashRegister | null>; getOpenSession(registerId: EntityId): Promise<CashSession | null>; saveMovement(movement: CashMovement): Promise<void> }
export interface AuditRepository { append(entry: AuditLog): Promise<void> }

