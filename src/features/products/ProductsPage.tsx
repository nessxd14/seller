import { Boxes, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Product } from '../../types'
import { productRepository, getStockByProduct } from '../../infrastructure/services'
import type { StockByLocation } from '../../infrastructure/supabase/ProductRepository.supabase'
import { FeatureShell, FeatureState } from '../shared/FeatureShell'
import { Modal } from '../../components/Modal'
import { ProductVisual } from '../../components/ProductVisual'

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

  const runSearch = (value: string, pageNumber: number) => {
    setStatus('loading')
    return productRepository.search({ query: value, active: true, page: { page: pageNumber, pageSize: PAGE_SIZE } }).then((result) => { setProducts(result.items); setTotal(result.total); setStatus('ready') }).catch(() => setStatus('error'))
  }

  // Debounced search on typing; Enter bypasses the debounce for barcode-scanner input.
  // Any query change resets back to page 1.
  useEffect(() => {
    let cancelled = false
    const handle = setTimeout(() => { if (!cancelled) { setPage(1); void runSearch(query, 1) } }, 300)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [query])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const goToPage = (next: number) => { const clamped = Math.min(totalPages, Math.max(1, next)); setPage(clamped); void runSearch(query, clamped) }

  const filtered = useMemo(() => products, [products])

  const openProduct = (product: Product) => {
    setSelected(product)
    setStock(null)
    setStockLoading(true)
    void getStockByProduct(product.id).then((result) => setStock(result)).catch(() => notify('No se pudo cargar el stock')).finally(() => setStockLoading(false))
  }

  return <FeatureShell eyebrow="CATÁLOGO" title="Productos" subtitle="Precios por canal y disponibilidad de inventario">
    <div className="feature-toolbar"><label><Search /><input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); void runSearch(query, 1) } }} placeholder="Buscar por nombre o SKU... (Enter para buscar de inmediato)" /></label></div>
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
    {selected && <Modal title={selected.nombre} subtitle={`SKU ${selected.sku}`} onClose={() => setSelected(null)}><div className="modal-body">
      <div className="customer-metrics"><div><span>Retail</span><strong>{bs(selected.precioRetail)}</strong></div><div><span>Mayoreo</span><strong>{bs(selected.precioMayoreo)}</strong></div><div><span>Institucional</span><strong>{bs(selected.precioInstitucional)}</strong></div><div><span>Corporativo</span><strong>{bs(selected.precioCorporativo)}</strong></div></div>
      <h3><Boxes size={14} /> Disponibilidad</h3>
      {stockLoading ? <FeatureState type="loading" text="Cargando stock" /> : stock ? <div className="stock-breakdown"><div className="stock-total"><span>Saldo disponible</span><strong>{stock.saldoDisponible}</strong></div><div className="stock-by-location">{stock.onHand.length ? stock.onHand.map((row) => <div key={row.ubicacionId}><span>{locationLabel(row)}</span><strong>{row.cantidadBase}</strong></div>) : <span className="empty-hint">Sin stock registrado</span>}</div></div> : <span className="empty-hint">Sin información de stock</span>}
    </div></Modal>}
  </FeatureShell>
}
