import { useEffect, useState } from 'react'
import { Info, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { Product, SalesChannel } from '../types'
import { getPrice } from '../data/products'
import { getStockByProduct, listPresentations } from '../infrastructure/services'
import { aggregateStockBySucursal } from '../features/inventory/stockAggregation'
import { featureFlags } from '../config/featureFlags'

const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const channelLabels: Record<SalesChannel, string> = { retail: 'Retail', mayoreo: 'Mayoreo', institucional: 'Institucional', corporativo: 'Corporativo' }

interface Presentation { id: number; nombre: string; factorUnidadBase: number; esBase: boolean }

/**
 * TAREA 6.2 — small "i" button on each catalog card that opens a popover with the full
 * product detail (name, marca, SKU, presentations, all 4 channel prices with the same
 * "heredado" marking used elsewhere, and stock by sucursal fetched on demand — never
 * bulk, same convention as CartItem's presentation load and CartPanel's origin-stock
 * fetch). stopPropagation on the trigger button keeps this from also firing the card's
 * own "Agregar al carrito" click handler.
 */
export function ProductInfoPopover({ product }: { product: Product }) {
  const [open, setOpen] = useState(false)
  const [presentations, setPresentations] = useState<Presentation[]>([])
  const [stock, setStock] = useState<{ tienda: number; almacen: number; hasSucursalSplit: boolean } | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void listPresentations(product.id).then((list) => { if (!cancelled) setPresentations(list) })
    if (!featureFlags.supabase) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mock mode reads stock straight off the already-loaded Product fields, no async fetch to defer to a callback (mirrors CartPanel's origin-stock effect)
      setStock({ tienda: product.stockTienda, almacen: product.stockAlmacen, hasSucursalSplit: true })
      return
    }
    void getStockByProduct(product.id).then((result) => {
      if (cancelled) return
      const agg = aggregateStockBySucursal(result.onHand)
      setStock({ tienda: agg.tienda, almacen: agg.almacen, hasSucursalSplit: agg.hasSucursalSplit })
    })
    return () => { cancelled = true }
  }, [open, product.id, product.stockTienda, product.stockAlmacen])

  const channels: SalesChannel[] = ['retail', 'mayoreo', 'institucional', 'corporativo']

  return <>
    <button
      type="button"
      className="product-info-trigger"
      aria-label={`Más información sobre ${product.nombre}`}
      onClick={(event) => { event.stopPropagation(); setOpen(true) }}
    ><Info /></button>
    {open && createPortal(
      <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { event.stopPropagation(); setOpen(false) } }}>
        <section className="modal product-info-popover" role="dialog" aria-modal="true" aria-label={product.nombre} onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div><h2>{product.nombre}</h2><p>{product.categoria}{product.sku ? ` · SKU ${product.sku}` : ''}</p></div>
            <button onClick={(event) => { event.stopPropagation(); setOpen(false) }} aria-label="Cerrar"><X /></button>
          </header>
          <div className="modal-body product-info-body">
            <section>
              <h4>Presentaciones</h4>
              {presentations.length
                ? <ul className="product-info-list">{presentations.map((p) => <li key={p.id}>{p.nombre}{!p.esBase && p.factorUnidadBase !== 1 && ` — factor ${p.factorUnidadBase}`}</li>)}</ul>
                : <p className="product-info-empty">Cargando…</p>}
            </section>
            <section>
              <h4>Precios por canal</h4>
              <ul className="product-info-list">
                {channels.map((ch) => <li key={ch}>
                  <span>{channelLabels[ch]}</span>
                  <strong>Bs {money(getPrice(product, ch))}{ch !== 'retail' && product.preciosHeredados?.[ch] && <small className="price-heredado-badge" title="Sin precio propio para este canal: se usa el precio de mostrador.">heredado</small>}</strong>
                </li>)}
              </ul>
            </section>
            <section>
              <h4>Stock por sucursal</h4>
              {stock
                ? stock.hasSucursalSplit
                  ? <ul className="product-info-list"><li><span>Tienda</span><strong>{stock.tienda}</strong></li><li><span>Almacén</span><strong>{stock.almacen}</strong></li></ul>
                  : <p className="product-info-empty">Sin desglose por sucursal disponible.</p>
                : <p className="product-info-empty">Cargando…</p>}
            </section>
            <section>
              <h4>Ficha técnica</h4>
              <p className="product-info-empty">Ficha técnica: no disponible aún.</p>
            </section>
          </div>
        </section>
      </div>,
      document.body
    )}
  </>
}
