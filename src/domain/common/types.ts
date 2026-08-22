import type { Money } from './money'

export type EntityId = string
export type ISODateTime = string
export type SalesChannel = 'retail' | 'mayoreo' | 'institucional' | 'corporativo'
export type InventoryLocationCode = 'tienda' | 'almacen'
export type TaxSnapshot = { name: string; rateBasisPoints: number; includedInPrice: boolean; amount: Money }
export type CustomerSnapshot = { customerId?: EntityId; name: string; taxId?: string; type?: string }
export type ProductSnapshot = { productId: EntityId; variantId?: EntityId; name: string; sku: string; identifiers: string[] }
export type CommercialTermsSnapshot = { channel: SalesChannel; priceListId: EntityId; paymentTerms?: string; notes?: string }

export interface HistoricalLineSnapshot {
  product: ProductSnapshot
  quantity: number
  listPrice: Money
  appliedPrice: Money
  discountBasisPoints: number
  taxes: TaxSnapshot[]
}

export interface PriceOverrideAudit {
  originalPrice: Money
  appliedPrice: Money
  changedByUserId: EntityId
  reason: string
  changedAt: ISODateTime
  authorizedByUserId?: EntityId
}

export const assertPositiveQuantity = (quantity: number) => {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('La cantidad debe ser un entero mayor o igual a uno')
}

