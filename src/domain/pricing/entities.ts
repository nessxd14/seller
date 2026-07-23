import type { Money } from '../common/money'
import type { EntityId, ISODateTime, SalesChannel } from '../common/types'

export interface PriceList { id: EntityId; name: string; channel: SalesChannel; validFrom: ISODateTime; validUntil?: ISODateTime; active: boolean }
export interface ProductPrice { id: EntityId; priceListId: EntityId; productId: EntityId; variantId?: EntityId; price: Money; minimumQuantity?: number }
export interface CustomerSpecialPrice { id: EntityId; customerId: EntityId; productId: EntityId; variantId?: EntityId; price: Money; validFrom: ISODateTime; validUntil?: ISODateTime; minimumQuantity?: number }

