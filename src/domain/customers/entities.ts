import type { EntityId, ISODateTime } from '../common/types'

// Brief M: 'corporate' agregado por consistencia con application/shared/models.ts'
// CustomerRecord['type']. Verificado — este tipo no se importa en ningún lado activo
// (solo CustomerRecord['type'] se usa en la práctica); código muerto, se deja como está.
export type CustomerType = 'retail' | 'wholesale' | 'institutional' | 'corporate'
export interface Customer { id: EntityId; name: string; taxId?: string; type: CustomerType; active: boolean; creditEnabled: boolean; creditLimitCents?: number; createdAt: ISODateTime }

