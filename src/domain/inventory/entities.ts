import type { EntityId, ISODateTime, InventoryLocationCode } from '../common/types'

export interface InventoryLocation { id: EntityId; code: InventoryLocationCode; name: string; active: boolean }
export interface StockBalance { productId: EntityId; variantId?: EntityId; locationId: EntityId; stockFisico: number; stockReservado: number; stockEnTransito: number; stockDanado: number; updatedAt: ISODateTime }
export type InventoryMovementType = 'receipt' | 'sale' | 'return' | 'transfer_out' | 'transfer_in' | 'positive_adjustment' | 'negative_adjustment' | 'damaged' | 'damage_recovery'
export interface InventoryMovement { id: EntityId; productId: EntityId; variantId?: EntityId; locationId: EntityId; type: InventoryMovementType; quantity: number; occurredAt: ISODateTime; referenceType: string; referenceId: EntityId; reason?: string; createdByUserId: EntityId }
export interface InventoryReservation { id: EntityId; orderId: EntityId; orderItemId: EntityId; productId: EntityId; variantId?: EntityId; locationId: EntityId; quantity: number; status: 'active' | 'released' | 'consumed' | 'cancelled'; createdAt: ISODateTime; releasedAt?: ISODateTime }
export interface InventoryAllocation { id: EntityId; documentItemId: EntityId; locationId: EntityId; quantity: number; reservationId?: EntityId }
export type StockTransferStatus = 'requested' | 'approved' | 'preparing' | 'in_transit' | 'received' | 'cancelled'
export interface StockTransfer { id: EntityId; fromLocationId: EntityId; toLocationId: EntityId; status: StockTransferStatus; items: { productId: EntityId; variantId?: EntityId; quantity: number }[]; createdAt: ISODateTime }

