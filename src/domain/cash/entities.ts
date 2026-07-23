import type { Money } from '../common/money'
import type { EntityId, ISODateTime } from '../common/types'

export interface CashRegister { id: EntityId; name: string; locationId: EntityId; active: boolean }
export interface CashSession { id: EntityId; cashRegisterId: EntityId; openedByUserId: EntityId; openedAt: ISODateTime; openingAmount: Money; status: 'open' | 'closed'; closedAt?: ISODateTime; closingAmount?: Money }
export interface CashMovement { id: EntityId; cashSessionId: EntityId; type: 'sale_payment' | 'refund' | 'deposit' | 'withdrawal' | 'adjustment'; amount: Money; occurredAt: ISODateTime; referenceId?: EntityId; reason?: string; userId: EntityId }

