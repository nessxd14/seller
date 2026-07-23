import type { EntityId, ISODateTime } from '../common/types'

export type CustomerType = 'retail' | 'wholesale' | 'institutional'
export interface Customer { id: EntityId; name: string; taxId?: string; type: CustomerType; active: boolean; creditEnabled: boolean; creditLimitCents?: number; createdAt: ISODateTime }

