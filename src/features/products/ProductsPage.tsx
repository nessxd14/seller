import { Boxes, ChevronLeft, ChevronRight, Info, Search, TrendingUp } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { Product } from '../../types'
import { productRepository, getStockByProduct } from '../../infrastructure/services'
import type { StockByLocation } from '../../infrastructure/supabase/ProductRepository.supabase'
import { FeatureShell, FeatureState } from '../shared/FeatureShell'
import { Modal } from '../../components/Modal'
import { ProductVisual } from '../../components/ProductVisual'
import { featureFlags } from '../../config/featureFlags'

// Precios tab (ECharts + historial/resumen RPCs) is lazy — no reason to pay for the
// chart library in the main bundle when most modal opens never touch this tab.
const PreciosTab = lazy(() => import('./PreciosTab').then((m) => ({ default: m.PreciosTab })))

const bs = (value: number) => `Bs ${value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// sucursal_id (2=Tienda, 1=Almacén Central) is the meaningful business location; ubicacion_id
// is a finer-grained bin within a sucursal (real ubicacion rows start at id 4, so a product's
// stock is spread across several ubicacion rows per sucursal). Show both together so the
// per-location breakdown is actually informative instead of a bare "Ubicación 27".
const sucursalName = (sucursalId?: number) => sucursalId === 2 ? 'Tienda' : sucursalId === 1 ? 'Almacén Central' : undefined
const locationLabel = (row: StockByLocation) => {
  const sucursal = sucursalName(row.sucursalId)
  return sucursal ? `${sucursal} · Ubicación ${row.ubicacionId}` : `Ubicación ${row.ubicacionId}`
}

const PAGE_SIZE = 50

export function ProductsPage({ notify }: { notify: (message: string) => void }) {
  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selected, setSelected] = useState<Product | null>(null)
  const [stock, setStock] = useState<{ onHand: StockByLocation[]; saldoDisponible: number } | null>(null)
  const [stockLoading, setStockLoading] = useState(false)
  const [modalTab, setModalTab] = useState<'general' | 'precios'>('general')
  const stockRequestRef = useRef(0)
  const searchRequestRef = useRef(0)

  const runSearch = (value: string, pageNumber: number) => {
    const request = ++searchRequestRef.current
    setStatus('loading')
    return productRepository.search({ query: value, active: true, page: { page: pageNumber, pageSize: PAGE_SIZE } }).then((result) => { if (request === searchRequestRef.current) { setProducts(result.items); setTotal(result.total); setStatus('ready') } }).catch(() => { if (request === searchRequestRef.current) setStatus('error') })
  }

  // Debounced search on typing; Enter bypasses the debounce for barcode-scanner input.
  // Any query change resets back to page 1.
  useEffect(() => {
    let cancelled = false
    const handle = setTimeout(() => { if (!cancelled) { setPage(1); void runSearch(query, 1) } }, 300)
    return () => { cancelled = true; clearTimeout(handle); searchRequestRef.current += 1 }
  }, [query])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const goToPage = (next: number) => { const clamped = Math.min(totalPages, Math.max(1, next)); setPage(clamped); void runSearch(query, clamped) }

  const filtered = useMemo(() => products, [products])

  const openProduct = (product: Product) => {
    const requestId = ++stockRequestRef.current
    setSelected(product)
    setModalTab('general')
    setStock(null)
    setStockLoading(true)
    void getStockByProduct(product.id).then((result) => { if (stockRequestRef.current === requestId) setStock(result) }).catch(() => { if (stockRequestRef.current === requestId) notify('No se pudo cargar el stock') }).finally(() => { if (stockRequestRef.current === requestId) setStockLoading(false) })
  }

  return <FeatureShell eyebrow="CATÁLOGO" title="Productos" subtitle="Precios por canal y disponibilidad de inventario">
    <div className="feature-toolbar"><label><Search /><input aria-label="Buscar producto por nombre, SKU o código de barras" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); void runSearch(query, 1) } }} placeholder="Nombre, SKU o código de barras…" /></label></div>
    {status === 'loading' ? <FeatureState type="skeleton" text="Cargando productos" /> : status === 'error' ? <FeatureState type="error" text="No se pudieron cargar" /> : !filtered.length ? <FeatureState type={query ? 'no-results' : 'empty'} text="No hay productos" /> : <div className="feature-table products-table sticky-head">
      <div className="table-head"><span>Producto</span><span>Marca</span><span>Retail</span><span>Mayoreo</span><span>Institucional</span><span>Corporativo</span></div>
      {filtered.map((product) => <article key={product.id} className="clickable-row" onClick={() => openProduct(product)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') openProduct(product) }}>
        <div className="product-row-name"><ProductVisual type={product.imagen} color={product.color} small imagenUrl={product.imagenUrl} /><div><strong>{product.nombre}</strong><small>{product.sku}</small></div></div>
        <span>{product.categoria || '—'}</span>
        <span>{bs(product.precioRetail)}</span>
        <span>{bs(product.precioMayoreo)}</span>
        <span>{bs(product.precioInstitucional)}</span>
        <span>{bs(product.precioCorporativo)}</span>
      </article>)}
      <div className="pagination-bar"><span>Página {page} de {totalPages} · {total} productos</span><button disabled={page <= 1} onClick={() => goToPage(page - 1)}><ChevronLeft size={14} /></button><button disabled={page >= totalPages} onClick={() => goToPage(page + 1)}><ChevronRight size={14} /></button></div>
    </div>}
    {selected && <Modal title="Ficha del producto" subtitle="Consulta sus precios y disponibilidad." onClose={() => setSelected(null)} wide className="commercial-modal product-detail-modal">
      {featureFlags.supabase && <div className="channel-tabs product-modal-tabs" aria-label="Vista de producto">
        <button type="button" aria-pressed={modalTab === 'general'} className={modalTab === 'general' ? 'active' : ''} onClick={() => setModalTab('general')}><Boxes /><span>Información general</span></button>
        <button type="button" aria-pressed={modalTab === 'precios'} className={modalTab === 'precios' ? 'active' : ''} onClick={() => setModalTab('precios')}><TrendingUp /><span>Historial de precios</span></button>
      </div>}
      {modalTab === 'precios' && featureFlags.supabase ? <div className="modal-body">
        <Suspense fallback={<FeatureState type="loading" text="Cargando gráfico de precios" />}>
          <PreciosTab productId={selected.id} productName={selected.nombre} />
        </Suspense>
      </div> : <div className="modal-body">
        <div className="product-detail-hero">
          <ProductVisual type={selected.imagen} color={selected.color} imagenUrl={selected.imagenUrl} />
          <div><p>{selected.categoria || 'Catálogo de productos'}</p><h3>{selected.nombre}</h3><div className="product-identity-tags"><span>SKU {selected.sku}</span>{selected.codigoBarra && <span>{selected.codigoBarra}</span>}</div></div>
        </div>
        <div className="commercial-section-heading"><span className="section-icon"><TrendingUp /></span><div><h3>Precios por canal</h3><p>Importes en bolivianos por unidad base.</p></div></div>
        <div className="product-price-grid">
          {([
            ['retail', 'Retail', selected.precioRetail], ['mayoreo', 'Mayoreo', selected.precioMayoreo],
            ['institucional', 'Institucional', selected.precioInstitucional], ['corporativo', 'Corporativo', selected.precioCorporativo],
          ] as const).map(([channel, label, price]) => <div className="product-price-card" key={channel}><span>{label}</span><strong>{bs(price)}</strong>{channel !== 'retail' && selected.preciosHeredados?.[channel] && <small className="price-heredado-badge" title="Se utiliza el precio de Retail para este canal">Precio de Retail</small>}</div>)}
        </div>
        <div className="product-detail-columns">
          <section className="commercial-section">
            <div className="commercial-section-heading"><span className="section-icon"><Boxes /></span><div><h3>Disponibilidad</h3><p>Existencias en unidades base.</p></div></div>
            {stockLoading ? <FeatureState type="loading" text="Cargando stock" /> : stock ? <div className="stock-breakdown"><div className="stock-total"><span>Saldo disponible</span><strong>{stock.saldoDisponible.toLocaleString('es-BO')}</strong></div><div className="stock-by-location">{stock.onHand.length ? stock.onHand.map((row) => <div key={row.ubicacionId}><span>{locationLabel(row)}</span><strong>{row.cantidadBase.toLocaleString('es-BO')}</strong></div>) : <span className="empty-hint">Sin stock registrado</span>}</div></div> : <p className="product-info-empty" role="status">No se pudo consultar la disponibilidad. <button className="secondary-button" onClick={() => openProduct(selected)}>Reintentar</button></p>}
          </section>
          <section className="commercial-section">
            <div className="commercial-section-heading"><span className="section-icon"><Info /></span><div><h3>Identificación</h3><p>Datos de referencia del catálogo.</p></div></div>
            <dl className="product-meta-list"><div><dt>SKU</dt><dd>{selected.sku || 'Sin código'}</dd></div><div><dt>Código de barras</dt><dd>{selected.codigoBarra || 'No registrado'}</dd></div><div><dt>Marca / categoría</dt><dd>{selected.categoria || 'No registrada'}</dd></div><div><dt>Producto</dt><dd>{selected.nombre}</dd></div></dl>
          </section>
        </div>
      </div>}
      <footer className="modal-actions"><button className="secondary-button" onClick={() => setSelected(null)}>Cerrar ficha</button></footer>
    </Modal>}
  </FeatureShell>
}
