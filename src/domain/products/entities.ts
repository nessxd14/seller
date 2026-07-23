import type { EntityId, ISODateTime } from '../common/types'

export type ProductIdentifierType = 'sku' | 'barcode' | 'factory_code'
export interface ProductIdentifier { id: EntityId; productId: EntityId; variantId?: EntityId; type: ProductIdentifierType; value: string }
export interface Category { id: EntityId; name: string; parentId?: EntityId; active: boolean }
export interface Product { id: EntityId; name: string; description: string; categoryId: EntityId; active: boolean; createdAt: ISODateTime; updatedAt: ISODateTime }
export interface ProductPresentation { id: EntityId; productId: EntityId; name: string; unit: string; unitsPerPresentation: number; identifiers: ProductIdentifier[]; active: boolean }

