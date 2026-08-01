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
  // Presentation (item 3): quantity is always expressed in the currently selected
  // presentation's unit; factorUnidadBase (default 1 = base unit) converts it to base
  // units for stock validation and for cantidad_base when no presentacionId is set.
  presentacionId?: number
  presentacionNombre?: string
  factorUnidadBase?: number
  cantidadPresentacion?: number
  // Ronda 10 — TAREA 1: catalog-line-only "print name" mask (backed by cotizacion_linea/
  // pedido_linea.descripcion, same column es_personalizado items already used). `name`
  // always stays the real catalog product name — never overwritten — so despacho/picking
  // views and the editor keep showing it regardless of this field. Irrelevant when
  // isCustomItem is true (there, `name` already IS the free-text descripcion).
  maskName?: string
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
  // Item 3 bonus: quote-only fields backed by cotizacion.asunto/condicion_pago/fecha.
  // Optional/additive — undefined in mock mode and for older quote rows.
  asunto?: string
  conditionPago?: 'CONTADO' | 'PAGO_PARCIAL' | 'SIGEP' | 'TRANSFERENCIA_BANCARIA' | 'QR'
  documentDate?: string
}

export interface OrderView {
  id: string
  number: string
  customerId?: string
  customerName: string
  channel: Extract<SalesChannel, 'mayoreo' | 'institucional' | 'municipal'>
  status: OrderWorkflowStatus
  createdAt: string
  sourceQuoteId?: string
  lines: Array<WorkflowLine & { prepared: number; allocations: { location: 'Tienda' | 'Almacén'; quantity: number }[] }>
  events: { at: string; label: string; detail: string }[]
  // Mock backend only: remembers the status a cancelled order had before anulación,
  // so restore() can return it there instead of always defaulting to 'confirmed'.
  // Supabase mode doesn't need this field — restaurar_pedido() reads estado_previo
  // straight from pedido_evento.
  previousStatus?: OrderWorkflowStatus
  // Totales del encabezado (pedido.subtotal / descuento_general / total).
  // De IDA: generalDiscountCents es lo que se manda a crear_pedido.
  // De VUELTA: los tres se leen tal cual de la fila; son la verdad, no se
  // recalculan. Quedan undefined en modo mock y en pedidos sin precios
  // (crear_pedido deja el header en NULL si ninguna línea trae precio_unitario).
  subtotalCents?: number
  generalDiscountCents?: number
  totalCents?: number
}

export interface CustomerRecord {
  id: string
  name: string
  type: 'retail' | 'wholesale' | 'institutional' | 'corporate'
  document: string
  phone: string
  email: string
  address: string
  usualChannel: SalesChannel
  paymentTerms: string
  creditLimitCents: number
  pendingBalanceCents: number
  // Optional Supabase-backed extensions (all optional so mock consumers/seeds are
  // unaffected). origin: cliente.origen ('shopify' rows come from
  // scripts/bootstrap_clientes.mjs; everything else is 'manual'). businessName/city:
  // cliente.razon_social/ciudad.
  origin?: 'shopify' | 'manual'
  businessName?: string
  city?: string
}

// Traslados Almacén <-> Tienda (Parte 1). Mirrors solicitud_traslado/solicitud_traslado_linea
// closely rather than forcing it into the generic Versioned/CRUD repository shape — like
// SaleRepository/CashRepository, transfers are RPC-driven (create/receive/cancel actions,
// no optimistic-edit "save" verb) and solicitud_traslado has no version column.
// Brief J: DEVOLUCION added to the DB enum by 2026-07-30_traslado_devolucion_enum.sql
// (verified applied against production before adding this — see motivo_traslado in pg_enum).
export type TransferMotivo = 'VENTA_DIRECTA' | 'REPOSICION' | 'DEVOLUCION'
export type TransferEstado = 'SOLICITADO' | 'EN_TRANSITO' | 'RECIBIDO' | 'RECHAZADO' | 'CANCELADO'

export interface TransferLine {
  id: string
  productId: string
  name: string
  sku: string
  presentacionId?: number
  presentacionNombre?: string
  cantidadPresentacion?: number
  cantidadBase: number
  cantidadDespachada?: number
  cantidadRecibida?: number
  nota?: string
}

export interface TransferRecord {
  id: string
  motivo: TransferMotivo
  estado: TransferEstado
  sucursalOrigenId: number
  sucursalDestinoId: number
  referencia?: string
  nota?: string
  solicitadoPor: string
  solicitadoEn: string
  despachadoPor?: string
  despachadoEn?: string
  recibidoPor?: string
  recibidoEn?: string
  creadoEn: string
  // Brief K: solo tiene valor mientras estado === 'EN_TRANSITO' y la ventana de reversión
  // de 30 min (fijada por despachar_traslado, ver 2026-07-30_traslado_reversion.sql) sigue
  // abierta. Nunca hardcodear los 30 min en el frontend — se calcula contra esto.
  reversibleHasta?: string
  lines: TransferLine[]
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

