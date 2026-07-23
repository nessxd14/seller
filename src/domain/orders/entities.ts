import type { HistoricalLineSnapshot, CustomerSnapshot, CommercialTermsSnapshot, EntityId, ISODateTime } from '../common/types'
import type { InventoryAllocation } from '../inventory/entities'

export type SalesOrderStatus = 'draft' | 'confirmed' | 'awaiting_stock' | 'reserved' | 'preparing' | 'ready' | 'dispatched' | 'delivered' | 'cancelled'
export interface SalesOrderItem extends HistoricalLineSnapshot { id: EntityId; orderId: EntityId; allocations: InventoryAllocation[] }
export interface SalesOrder { id: EntityId; number: string; status: SalesOrderStatus; customer: CustomerSnapshot; terms: CommercialTermsSnapshot; items: SalesOrderItem[]; sourceQuoteId?: EntityId; createdAt: ISODateTime }
export interface Fulfillment { id: EntityId; orderId: EntityId; status: 'pending' | 'picking' | 'packed' | 'ready' | 'completed' | 'cancelled'; preparedByUserId?: EntityId; startedAt?: ISODateTime; completedAt?: ISODateTime }
export interface Delivery { id: EntityId; orderId: EntityId; status: 'pending' | 'dispatched' | 'delivered' | 'failed' | 'cancelled'; recipientName?: string; dispatchedAt?: ISODateTime; deliveredAt?: ISODateTime }

