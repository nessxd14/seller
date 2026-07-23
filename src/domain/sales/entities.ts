import type { CommercialTermsSnapshot, CustomerSnapshot, EntityId, HistoricalLineSnapshot, ISODateTime, PriceOverrideAudit } from '../common/types'
import type { InventoryAllocation } from '../inventory/entities'

export type SaleStatus = 'pending_payment' | 'partially_paid' | 'paid' | 'cancelled' | 'partially_returned' | 'returned'
export interface SaleItem extends HistoricalLineSnapshot { id: EntityId; saleId: EntityId; allocations: InventoryAllocation[]; priceOverride?: PriceOverrideAudit }
export interface Sale { id: EntityId; number: string; status: SaleStatus; customer: CustomerSnapshot; terms: CommercialTermsSnapshot; items: SaleItem[]; originalTotalCents: number; paidAmountCents: number; pendingBalanceCents: number; sourceOrderId?: EntityId; createdAt: ISODateTime; idempotencyKey: string }
export interface ReturnItem { id: EntityId; returnId: EntityId; saleItemId: EntityId; quantity: number; reason: string; restockLocationId?: EntityId }
export interface Return { id: EntityId; saleId: EntityId; items: ReturnItem[]; status: 'draft' | 'approved' | 'completed' | 'cancelled'; createdAt: ISODateTime }

