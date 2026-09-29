import { useEffect, useState } from 'react'
import { Boxes, Info, Package, TrendingUp } from 'lucide-react'
import { Modal } from './Modal'
import { ProductVisual } from './ProductVisual'
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
  const [presentations, setPresentations] = useState<Presentation[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [stock, setStock] = useState<{ tienda: number; almacen: number; hasSucursalSplit: boolean } | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void listPresentations(product.id).then((list) => { if (!cancelled) setPresentations(list) }).catch(() => { if (!cancelled) { setPresentations([]); setLoadError(true) } })
    if (!featureFlags.supabase) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mock mode reads stock straight off the already-loaded Product fields, no async fetch to defer to a callback (mirrors CartPanel's origin-stock effect)
      setStock({ tienda: product.stockTienda, almacen: product.stockAlmacen, hasSucursalSplit: true })
      return () => { cancelled = true }
    }
    void getStockByProduct(product.id).then((result) => {
      if (cancelled) return
      const agg = aggregateStockBySucursal(result.onHand)
      setStock({ tienda: agg.tienda, almacen: agg.almacen, hasSucursalSplit: agg.hasSucursalSplit })
    }).catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
  }, [open, product.id, product.stockTienda, product.stockAlmacen])

  const channels: SalesChannel[] = ['retail', 'mayoreo', 'institucional', 'corporativo']

  return <>
    <button
      type="button"
      className="product-info-trigger"
      aria-label={`Más información sobre ${product.nombre}`}
      onClick={(event) => { event.stopPropagation(); setPresentations(null); setStock(null); setLoadError(false); setOpen(true) }}
    ><Info /></button>
    {open && <Modal title="Ficha del producto" subtitle="Precios, presentaciones y stock por sucursal." onClose={() => setOpen(false)} wide className="commercial-modal product-detail-modal">
          <div className="modal-body">
            <div className="product-detail-hero"><ProductVisual type={product.imagen} color={product.color} imagenUrl={product.imagenUrl} /><div><p>{product.categoria || 'Catálogo de productos'}</p><h3>{product.nombre}</h3><div className="product-identity-tags"><span>SKU {product.sku}</span>{product.codigoBarra && <span>{product.codigoBarra}</span>}</div></div></div>
            <div className="commercial-section-heading"><span className="section-icon"><TrendingUp /></span><div><h3>Precios por canal</h3><p>Importes en bolivianos por unidad base.</p></div></div>
            <div className="product-price-grid">
              {channels.map((ch) => <div className="product-price-card" key={ch}><span>{channelLabels[ch]}</span><strong>Bs {money(getPrice(product, ch))}</strong>{ch !== 'retail' && product.preciosHeredados?.[ch] && <small className="price-heredado-badge" title="Se utiliza el precio de Retail para este canal">Precio de Retail</small>}</div>)}
            </div>
            {loadError && <p className="field-error" role="status">No se pudo cargar toda la información. Cierra y vuelve a abrir la ficha para reintentar.</p>}
            <div className="product-detail-columns">
            <section className="commercial-section">
              <div className="commercial-section-heading"><span className="section-icon"><Boxes /></span><div><h3>Stock por sucursal</h3><p>Existencias en unidades base.</p></div></div>
              {stock
                ? stock.hasSucursalSplit
                  ? <ul className="product-info-list"><li><span>Tienda</span><strong>{stock.tienda}</strong></li><li><span>Almacén</span><strong>{stock.almacen}</strong></li></ul>
                  : <p className="product-info-empty">Sin desglose por sucursal disponible.</p>
                : <p className="product-info-empty">{loadError ? 'Stock no disponible.' : 'Consultando stock…'}</p>}
            </section>
            <section className="commercial-section">
              <div className="commercial-section-heading"><span className="section-icon"><Package /></span><div><h3>Presentaciones</h3><p>Equivalencias por unidad de venta.</p></div></div>
              {presentations === null ? <p className="product-info-empty">Cargando presentaciones…</p> : presentations.length
                ? <ul className="product-info-list">{presentations.map((p) => <li key={p.id}><span>{p.nombre}</span><strong>{p.esBase ? 'Unidad base' : `${p.factorUnidadBase} uds.`}</strong></li>)}</ul>
                : <p className="product-info-empty">Sin presentaciones registradas.</p>}
            </section>
            </div>
          </div>
          <footer className="modal-actions"><button className="secondary-button" onClick={() => setOpen(false)}>Cerrar ficha</button></footer>
    </Modal>}
  </>
}
