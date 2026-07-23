import type { Money } from '../common/money'
import type { EntityId, ISODateTime } from '../common/types'

export type PaymentMethod = 'cash' | 'qr' | 'transfer' | 'credit' | 'advance' | 'mixed'
export type PaymentStatus = 'pending' | 'confirmed' | 'voided' | 'failed'
export interface Payment { id: EntityId; method: PaymentMethod; amount: Money; status: PaymentStatus; paidAt?: ISODateTime; reference?: string; idempotencyKey: string; components?: PaymentComponent[] }
export interface PaymentComponent { method: Exclude<PaymentMethod, 'mixed'>; amount: Money; reference?: string }
export interface PaymentAllocation { id: EntityId; paymentId: EntityId; documentType: 'sale' | 'order'; documentId: EntityId; amount: Money; allocatedAt: ISODateTime }

