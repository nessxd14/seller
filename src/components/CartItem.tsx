import { Minus, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { usePos } from '../context/PosContext'
import type { CartItem as CartItemType, SalesChannel } from '../types'
import { ProductVisual } from './ProductVisual'
import { calculateLineTotal } from '../domain/sales/cartCalculator'
import { moneyToDecimal } from '../domain/common/money'
import { getPrice } from '../data/products'
import { listPresentations } from '../infrastructure/services'
import { isLineUnderstocked } from '../domain/sales/stockCheck'
import { isLineUnpriced } from '../domain/sales/priceCheck'
import { OriginPin, buildOriginOptions } from './OriginPin'

const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtQty = (n: number) => n.toLocaleString('es-BO')

interface Presentation { id: number; nombre: string; factorUnidadBase: number; esBase: boolean }

// TAREA 2: preciosHeredados only carries keys for the non-retail channels — retail is always
// the fallback source, never a fallback target, so it can never be "inherited".
const heredadoKeyForChannel = (channel: SalesChannel): 'mayoreo' | 'institucional' | 'municipal' | null =>
  channel === 'mayoreo' || channel === 'institucional' || channel === 'municipal' ? channel : null

export function CartItem({ item, onEdit, originStock, onSetOrigin, onRequestTransfer, trasladoDisponible }: { item: CartItemType; onEdit: () => void; originStock?: { tienda: number; almacen: number }; onSetOrigin?: (location: 'Tienda' | 'Almacén') => void; onRequestTransfer?: (shortfall: number) => void; trasladoDisponible?: number }) {
  const { channel, mode, updateQuantity, updateItem, removeItem } = usePos()
  const lineTotal = moneyToDecimal(calculateLineTotal({ unitPrice: item.precioAplicado, quantity: item.cantidad, discountPercent: item.descuento }))

  // TAREA 3.2: presentations are loaded per product, on demand, when the line first mounts —
  // never in bulk (the `presentacion` table has 1000+ rows and PostgREST truncates past 1000).
  // item.id is the product id (see PosContext.addProduct), so this fires once per distinct
  // product added to the cart, not on every re-render.
  const [presentations, setPresentations] = useState<Presentation[]>([])
  useEffect(() => {
    let cancelled = false
    void listPresentations(item.id).then((list) => { if (!cancelled) setPresentations(list) })
    return () => { cancelled = true }
  }, [item.id])

  const factor = item.factorUnidadBase ?? 1
  // Base-unit quantity — the ONLY thing ever compared against stock (loose units, always).
  const cantidadBase = item.cantidad * factor

  // Suggested price for the currently active channel + presentation combo — recomputed live,
  // never stored separately, since CartItem (unlike DraftOrderEditor's WorkflowLine) always
  // carries the full Product with it, so the per-base-unit list price is always one call away.
  const channelListPrice = getPrice(item, channel) * factor
  const heredadoKey = heredadoKeyForChannel(channel)
  const isHeredado = heredadoKey ? Boolean(item.preciosHeredados?.[heredadoKey]) : false
  // A price can be BOTH inherited AND user-overridden if the seller edits it manually — once
  // that happens it's no longer "not negotiated," so the inherited badge only shows while the
  // applied price still equals the untouched suggested value.
  const priceMatchesSuggestion = Math.abs(item.precioAplicado - channelListPrice) < 0.005
  // TAREA A / three-state badges: "heredado" is a lie when there's nothing to inherit —
  // retail itself being 0/NULL means the line has NO price anywhere, not a borrowed one.
  // That state gets its own "sin precio" badge instead, and the two are mutually exclusive.
  const isUnpriced = isLineUnpriced(item)
  const showInheritedBadge = isHeredado && priceMatchesSuggestion && !isUnpriced
  const isOverridden = !priceMatchesSuggestion

  const [editing, setEditing] = useState(false)
  const [draftValue, setDraftValue] = useState('')
  const startEdit = () => { setDraftValue(String(item.precioAplicado)); setEditing(true) }
  const commit = () => {
    const parsed = Number(draftValue)
    // TAREA B: committing via the inline editor IS the definition of "manually modified" —
    // set precioModificado unconditionally so PosContext's channel-switch recompute leaves
    // this line alone from now on, regardless of whether the new value actually differs.
    updateItem(item.id, { precioAplicado: Number.isFinite(parsed) ? Math.max(0, parsed) : item.precioAplicado, precioModificado: true })
    setEditing(false)
  }
  const cancelEdit = () => setEditing(false)

  const tiendaAvailable = originStock?.tienda ?? 0
  const insufficient = onSetOrigin ? isLineUnderstocked(item, originStock) : false
  // Item 1.2: only offer "Solicitar a almacén" when the shortfall is specifically against
  // Tienda's own stock (the case a transfer from Almacén can actually fix) — an Almacén-origin
  // shortfall is a different problem (no stock anywhere) that a Tienda-bound transfer can't solve.
  const tiendaShortfall = item.ubicacion === 'Tienda' && originStock ? Math.max(0, cantidadBase - tiendaAvailable) : 0

  const onPresentationChange = (chosen: Presentation) => {
    const isBase = chosen.esBase || chosen.factorUnidadBase === 1
    const nextFactor = isBase ? 1 : chosen.factorUnidadBase
    const nextPrice = Math.round(getPrice(item, channel) * nextFactor * 100) / 100
    updateItem(item.id, {
      presentacionId: isBase ? undefined : chosen.id,
      presentacionNombre: isBase ? undefined : chosen.nombre,
      factorUnidadBase: isBase ? undefined : nextFactor,
      precioAplicado: nextPrice,
      // TAREA B: a presentation change is itself a fresh, deliberate recompute the seller
      // just triggered — it supersedes any earlier manual price edit, so it clears the
      // "frozen" flag rather than leaving a stale override in place.
      precioModificado: false,
    })
  }

  // Brief J — modo traslado: mismo motor (mismo item, misma cantidad, misma
  // presentación), pero sin precios y con el disponible de la sucursal origen del
  // traslado en vez del split Tienda/Almacén de venta. Rama separada del return de
  // venta de abajo para no arriesgar ese camino — nada de esto lo toca.
  if (mode === 'traslado') {
    const disponible = trasladoDisponible ?? 0
    const noAlcanza = cantidadBase > disponible
    return <article className="cart-item"><ProductVisual type={item.imagen} color={item.color} small imagenUrl={item.imagenUrl} /><div className="cart-item-main">
      <div className="cart-title"><div><h4 title={item.nombre}>{item.nombre}</h4><span className="cart-item-sku">{item.sku}</span></div>
        <button onClick={() => removeItem(item.id)} aria-label={`Eliminar ${item.nombre}`}><Trash2 /></button>
      </div>
      <div className="cart-line-bottom">
        <div className="qty-control"><button disabled={item.cantidad <= 1} onClick={() => updateQuantity(item.id, item.cantidad - 1)}><Minus /></button><strong>{item.cantidad}</strong><button onClick={() => updateQuantity(item.id, item.cantidad + 1)}><Plus /></button></div>
        {presentations.length > 1
          ? <select aria-label={`Presentación ${item.nombre}`} value={item.presentacionId ?? presentations.find((p) => p.esBase)?.id ?? presentations[0]?.id} onChange={(e) => { const chosen = presentations.find((p) => p.id === Number(e.target.value)); if (chosen) onPresentationChange(chosen) }}>
              {presentations.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          : <span className="cart-unidad-plain">{presentations[0]?.nombre ?? 'Unidad'}</span>}
      </div>
      {factor !== 1 && <small className="line-equivalence">{fmtQty(item.cantidad)} {item.presentacionNombre} = {fmtQty(cantidadBase)} u</small>}
      <small className={`cart-disponible ${noAlcanza ? 'cart-disponible-warn' : ''}`}>{fmtQty(cantidadBase)} base · disponible {fmtQty(disponible)}</small>
    </div></article>
  }

  return <article className="cart-item"><ProductVisual type={item.imagen} color={item.color} small imagenUrl={item.imagenUrl} /><div className="cart-item-main"><div className="cart-title"><div>
      <h4 title={item.nombre}>{item.nombre}</h4>
      <div className="cart-price-row">
        {editing
          ? <input
              className="price-inline-input"
              type="number"
              step="0.01"
              min="0"
              autoFocus
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } else if (e.key === 'Escape') { e.preventDefault(); cancelEdit() } }}
            />
          : <button
              type="button"
              className={`price-inline-display ${isOverridden ? 'price-overridden' : ''}`}
              onClick={startEdit}
              title={isOverridden ? `Precio de lista: Bs ${money(channelListPrice)}` : undefined}
            >
              Bs {money(item.precioAplicado)} c/u {item.descuento > 0 && <em>−{item.descuento}%</em>}
            </button>}
        {showInheritedBadge && <small className="price-heredado-badge" title="Este canal no tiene precio propio configurado: se usa el precio de mostrador. No es un precio negociado.">precio heredado, no negociado</small>}
        {isUnpriced && <small className="price-heredado-badge price-overridden-badge" title="Esta línea no tiene precio configurado en ningún canal. Escribí un precio para poder cobrarla.">sin precio</small>}
      </div>
    </div><button onClick={() => removeItem(item.id)} aria-label={`Eliminar ${item.nombre}`}><Trash2 /></button></div>
    {onSetOrigin && <OriginPin value={item.ubicacion} options={buildOriginOptions(originStock)} onChange={onSetOrigin} ariaLabel={`Origen ${item.nombre}`} />}
    {presentations.length > 1 && <div className="cart-presentacion"><select aria-label={`Presentación ${item.nombre}`} value={item.presentacionId ?? presentations.find((p) => p.esBase)?.id ?? presentations[0]?.id} onChange={(e) => { const chosen = presentations.find((p) => p.id === Number(e.target.value)); if (chosen) onPresentationChange(chosen) }}>
      {presentations.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
    </select></div>}
    {insufficient && <small className="line-stock-error">Stock insuficiente en {item.ubicacion} para {fmtQty(cantidadBase)} uds.{tiendaShortfall > 0 && onRequestTransfer && <button type="button" className="request-transfer-link" onClick={() => onRequestTransfer(tiendaShortfall)}>Solicitar a almacén</button>}</small>}
    {isUnpriced && <small className="line-stock-error">{item.nombre} no tiene precio. Escribilo en la línea para poder cobrar.</small>}
    <div className="cart-line-bottom"><div className="qty-control"><button disabled={item.cantidad <= 1} onClick={() => updateQuantity(item.id, item.cantidad - 1)}><Minus /></button><strong>{item.cantidad}</strong><button onClick={() => updateQuantity(item.id, item.cantidad + 1)}><Plus /></button></div><button className="edit-link" onClick={onEdit}><Pencil /> Editar</button><strong className="line-total">Bs {money(lineTotal)}</strong></div>
    {factor !== 1 && <small className="line-equivalence">{fmtQty(item.cantidad)} {item.presentacionNombre} = {fmtQty(cantidadBase)} u</small>}
    </div></article>
}
