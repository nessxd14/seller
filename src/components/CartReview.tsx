import { AlertTriangle, Pencil } from 'lucide-react'
import { Modal } from './Modal'
import type { CartItem, SalesChannel } from '../types'
import type { CartCustomer } from '../context/PosContext'
import { getPrice } from '../data/products'
import { ventaLineTotalCents } from '../domain/sales/ventaPricing'
import { cantidadBaseFor, isLineUnderstocked } from '../domain/sales/stockCheck'
import { isLineUnpriced } from '../domain/sales/priceCheck'

const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtQty = (n: number) => n.toLocaleString('es-BO')

const heredadoKeyForChannel = (channel: SalesChannel): 'mayoreo' | 'institucional' | 'municipal' | null =>
  channel === 'mayoreo' || channel === 'institucional' || channel === 'municipal' ? channel : null

/**
 * TAREA 5 — pre-checkout review. Optional detour: the existing "Cobrar" button keeps
 * going straight to PaymentModal, this is purely an extra confirmation step someone can
 * open first. Its whole point is surfacing anomalies (overridden/heredado prices,
 * understocked lines), not just repeating the cart — see the badges below, which reuse
 * the exact same flags CartItem already computes per line.
 */
export function CartReview({
  items, channel, originStock, customer, subtotal, discount, total, onClose, onCheckout,
}: {
  items: CartItem[]
  channel: SalesChannel
  originStock: Record<number, { tienda: number; almacen: number }>
  customer: CartCustomer | null
  subtotal: number
  discount: number
  total: number
  onClose: () => void
  onCheckout: () => void
}) {
  const heredadoKey = heredadoKeyForChannel(channel)
  // TAREA A: CartReview's own "Cobrar" button calls onCheckout directly, bypassing
  // CartPanel's pay-button disabled check — it needs the same block so a seller can't
  // route around the guard just by opening the review screen first.
  const hasUnpricedLine = items.some((item) => isLineUnpriced(item))

  return <Modal title="Revisar venta" subtitle="Antes de cobrar, un vistazo a lo que puede necesitar atención" onClose={onClose} side>
    <div className="modal-body cart-review-body">
      <p className="cart-review-customer"><b>Cliente:</b> {customer ? `${customer.name}${customer.documento ? ` · ${customer.documento}` : ''}` : 'Cliente de mostrador'}</p>
      <div className="doc-table-wrap">
        <table className="doc-table cart-review-table">
          <thead>
            <tr><th>Producto</th><th>Presentación</th><th>Cant</th><th>P/U</th><th>Desc.</th><th>Subtotal</th></tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const factor = item.factorUnidadBase ?? 1
              const channelListPrice = getPrice(item, channel) * factor
              const priceMatchesSuggestion = Math.abs(item.precioAplicado - channelListPrice) < 0.005
              const isOverridden = !priceMatchesSuggestion
              const isHeredado = heredadoKey ? Boolean(item.preciosHeredados?.[heredadoKey]) : false
              // TAREA A: "heredado" only means something when a real (non-zero) price is
              // actually being inherited — nothing to inherit gets the "sin precio" state
              // below instead, never both, never neither.
              const isUnpriced = isLineUnpriced(item)
              const showInheritedBadge = isHeredado && priceMatchesSuggestion && !isUnpriced
              const understocked = isLineUnderstocked(item, originStock[item.id])
              const lineTotal = ventaLineTotalCents(item) / 100
              return <tr key={item.id} className={understocked || isUnpriced ? 'cart-review-flagged' : ''}>
                <td>{item.nombre}{understocked && <small className="line-stock-error"><AlertTriangle /> Stock insuficiente en {item.ubicacion} para {fmtQty(cantidadBaseFor(item))} uds.</small>}{isUnpriced && <small className="line-stock-error"><AlertTriangle /> {item.nombre} no tiene precio.</small>}</td>
                <td>{item.presentacionNombre ?? 'Unidad'}</td>
                <td>{fmtQty(item.cantidad)}</td>
                <td className={isOverridden ? 'price-overridden' : ''}>Bs {money(item.precioAplicado)}{showInheritedBadge && <small className="price-heredado-badge" title="Este canal no tiene precio propio: se usa el precio de mostrador.">heredado</small>}{isUnpriced && <small className="price-heredado-badge price-overridden-badge" title="Esta línea no tiene precio configurado.">sin precio</small>}{isOverridden && !isUnpriced && <small className="price-heredado-badge price-overridden-badge" title={`Precio de lista: Bs ${money(channelListPrice)}`}>modificado</small>}</td>
                <td>{item.descuento > 0 ? `${item.descuento}%` : '—'}</td>
                <td>Bs {money(lineTotal)}</td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
      <div className="doc-totals cart-review-totals">
        <div className="doc-total-row"><span>Subtotal</span><strong>Bs {money(subtotal)}</strong></div>
        {discount > 0 && <div className="doc-total-row"><span>Descuento general</span><strong>−Bs {money(discount)}</strong></div>}
        <div className="doc-total-row doc-total-line"><span>Total</span><strong>Bs {money(total)}</strong></div>
      </div>
    </div>
    <footer className="modal-actions">
      <button className="secondary-button" onClick={onClose}><Pencil /> Volver a editar</button>
      <button className="primary-button" disabled={hasUnpricedLine} onClick={onCheckout}>Cobrar</button>
    </footer>
  </Modal>
}
