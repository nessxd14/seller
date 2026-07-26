import { ChevronDown, CircleUserRound, FileText, HandCoins, Pause, ReceiptText, RotateCcw, ShoppingCart } from 'lucide-react'
import { useState } from 'react'
import { usePos } from '../context/PosContext'
import type { CartItem as CartItemType } from '../types'
import { CartItem } from './CartItem'
import { EditCartItemModal } from './EditCartItemModal'
import { PaymentModal } from './PaymentModal'
import { TicketPreviewModal } from './TicketPreviewModal'
import type { QuoteDraft, WorkflowLine } from '../application/shared/models'
import { featureFlags } from '../config/featureFlags'

const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const channelNames = { retail: 'Retail', mayoreo: 'Mayoreo', institucional: 'Institucional', municipal: 'Municipal' }

export function CartPanel({ notify, onOpenDraftOrder }: { notify: (message: string) => void; onOpenDraftOrder: (draft: QuoteDraft) => void }) {
  const { channel, cart, subtotal, total, discount, setDiscount, operationNumber, clearCart, restoreSuspended } = usePos()
  const [editing, setEditing] = useState<CartItemType | null>(null)
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
    <div className="cart-list-heading"><span>Detalle de venta</span><b>{cart.reduce((sum, item) => sum + item.cantidad, 0)} artículos</b></div><div className="cart-list">{cart.length ? cart.map((item) => <CartItem item={item} key={item.id} onEdit={() => setEditing(item)} />) : <div className="empty-cart"><div><ShoppingCart /></div><h3>Tu carrito está vacío</h3><p>Agrega productos del catálogo para comenzar una venta.</p></div>}</div>
    <div className="cart-summary"><div><span>Subtotal</span><strong>Bs {money(subtotal)}</strong></div><div className="discount-line"><label>Descuento</label><span>Bs <input aria-label="Descuento general" type="number" min="0" max={subtotal} value={discount || ''} placeholder="0.00" onChange={(e) => setDiscount(Math.min(subtotal, Math.max(0, Number(e.target.value))))} /></span></div><div className="grand-total"><span>Total</span><strong>Bs {money(total)}</strong></div><small>Precios con impuestos incluidos según configuración</small></div>
    <div className="cart-actions">{!cart.length && Boolean(localStorage.getItem('roari-suspended-sale')) && <button className="restore-button" onClick={restore}><RotateCcw /> Restaurar venta suspendida</button>}{channel === 'retail' ? <><div className="secondary-actions"><button data-pos-action="suspend" onClick={suspend} disabled={!cart.length}><Pause /> Suspender</button><button onClick={() => setTicketOpen(true)} disabled={!cart.length}><ReceiptText /> Ticket</button></div><button data-pos-action="pay" className="pay-button" disabled={!cart.length} onClick={() => setPaymentOpen(true)}><HandCoins /> Cobrar <span>Bs {money(total)}</span></button></> : <><button className="draft-button" disabled={!cart.length} onClick={openDraft}><FileText /> Guardar borrador</button><div className="secondary-actions"><button disabled={!cart.length} onClick={openDraft}>Cotización</button><button disabled={!cart.length} onClick={openDraft}>Crear pedido</button></div><button data-pos-action="pay" className="pay-button" disabled={!cart.length} onClick={() => channel === 'mayoreo' ? setPaymentOpen(true) : notify('Anticipo creado en modo demostración')}><HandCoins /> {channel === 'mayoreo' ? 'Cobrar' : 'Registrar anticipo'} <span>Bs {money(total)}</span></button></>}</div>
    {editing && <EditCartItemModal item={editing} onClose={() => setEditing(null)} />}{paymentOpen && <PaymentModal onClose={() => setPaymentOpen(false)} />}{ticketOpen && <TicketPreviewModal onClose={() => setTicketOpen(false)} />}
  </aside>
}
