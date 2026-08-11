import { AlertTriangle, Info, Minus, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { usePos } from '../context/PosContext'
import type { CartItem as CartItemType, SalesChannel } from '../types'
import { ProductVisual } from './ProductVisual'
import { ventaLineTotalCents } from '../domain/sales/ventaPricing'
import { getPrice } from '../data/products'
import { listPresentations } from '../infrastructure/services'
import { isLineBlocking, isLineUnderstocked, type StockControlInfo } from '../domain/sales/stockCheck'
import { isLineUnpriced } from '../domain/sales/priceCheck'
import { OriginPin, buildOriginOptions } from './OriginPin'
import { NumberField } from './NumberField'

const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtQty = (n: number) => n.toLocaleString('es-BO')

interface Presentation { id: number; nombre: string; factorUnidadBase: number; esBase: boolean }

// TAREA 2: preciosHeredados only carries keys for the non-retail channels — retail is always
// the fallback source, never a fallback target, so it can never be "inherited".
const heredadoKeyForChannel = (channel: SalesChannel): 'mayoreo' | 'institucional' | 'municipal' | null =>
  channel === 'mayoreo' || channel === 'institucional' || channel === 'municipal' ? channel : null

/**
 * TAREA D (Tanda 5): el único campo de cantidad que quedó fuera del NumberField de la
 * Tanda 4 — no era un input, era un <strong> entre los botones +/-. Mismo patrón que el
 * editor de precio en línea: el número es un botón; al hacer clic se vuelve NumberField
 * con foco y texto seleccionado (para escribir de cero sin borrar primero); confirma con
 * Enter o blur, revierte con Escape — nunca borra la línea. +/- se quedan: para 1-2
 * unidades siguen siendo más rápidos que abrir el campo.
 */
function QtyControl({ quantity, onChange }: { quantity: number; onChange: (next: number) => void }) {
  const [editing, setEditing] = useState(false)
  return <div className="qty-control">
    <button type="button" disabled={quantity <= 1} onClick={() => onChange(quantity - 1)}><Minus /></button>
    {editing
      ? <NumberField
          className="qty-value-input"
          ariaLabel="Cantidad"
          autoFocus
          selectOnFocus
          min={1}
          allowDecimals={false}
          value={quantity}
          onCommit={(next) => { onChange(next); setEditing(false) }}
        />
      : <button type="button" className="qty-value" onClick={() => setEditing(true)}>{quantity}</button>}
    <button type="button" onClick={() => onChange(quantity + 1)}><Plus /></button>
  </div>
}

export function CartItem({ item, onEdit, originStock, onSetOrigin, onRequestTransfer, trasladoDisponible }: { item: CartItemType; onEdit: () => void; originStock?: StockControlInfo; onSetOrigin?: (location: 'Tienda' | 'Almacén') => void; onRequestTransfer?: (shortfall: number) => void; trasladoDisponible?: number }) {
  const { channel, mode, updateQuantity, updateItem, removeItem } = usePos()
  const lineTotal = ventaLineTotalCents(item) / 100

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
  const onQuantityChange = (next: number) => updateQuantity(item.id, next)

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
  // Brief S9: "falta stock" (understocked) ya no es lo mismo que "esto bloquea la venta"
  // (blocking) — en una sucursal en control LIBRE faltar stock es lo esperado hasta que
  // se inventaríe, no un error. El aviso se queda visible en los dos casos, pero con tono
  // distinto: rojo y bloqueante cuando `blocking`, gris e informativo cuando no.
  const understocked = onSetOrigin ? isLineUnderstocked(item, originStock) : false
  const insufficient = onSetOrigin ? isLineBlocking(item, originStock) : false
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
      <div className="cart-line-controls">
        <QtyControl quantity={item.cantidad} onChange={onQuantityChange} />
        {presentations.length > 1
          ? <select aria-label={`Presentación ${item.nombre}`} className="cart-presentacion-select" value={item.presentacionId ?? presentations.find((p) => p.esBase)?.id ?? presentations[0]?.id} onChange={(e) => { const chosen = presentations.find((p) => p.id === Number(e.target.value)); if (chosen) onPresentationChange(chosen) }}>
              {presentations.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          : <span className="cart-unidad-plain">{presentations[0]?.nombre ?? 'Unidad'}</span>}
        {factor !== 1 && <small className="line-equivalence">{fmtQty(item.cantidad)} {item.presentacionNombre} = {fmtQty(cantidadBase)} u</small>}
      </div>
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
        {/* TAREA B.1 (Tanda 5): el badge de texto completo ocupaba una fila entera él
            solo y aparece en casi todas las líneas de mayoreo — pasa a ícono con el
            mismo tooltip. "sin precio" se queda visible y en rojo a propósito: bloquea
            el cobro y tiene que gritar, no achicarse. */}
        {showInheritedBadge && <span className="price-heredado-icon" title="Este canal no tiene precio propio configurado: se usa el precio de mostrador. No es un precio negociado."><Info aria-label="Precio heredado, no negociado" /></span>}
        {isUnpriced && <small className="price-heredado-badge price-overridden-badge" title="Esta línea no tiene precio configurado en ningún canal. Escribí un precio para poder cobrarla.">sin precio</small>}
      </div>
    </div><button onClick={() => removeItem(item.id)} aria-label={`Eliminar ${item.nombre}`}><Trash2 /></button></div>
    {/* TAREA 2 (Tanda 4) + TAREA B.2/B.3/B.5 (Tanda 5): ubicación → presentación →
        contador → equivalencia → editar → total, todo en una sola fila. El selector de
        presentación se muestra siempre, deshabilitado cuando hay una sola. El total y
        "Editar" (ahora solo ícono) se mudan acá desde su propia fila — .line-total lleva
        margin-left:auto en el CSS para quedar pegado al borde derecho. */}
    <div className="cart-line-controls">
      {onSetOrigin && <OriginPin value={item.ubicacion} options={buildOriginOptions(originStock)} onChange={onSetOrigin} ariaLabel={`Origen ${item.nombre}`} />}
      <select
        aria-label={`Presentación ${item.nombre}`}
        className="cart-presentacion-select"
        disabled={presentations.length <= 1}
        value={item.presentacionId ?? presentations.find((p) => p.esBase)?.id ?? presentations[0]?.id ?? ''}
        onChange={(e) => { const chosen = presentations.find((p) => p.id === Number(e.target.value)); if (chosen) onPresentationChange(chosen) }}
      >
        {presentations.length ? presentations.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>) : <option value="">Unidad</option>}
      </select>
      <QtyControl quantity={item.cantidad} onChange={onQuantityChange} />
      {factor !== 1 && <small className="line-equivalence">{fmtQty(item.cantidad)} {item.presentacionNombre} = {fmtQty(cantidadBase)} u</small>}
      <button className="edit-link" onClick={onEdit} aria-label={`Editar ${item.nombre}`} title="Editar"><Pencil /></button>
      <strong className="line-total">Bs {money(lineTotal)}</strong>
    </div>
    {/* TAREA B.4: ícono + texto corto, sin envolver — el enlace sigue siendo una acción.
        Brief S10: si el bloqueo es por reserva, nombrar el pedido en vez de decir "sin
        stock" a secas — el cajero necesita poder explicarle al cliente qué pasa. */}
    {insufficient && <small className="line-stock-error line-stock-error-compact"><AlertTriangle aria-hidden />{(originStock?.reservado ?? 0) > 0 ? <>Quedan {fmtQty(item.ubicacion === 'Tienda' ? tiendaAvailable : originStock!.almacen)} disponibles. Otras {fmtQty(originStock!.reservado)} reservadas para &quot;{originStock!.motivo ?? 'otro pedido'}&quot;.</> : <>Stock insuficiente en {item.ubicacion}.</>}{tiendaShortfall > 0 && onRequestTransfer && <button type="button" className="request-transfer-link" onClick={() => onRequestTransfer(tiendaShortfall)}>Solicitar a almacén</button>}</small>}
    {/* Brief S9: mismo caso (falta stock) pero la sucursal está en control libre — no
        bloquea, así que no puede llevar el mismo rojo que un error real o el aviso
        pierde significado y se ignora. */}
    {understocked && !insufficient && <small className="line-stock-info line-stock-error-compact"><Info aria-hidden />Sin inventariar en {item.ubicacion}.</small>}
    {isUnpriced && <small className="line-stock-error">{item.nombre} no tiene precio. Escribilo en la línea para poder cobrar.</small>}
    </div></article>
}
