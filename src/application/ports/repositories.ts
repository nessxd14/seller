import type { CashSessionRecord, CustomerRecord, OrderView, QuoteDraft } from '../shared/models'
import type { Product } from '../../types'

export interface PageRequest { page:number; pageSize:number }
export interface Page<T> { items:T[]; page:number; pageSize:number; total:number }
export interface Versioned { version:number; updatedAt:string }
export interface MutationContext { expectedVersion?:number; idempotencyKey?:string; actorId?:string }
export interface DateRange { from?:string; to?:string }
export interface SalePortRecord extends Versioned {
  id:string
  status:'pending_payment'|'confirmed'|'cancelled'
  totalCents:number
  paidCents:number
}
export interface PaymentPortRecord extends Versioned {
  id:string
  saleId:string
  status:'pending'|'confirmed'|'rejected'
  method:string
  amountCents:number
}

export interface ProductRepository {
  search(input:{query?:string;category?:string;active?:boolean;page:PageRequest}):Promise<Page<Product>>
  getById(id:string):Promise<Product|null>
}
export interface InventoryRepository {
  getAvailability(input:{productIds:string[];locationIds?:string[]}):Promise<Array<{productId:string;locationId:string;physical:number;reserved:number;available:number;updatedAt:string}>>
  simulateAllocation(input:{productId:string;quantity:number;preferredLocations:string[]}):Promise<{allocations:Array<{locationId:string;quantity:number}>;pending:number}>
}
export interface CustomerRepository {
  list(input:{query?:string;type?:CustomerRecord['type'];page:PageRequest}):Promise<Page<CustomerRecord & Versioned>>
  getById(id:string):Promise<(CustomerRecord & Versioned)|null>
  save(value:CustomerRecord & Partial<Versioned>,context:MutationContext):Promise<CustomerRecord & Versioned>
}
export interface QuoteRepository {
  list(input:{query?:string;status?:QuoteDraft['status'];channel?:QuoteDraft['channel'];dates?:DateRange;page:PageRequest}):Promise<Page<QuoteDraft & Versioned>>
  getById(id:string):Promise<(QuoteDraft & Versioned)|null>
  save(value:QuoteDraft & Partial<Versioned>,context:MutationContext):Promise<QuoteDraft & Versioned>
  duplicate(id:string,context:MutationContext):Promise<QuoteDraft & Versioned>
}
export interface OrderRepository {
  list(input:{query?:string;status?:OrderView['status'];channel?:OrderView['channel'];dates?:DateRange;page:PageRequest}):Promise<Page<OrderView & Versioned>>
  getById(id:string):Promise<(OrderView & Versioned)|null>
  save(value:OrderView & Partial<Versioned>,context:MutationContext):Promise<OrderView & Versioned>
}
export interface SaleCheckoutLine { productId:string; quantity:number; unitPriceCents:number; listPriceCents?:number }
export interface SaleCheckoutPayment { method:'cash'|'qr'|'transfer'; amountCents:number }
export interface SaleCheckoutResult { saleId:string; subtotalCents:number; discountCents:number; totalCents:number }
export interface SaleRepository {
  getById(id:string):Promise<SalePortRecord|null>
  confirm(id:string,context:MutationContext&{idempotencyKey:string}):Promise<SalePortRecord>
  cancel(id:string,reason:string,context:MutationContext&{idempotencyKey:string}):Promise<SalePortRecord>
  /**
   * Atomic checkout against the backend's `registrar_venta` RPC (lines + payments +
   * cash session in one call). Additive alongside the legacy confirm/cancel two-step
   * shape above, which the mock backend still uses.
   */
  checkout(input:{lines:SaleCheckoutLine[];payments:SaleCheckoutPayment[];cashSessionId:string;customerId?:string;discountCents?:number},context:MutationContext):Promise<SaleCheckoutResult>
}
// No Supabase adapter for this port — registrar_venta records payment atomically with the sale, there is no standalone payment step in the backend. Kept for the mock backend only.
export interface PaymentRepository {
  register(input:{saleId:string;method:string;amountCents:number;components?:Array<{method:string;amountCents:number}>},context:MutationContext&{idempotencyKey:string}):Promise<PaymentPortRecord>
}
export interface CashRepository {
  list(input:{register?:string;status?:CashSessionRecord['status'];page:PageRequest}):Promise<Page<CashSessionRecord & Versioned>>
  getById(id:string):Promise<(CashSessionRecord & Versioned)|null>
  open(input:{register:string;openingCents:number},context:MutationContext&{idempotencyKey:string}):Promise<CashSessionRecord & Versioned>
  close(id:string,countedCents:number,context:MutationContext&{idempotencyKey:string}):Promise<CashSessionRecord & Versioned>
  addMovement(sessionId:string,input:{type:'income'|'expense';method:'cash'|'qr'|'transfer';amountCents:number;note:string},context:MutationContext&{idempotencyKey:string}):Promise<CashSessionRecord & Versioned>
  registerAdvance(input:{orderId:string;amountCents:number;method:'cash'|'qr'|'transfer';sessionId:string},context:MutationContext&{idempotencyKey:string}):Promise<{movementId:string}>
}
export interface SuspendedSaleRepository<T extends {id:string}> {
  list(input:{query?:string;page:PageRequest}):Promise<Page<T & Versioned>>
  save(value:T & Partial<Versioned>,context:MutationContext):Promise<T & Versioned>
  getById(id:string):Promise<(T & Versioned)|null>
  remove(id:string,context:MutationContext):Promise<void>
}
