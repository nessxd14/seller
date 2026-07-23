import type { HistoricalLineSnapshot, CustomerSnapshot, CommercialTermsSnapshot, EntityId, ISODateTime } from '../common/types'

export type QuoteStatus = 'draft' | 'sent' | 'negotiating' | 'approved' | 'rejected' | 'expired' | 'converted'
export interface QuoteItem extends HistoricalLineSnapshot { id: EntityId; quoteId: EntityId }
export interface Quote { id: EntityId; number: string; status: QuoteStatus; customer: CustomerSnapshot; terms: CommercialTermsSnapshot; items: QuoteItem[]; validUntil: ISODateTime; createdAt: ISODateTime; convertedOrderId?: EntityId }

