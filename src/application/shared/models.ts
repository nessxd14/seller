import type { SalesChannel } from '../../domain/common/types'

export type UiStatus = 'idle' | 'loading' | 'error' | 'success'
export type QuoteWorkflowStatus = 'draft' | 'sent' | 'negotiating' | 'approved' | 'rejected' | 'expired' | 'converted'
export type OrderWorkflowStatus = 'draft' | 'confirmed' | 'awaiting_stock' | 'reserved' | 'preparing' | 'ready' | 'dispatched' | 'delivered' | 'cancelled'

export interface WorkflowLine {
  id: string
  productId: string
  name: string
  sku: string
  quantity: number
  unitPriceCents: number
  discountBasisPoints: number
  // Optional Supabase-backed extensions (all optional so mock consumers are unaffected):
  listPriceCents?: number
  isCustomItem?: boolean
  note?: string
  sourceLocation?: 'Tienda' | 'Almacén'
  priceOverridden?: boolean
  modifiedBy?: string
  modifiedAt?: string
}

export interface QuoteDraft {
  id: string
  number: string
  customerId: string
  customerName: string
  channel: Extract<SalesChannel, 'mayoreo' | 'institucional' | 'municipal'>
  status: QuoteWorkflowStatus
  validUntil: string
  terms: string
  notes: string
  generalDiscountCents: number
  createdAt: string
  lines: WorkflowLine[]
}

export interface OrderView {
  id: string
  number: string
  customerName: string
  channel: Extract<SalesChannel, 'mayoreo' | 'institucional' | 'municipal'>
  status: OrderWorkflowStatus
  createdAt: string
  sourceQuoteId?: string
  lines: Array<WorkflowLine & { prepared: number; allocations: { location: 'Tienda' | 'Almacén'; quantity: number }[] }>
  events: { at: string; label: string; detail: string }[]
}

export interface CustomerRecord {
  id: string
  name: string
  type: 'retail' | 'wholesale' | 'institutional' | 'municipal'
  document: string
  phone: string
  email: string
  address: string
  usualChannel: SalesChannel
  paymentTerms: string
  creditLimitCents: number
  pendingBalanceCents: number
}

export interface CashSessionRecord {
  id: string
  register: string
  openedAt: string
  openingCents: number
  status: 'open' | 'closed'
  movements: { id: string; type: 'income' | 'expense'; method: 'cash' | 'qr' | 'transfer'; amountCents: number; note: string; at: string }[]
  countedCents?: number
  closedAt?: string
  // Optional Supabase-backed extension: cerrar_caja's computed difference (contado -
  // esperado), persisted on sesion_caja.diferencia. Undefined in mock mode.
  differenceCents?: number
}

