import { AlertTriangle, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Product } from '../../types'
import { featureFlags } from '../../config/featureFlags'
import { productRepository, getStockByProduct } from '../../infrastructure/services'
import type { StockByLocation } from '../../infrastructure/supabase/ProductRepository.supabase'
import { FeatureShell, FeatureState, statusChipClass } from '../shared/FeatureShell'
import { Modal } from '../../components/Modal'
import { aggregateStockBySucursal } from './stockAggregation'

const PAGE_SIZE = 50
// No stock_min/punto_reorden column is exposed on Product yet — using a fixed low-stock
// heuristic (total < 10) as a pragmatic threshold until a real reorder point exists.
const LOW_STOCK_THRESHOLD = 10

type RowStock = { tienda: number; almacen: number; total: number; hasSucursalSplit: boolean }

// Item 4: on-demand stock, per visible page only (never bulk-queries stock_actual, per Brief
// A's constraint) — for a real Supabase-backed 1000+ row catalog this means Tienda/Almacén/
// Total columns are only populated for the 50 rows currently on screen, refetched on page
// change. Mock mode skips the fetch entirely: Product already carries stockTienda/stockAlmacen.
export function InventoryPage({ notify }: { notify: (message: string) => void }) {
  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [rowStock, setRowStock] = useState<Record<number, RowStock>>({})
  const [onlyNoStock, setOnlyNoStock] = useState(false)
  const [onlyLowStock, setOnlyLowStock] = useState(false)
  const [selected, setSelected] = useState<Product | null>(null)
  const [detailStock, setDetailStock] = useState<{ onHand: StockByLocation[]; saldoDisponible: number } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const runSearch = (value: string, pageNumber: number) => {
    setStatus('loading')
    return productRepository.search({ query: value, active: true, page: { page: pageNumber, pageSize: PAGE_SIZE } }).then((result) => { setProducts(result.items); setTotal(result.total); setStatus('ready') }).catch(() => setStatus('error'))
  }

  useEffect(() => {
    let cancelled = false
    const handle = setTimeout(() => { if (!cancelled) { setPage(1); void runSearch(query, 1) } }, 300)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [query])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const goToPage = (next: number) => { const clamped = Math.min(totalPages, Math.max(1, next)); setPage(clamped); void runSearch(query, clamped) }

  // Fetch (or read locally, in mock mode) the current page's per-row stock breakdown.
  useEffect(() => {
    if (!products.length) return
    if (!featureFlags.supabase) {
      const next: Record<number, RowStock> = {}
      products.forEach((product) => { next[product.id] = { tienda: product.stockTienda, almacen: product.stockAlmacen, total: product.stockTienda + product.stockAlmacen, hasSucursalSplit: true } })
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mock mode reads stock straight off the already-loaded Product fields, no async fetch to defer to a callback
      setRowStock(next)
      return
    }
    let cancelled = false
    void Promise.all(products.map((product) => getStockByProduct(product.id).then((result) => {
      const agg = aggregateStockBySucursal(result.onHand)
      return [product.id, { tienda: agg.tienda, almacen: agg.almacen, total: agg.total, hasSucursalSplit: agg.hasSucursalSplit }] as const
    }))).then((entries) => { if (!cancelled) setRowStock(Object.fromEntries(entries)) }).catch(() => notify('No se pudo cargar el stock de esta página'))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products])

  const rows = useMemo(() => products.map((product) => {
    const stock = rowStock[product.id]
    const totalStock = stock?.total ?? 0
    const state: 'no-stock' | 'low-stock' | 'ok' = totalStock <= 0 ? 'no-stock' : totalStock < LOW_STOCK_THRESHOLD ? 'low-stock' : 'ok'
    return { product, stock, state }
  }).filter((row) => (!onlyNoStock || row.state === 'no-stock') && (!onlyLowStock || row.state === 'low-stock' || row.state === 'no-stock')), [products, rowStock, onlyNoStock, onlyLowStock])

  const openProduct = (product: Product) => {
    setSelected(product)
    setDetailStock(null)
    setDetailLoading(true)
    void getStockByProduct(product.id).then((result) => setDetailStock(result)).catch(() => notify('No se pudo cargar el stock')).finally(() => setDetailLoading(false))
  }
  const detailSummary = useMemo(() => detailStock ? aggregateStockBySucursal(detailStock.onHand) : null, [detailStock])
  const stateLabel: Record<string, string> = { 'no-stock': 'Sin stock', 'low-stock': 'Stock bajo', ok: 'OK' }

  return <FeatureShell eyebrow="OPERACIONES" title="Inventario" subtitle="Disponibilidad por producto y ubicación">
    <div className="feature-toolbar"><label><Search /><input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); void runSearch(query, 1) } }} placeholder="Buscar producto por nombre o SKU... (Enter para buscar de inmediato)" /></label></div>
    <div className="filter-toggle-row">
      <button className={`filter-toggle ${onlyNoStock ? 'active' : ''}`} onClick={() => setOnlyNoStock((v) => !v)}>Solo sin stock</button>
      <button className={`filter-toggle ${onlyLowStock ? 'active' : ''}`} onClick={() => setOnlyLowStock((v) => !v)}>Solo bajo mínimo</button>
    </div>
    {status === 'loading' ? <FeatureState type="skeleton" text="Cargando productos" /> : status === 'error' ? <FeatureState type="error" text="No se pudieron cargar" /> : !rows.length ? <FeatureState type={products.length ? 'no-results' : 'empty'} text="No hay productos" /> : <div className="feature-table inventory-table sticky-head">
      <div className="table-head"><span>Producto</span><span>Tienda</span><span>Almacén</span><span>Total</span><span>Estado</span></div>
      {rows.map(({ product, stock, state }) => <article key={product.id} className="clickable-row" onClick={() => openProduct(product)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') openProduct(product) }}>
        <div><strong>{product.nombre}</strong><small>{product.sku}</small></div>
        <span>{stock?.hasSucursalSplit ? stock.tienda : '—'}</span>
        <span>{stock?.hasSucursalSplit ? stock.almacen : '—'}</span>
        <span>{stock ? stock.total : '…'}</span>
        <span className={`status-chip ${statusChipClass(state)}`}>{state === 'low-stock' && <AlertTriangle size={10} />} {stateLabel[state]}</span>
      </article>)}
      <div className="pagination-bar"><span>Página {page} de {totalPages} · {total} productos</span><button disabled={page <= 1} onClick={() => goToPage(page - 1)}><ChevronLeft size={14} /></button><button disabled={page >= totalPages} onClick={() => goToPage(page + 1)}><ChevronRight size={14} /></button></div>
    </div>}
    {selected && <Modal title={selected.nombre} subtitle={`SKU ${selected.sku}`} onClose={() => setSelected(null)} side><div className="modal-body">
      {detailLoading ? <FeatureState type="loading" text="Cargando stock" /> : !detailSummary ? <FeatureState type="error" text="No se pudo cargar el stock" /> : <div className="stock-breakdown">
        <div className="stock-total"><span>Saldo disponible</span><strong>{detailStock?.saldoDisponible ?? 0}</strong></div>
        {detailSummary.hasSucursalSplit
          ? <div className="customer-metrics"><div><span>Tienda</span><strong>{detailSummary.tienda}</strong></div><div><span>Almacén</span><strong>{detailSummary.almacen}</strong></div></div>
          : <div className="customer-metrics"><div><span>Disponible</span><strong>{detailSummary.total}</strong></div></div>}
        <h3>Por ubicación</h3>
        <div className="stock-by-location">{detailStock?.onHand.length ? detailStock.onHand.map((row) => <div key={row.ubicacionId}><span>{row.sucursalId === 2 ? 'Tienda' : row.sucursalId === 1 ? 'Almacén Central' : 'Sucursal'} · Ubicación {row.ubicacionId}</span><strong>{row.cantidadBase}</strong></div>) : <span className="empty-hint">Sin stock registrado</span>}</div>
      </div>}
    </div></Modal>}
  </FeatureShell>
}
