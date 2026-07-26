import { ChevronDown, CircleUserRound, FileText, HandCoins, Pause, ReceiptText, RotateCcw, ShoppingCart } from 'lucide-react'
import { useEffect, useState } from 'react'
import { usePos } from '../context/PosContext'
import type { CartItem as CartItemType } from '../types'
import { CartItem } from './CartItem'
import { EditCartItemModal } from './EditCartItemModal'
import { PaymentModal } from './PaymentModal'
import { TicketPreviewModal } from './TicketPreviewModal'
import type { QuoteDraft, WorkflowLine } from '../application/shared/models'
import { featureFlags } from '../config/featureFlags'
import { useCashSession } from '../context/CashSessionContext'
import { getStockByProduct } from '../infrastructure/services'
import { aggregateStockBySucursal } from '../features/inventory/stockAggregation'

const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const channelNames = { retail: 'Retail', mayoreo: 'Mayoreo', institucional: 'Institucional', municipal: 'Municipal' }

export function CartPanel({ notify, onOpenDraftOrder, onGoToCash }: { notify: (message: string) => void; onOpenDraftOrder: (draft: QuoteDraft) => void; onGoToCash: () => void }) {
  const { channel, cart, subtotal, total, discount, setDiscount, operationNumber, clearCart, restoreSuspended, updateItem } = usePos()
  const { sessionId } = useCashSession()
  const cashClosed = channel === 'retail' && featureFlags.supabase && !sessionId
  const [editing, setEditing] = useState<CartItemType | null>(null)
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
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [ticketOpen, setTicketOpen] = useState(false)
  const customer = channel === 'retail' ? 'Cliente de mostrador' : 'Seleccionar cliente'
  const suspend = () => {
    if (!cart.length) return
    const date = new Date().toISOString()
    const legacy = { channel, cart, discount, date }
    localStorage.setItem('roari-suspended-sale', JSON.stringify(legacy))
    const sales = JSON.parse(localStorage.getItem('roari-suspended-sales-v2') || '[]') as unknown[]
    sales.unshift({ id: crypto.randomUUID(), date, seller: 'Natalia S.', channel, customer: channel === 'retail' ? 'Cliente de mostrador' : 'Cliente seleccionado', cart, discount, total })
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
  return <aside className="cart-panel"><div className="cart-header"><div><span>OPERACIÓN ACTUAL</span><h2>Venta <b>#{operationNumber}</b></h2></div><span className="channel-badge">{channelNames[channel]}</span></div><div className="operation-meta"><span>{new Date().toLocaleDateString('es-BO', { day: '2-digit', month: 'short' })}</span><i /> <span>{new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</span></div><button className={`customer-select ${channel !== 'retail' ? 'required' : ''}`}><CircleUserRound /><span><small>CLIENTE</small><strong>{customer}</strong></span><ChevronDown /></button>
    <div className="cart-list-heading"><span>Detalle de venta</span><b>{cart.reduce((sum, item) => sum + item.cantidad, 0)} artículos</b></div><div className="cart-list">{cart.length ? cart.map((item) => <CartItem item={item} key={item.id} onEdit={() => setEditing(item)} originStock={channel === 'retail' ? originStock[item.id] : undefined} onSetOrigin={channel === 'retail' ? (loc) => updateItem(item.id, { ubicacion: loc }) : undefined} />) : <div className="empty-cart"><div><ShoppingCart /></div><h3>Tu carrito está vacío</h3><p>Agrega productos del catálogo para comenzar una venta.</p></div>}</div>
    <div className="cart-summary"><div><span>Subtotal</span><strong>Bs {money(subtotal)}</strong></div><div className="discount-line"><label>Descuento</label><span>Bs <input aria-label="Descuento general" type="number" min="0" max={subtotal} value={discount || ''} placeholder="0.00" onChange={(e) => setDiscount(Math.min(subtotal, Math.max(0, Number(e.target.value))))} /></span></div><div className="grand-total"><span>Total</span><strong>Bs {money(total)}</strong></div><small>Precios con impuestos incluidos según configuración</small></div>
    <div className="cart-actions">{!cart.length && Boolean(localStorage.getItem('roari-suspended-sale')) && <button className="restore-button" onClick={restore}><RotateCcw /> Restaurar venta suspendida</button>}{channel === 'retail' ? <><div className="secondary-actions"><button data-pos-action="suspend" onClick={suspend} disabled={!cart.length}><Pause /> Suspender</button><button onClick={() => setTicketOpen(true)} disabled={!cart.length}><ReceiptText /> Ticket</button></div>{cashClosed && <button className="cash-closed-notice" onClick={onGoToCash}>Caja cerrada — abrí la caja para poder cobrar</button>}{insufficientOrigin && <p className="cash-closed-notice">Hay líneas sin stock suficiente en la ubicación elegida — corrígelas para poder cobrar.</p>}<button data-pos-action="pay" className="pay-button" disabled={!cart.length || cashClosed || insufficientOrigin} onClick={() => setPaymentOpen(true)}><HandCoins /> Cobrar <span>Bs {money(total)}</span></button></> : <><button className="draft-button" disabled={!cart.length} onClick={openDraft}><FileText /> Guardar borrador</button><div className="secondary-actions"><button disabled={!cart.length} onClick={openDraft}>Cotización</button><button disabled={!cart.length} onClick={openDraft}>Crear pedido</button></div><button data-pos-action="pay" className="pay-button" disabled={!cart.length} onClick={() => channel === 'mayoreo' ? setPaymentOpen(true) : notify('Anticipo creado en modo demostración')}><HandCoins /> {channel === 'mayoreo' ? 'Cobrar' : 'Registrar anticipo'} <span>Bs {money(total)}</span></button></>}</div>
    {editing && <EditCartItemModal item={editing} onClose={() => setEditing(null)} />}{paymentOpen && <PaymentModal onClose={() => setPaymentOpen(false)} />}{ticketOpen && <TicketPreviewModal onClose={() => setTicketOpen(false)} />}
  </aside>
}
