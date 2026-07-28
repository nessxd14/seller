import { ChevronDown, FileText, HandCoins, Pause, ReceiptText, RotateCcw, ShoppingCart, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { usePos } from '../context/PosContext'
import type { CartItem as CartItemType } from '../types'
import { CartItem } from './CartItem'
import { EditCartItemModal } from './EditCartItemModal'
import { PaymentModal } from './PaymentModal'
import { TicketPreviewModal } from './TicketPreviewModal'
import { CustomerPicker } from './CustomerPicker'
import { CartReview } from './CartReview'
import type { QuoteDraft, WorkflowLine } from '../application/shared/models'
import type { PendingTransferRequest } from '../features/transfers/TransfersPage'
import { featureFlags } from '../config/featureFlags'
import { useCashSession } from '../context/CashSessionContext'
import { getStockByProduct } from '../infrastructure/services'
import { aggregateStockBySucursal } from '../features/inventory/stockAggregation'
import { isLineUnpriced } from '../domain/sales/priceCheck'

const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const channelNames = { retail: 'Retail', mayoreo: 'Mayoreo', institucional: 'Institucional', municipal: 'Municipal' }

export function CartPanel({ notify, onOpenDraftOrder, onGoToCash, sellerName, onRequestTransfer }: { notify: (message: string) => void; onOpenDraftOrder: (draft: QuoteDraft) => void; onGoToCash: () => void; sellerName?: string; onRequestTransfer?: (request: PendingTransferRequest) => void }) {
  const { channel, cart, subtotal, total, discount, setDiscount, operationNumber, clearCart, restoreSuspended, updateItem, customer } = usePos()
  const { sessionId } = useCashSession()
  const cashClosed = channel === 'retail' && featureFlags.supabase && !sessionId
  const [editing, setEditing] = useState<CartItemType | null>(null)
  // TAREA 3: collapse state for the breakdown (subtotal/discount) rows — the total
  // itself never hides. sessionStorage (not localStorage): "persiste entre ventas en
  // la sesión" — survives navigating between sales within the same tab/session, but
  // a fresh browser session (new tab/reload of the whole app after closing it) is
  // fine to reset, unlike this codebase's roari-* localStorage keys which are truly
  // persistent across reloads.
  const [summaryCollapsed, setSummaryCollapsed] = useState(() => sessionStorage.getItem('roari-cart-summary-collapsed') === '1')
  useEffect(() => { sessionStorage.setItem('roari-cart-summary-collapsed', summaryCollapsed ? '1' : '0') }, [summaryCollapsed])
  // Origin-toggle stock cache (item 5): per-productId, fetched/read once and kept for the
  // cart panel's lifetime so switching items or re-rendering doesn't refetch repeatedly.
  const [originStock, setOriginStock] = useState<Record<number, { tienda: number; almacen: number }>>({})
  useEffect(() => {
    if (channel !== 'retail') return
    const missing = cart.filter((item) => !(item.id in originStock))
    if (!missing.length) return
    if (!featureFlags.supabase) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mock mode reads stock straight off the already-loaded Product fields, no async fetch to defer to a callback
      setOriginStock((prev) => { const next = { ...prev }; missing.forEach((item) => { next[item.id] = { tienda: item.stockTienda, almacen: item.stockAlmacen } }); return next })
      return
    }
    void Promise.all(missing.map((item) => getStockByProduct(item.id).then((result) => {
      const agg = aggregateStockBySucursal(result.onHand)
      return [item.id, { tienda: agg.tienda, almacen: agg.almacen }] as const
    }))).then((entries) => setOriginStock((prev) => ({ ...prev, ...Object.fromEntries(entries) })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, channel])
  const insufficientOrigin = channel === 'retail' && cart.some((item) => {
    const stock = originStock[item.id]
    if (!stock) return false
    return (item.ubicacion === 'Tienda' ? stock.tienda : stock.almacen) < item.cantidad
  })
  // TAREA A: no line can be checked out at Bs 0 — adding an unpriced product to the cart is
  // fine, this only blocks at checkout time, mirroring insufficientOrigin's exact shape.
  const unpricedItems = cart.filter((item) => isLineUnpriced(item))
  const unpricedLine = unpricedItems.length > 0
  // Names the first offender specifically (brief's exact copy pattern) rather than a generic
  // "hay líneas con problema" — a trailing note covers the (rare) multi-line case without
  // stacking a full banner per unpriced line.
  const unpricedBannerText = unpricedItems.length
    ? `${unpricedItems[0].nombre} no tiene precio. Escribilo en la línea para poder cobrar.${unpricedItems.length > 1 ? ` (y ${unpricedItems.length - 1} línea${unpricedItems.length > 2 ? 's' : ''} más sin precio)` : ''}`
    : ''
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [ticketOpen, setTicketOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const customerLabel = customer ? customer.name : 'Cliente de mostrador'
  const suspend = () => {
    if (!cart.length) return
    const date = new Date().toISOString()
    const legacy = { channel, cart, discount, date }
    localStorage.setItem('roari-suspended-sale', JSON.stringify(legacy))
    const sales = JSON.parse(localStorage.getItem('roari-suspended-sales-v2') || '[]') as unknown[]
    // TAREA 4: persist the selected customer alongside the rest of the suspended sale so
    // restoring it later doesn't silently drop back to "Cliente de mostrador."
    sales.unshift({
      id: crypto.randomUUID(),
      date,
      seller: sellerName || 'Usuario POS',
      channel,
      customer: customerLabel,
      cart,
      discount,
      total,
      customerId: customer?.id,
      customerName: customer?.name,
      customerDocument: customer?.documento,
    })
    localStorage.setItem('roari-suspended-sales-v2', JSON.stringify(sales))
    clearCart()
    notify('Venta suspendida y guardada localmente')
  }
  const restore = () => notify(restoreSuspended() ? 'Venta suspendida restaurada' : 'No se pudo restaurar la venta')
  const openDraft = () => {
    if (!cart.length) return
    const lines: WorkflowLine[] = cart.map((item) => ({
      id: crypto.randomUUID(),
      productId: String(item.id),
      name: item.nombre,
      sku: item.sku,
      quantity: item.cantidad,
      unitPriceCents: Math.round(item.precioAplicado * 100),
      discountBasisPoints: Math.round(item.descuento * 100),
      sourceLocation: 'Almacén',
    }))
    onOpenDraftOrder({
      id: featureFlags.supabase ? '' : crypto.randomUUID(),
      number: '',
      customerId: '',
      customerName: '',
      channel: channel as QuoteDraft['channel'],
      status: 'draft',
      validUntil: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
      terms: 'Contado',
      notes: '',
      generalDiscountCents: Math.round(discount * 100),
      createdAt: new Date().toISOString(),
      lines,
    })
  }
  return <aside className="cart-panel"><div className="cart-header"><div><span>OPERACIÓN ACTUAL</span><h2>Venta <b>#{operationNumber}</b></h2></div><span className="channel-badge">{channelNames[channel]}</span></div><div className="operation-meta"><span>{new Date().toLocaleDateString('es-BO', { day: '2-digit', month: 'short' })}</span><i /> <span>{new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</span></div><CustomerPicker channel={channel} notify={notify} />
    <div className="cart-list-heading"><span>Detalle de venta</span><b>{cart.reduce((sum, item) => sum + item.cantidad, 0)} artículos</b></div><div className="cart-list">{cart.length ? cart.map((item) => <CartItem item={item} key={item.id} onEdit={() => setEditing(item)} originStock={channel === 'retail' ? originStock[item.id] : undefined} onSetOrigin={channel === 'retail' ? (loc) => updateItem(item.id, { ubicacion: loc }) : undefined} onRequestTransfer={channel === 'retail' && onRequestTransfer ? (shortfall) => onRequestTransfer({ productId: String(item.id), productName: item.nombre, productSku: item.sku, quantity: shortfall }) : undefined} />) : <div className="empty-cart"><div><ShoppingCart /></div><h3>Tu carrito está vacío</h3><p>Agrega productos del catálogo para comenzar una venta.</p></div>}</div>
    <div className="cart-summary">
      <div className={`cart-summary-breakdown ${summaryCollapsed ? 'collapsed' : ''}`}>
        <div className="cart-summary-breakdown-inner">
          <div><span>Subtotal</span><strong>Bs {money(subtotal)}</strong></div>
          <div className="discount-line"><label>Descuento</label><span>Bs <input aria-label="Descuento general" type="number" min="0" max={subtotal} value={discount || ''} placeholder="0.00" onChange={(e) => setDiscount(Math.min(subtotal, Math.max(0, Number(e.target.value))))} /></span></div>
        </div>
      </div>
      <div className="grand-total">
        <span>Total</span>
        <strong>Bs {money(total)}</strong>
        <button
          type="button"
          className="summary-collapse-toggle"
          aria-label={summaryCollapsed ? 'Desplegar resumen' : 'Plegar resumen'}
          aria-expanded={!summaryCollapsed}
          onClick={() => setSummaryCollapsed((v) => !v)}
        >
          <ChevronDown className={summaryCollapsed ? '' : 'chevron-open'} />
        </button>
      </div>
      <small>Precios con impuestos incluidos según configuración</small>
    </div>
    <div className="cart-actions">{!cart.length && Boolean(localStorage.getItem('roari-suspended-sale')) && <button className="restore-button" onClick={restore}><RotateCcw /> Restaurar venta suspendida</button>}{channel === 'retail' ? <><div className="secondary-actions secondary-actions-3"><button data-pos-action="suspend" onClick={suspend} disabled={!cart.length}><Pause /> Suspender</button><button onClick={() => setTicketOpen(true)} disabled={!cart.length}><ReceiptText /> Ticket</button><button onClick={() => setReviewOpen(true)} disabled={!cart.length}><Sparkles /> Revisar</button></div>{cashClosed && <button className="cash-closed-notice" onClick={onGoToCash}>Caja cerrada — abrí la caja para poder cobrar</button>}{insufficientOrigin && <p className="cash-closed-notice">Hay líneas sin stock suficiente en la ubicación elegida — corrígelas para poder cobrar.</p>}{unpricedLine && <p className="cash-closed-notice">{unpricedBannerText}</p>}<button data-pos-action="pay" className="pay-button" disabled={!cart.length || cashClosed || insufficientOrigin || unpricedLine} onClick={() => setPaymentOpen(true)}><HandCoins /> Cobrar <span>Bs {money(total)}</span></button></> : <><button className="draft-button" disabled={!cart.length} onClick={openDraft}><FileText /> Guardar borrador</button><div className="secondary-actions"><button disabled={!cart.length} onClick={openDraft}>Cotización</button><button disabled={!cart.length} onClick={openDraft}>Crear pedido</button></div>{unpricedLine && <p className="cash-closed-notice">{unpricedBannerText}</p>}<button data-pos-action="pay" className="pay-button" disabled={!cart.length || (channel === 'mayoreo' && unpricedLine)} onClick={() => channel === 'mayoreo' ? setPaymentOpen(true) : notify('Anticipo creado en modo demostración')}><HandCoins /> {channel === 'mayoreo' ? 'Cobrar' : 'Registrar anticipo'} <span>Bs {money(total)}</span></button></>}</div>
    {editing && <EditCartItemModal item={editing} onClose={() => setEditing(null)} />}{paymentOpen && <PaymentModal onClose={() => setPaymentOpen(false)} />}{ticketOpen && <TicketPreviewModal onClose={() => setTicketOpen(false)} />}
    {reviewOpen && <CartReview items={cart} channel={channel} originStock={originStock} customer={customer} subtotal={subtotal} discount={discount} total={total} onClose={() => setReviewOpen(false)} onCheckout={() => { setReviewOpen(false); setPaymentOpen(true) }} />}
  </aside>
}
