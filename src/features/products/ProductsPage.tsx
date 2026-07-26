import { Boxes, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Product } from '../../types'
import { productRepository, getStockByProduct } from '../../infrastructure/services'
import type { StockByLocation } from '../../infrastructure/supabase/ProductRepository.supabase'
import { FeatureShell, FeatureState } from '../shared/FeatureShell'
import { Modal } from '../../components/Modal'

const bs = (value: number) => `Bs ${value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const locationLabel = (ubicacionId: number) => ubicacionId === 1 ? 'Almacén' : ubicacionId === 2 ? 'Tienda' : `Ubicación ${ubicacionId}`

export function ProductsPage({ notify }: { notify: (message: string) => void }) {
  const [products, setProducts] = useState<Product[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selected, setSelected] = useState<Product | null>(null)
  const [stock, setStock] = useState<{ onHand: StockByLocation[]; saldoDisponible: number } | null>(null)
  const [stockLoading, setStockLoading] = useState(false)

  const runSearch = (value: string) => {
    setStatus('loading')
    return productRepository.search({ query: value, active: true, page: { page: 1, pageSize: 50 } }).then((page) => { setProducts(page.items); setStatus('ready') }).catch(() => setStatus('error'))
  }

  // Debounced search on typing; Enter bypasses the debounce for barcode-scanner input.
  useEffect(() => {
    let cancelled = false
    const handle = setTimeout(() => { if (!cancelled) void runSearch(query) }, 300)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [query])

  const filtered = useMemo(() => products, [products])

  const openProduct = (product: Product) => {
    setSelected(product)
    setStock(null)
    setStockLoading(true)
    void getStockByProduct(product.id).then((result) => setStock(result)).catch(() => notify('No se pudo cargar el stock')).finally(() => setStockLoading(false))
  }

  return <FeatureShell eyebrow="CATÁLOGO" title="Productos" subtitle="Precios por canal y disponibilidad de inventario">
    <div className="feature-toolbar"><label><Search /><input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(query) }} placeholder="Buscar por nombre o SKU... (Enter para buscar de inmediato)" /></label></div>
    {status === 'loading' ? <FeatureState type="loading" text="Cargando productos" /> : status === 'error' ? <FeatureState type="error" text="No se pudieron cargar" /> : !filtered.length ? <FeatureState type={query ? 'no-results' : 'empty'} text="No hay productos" /> : <div className="feature-table products-table"><div className="table-head"><span>Producto</span><span>Retail</span><span>Mayoreo</span><span>Institucional</span><span>Municipal</span></div>{filtered.map((product) => <article key={product.id} className="clickable-row" onClick={() => openProduct(product)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') openProduct(product) }}><div><strong>{product.nombre}</strong><small>{product.sku}</small></div><span>{bs(product.precioRetail)}</span><span>{bs(product.precioMayoreo)}</span><span>{bs(product.precioInstitucional)}</span><span>{bs(product.precioMunicipal)}</span></article>)}</div>}
    {selected && <Modal title={selected.nombre} subtitle={`SKU ${selected.sku}`} onClose={() => setSelected(null)}><div className="modal-body">
      <div className="customer-metrics"><div><span>Retail</span><strong>{bs(selected.precioRetail)}</strong></div><div><span>Mayoreo</span><strong>{bs(selected.precioMayoreo)}</strong></div><div><span>Institucional</span><strong>{bs(selected.precioInstitucional)}</strong></div><div><span>Municipal</span><strong>{bs(selected.precioMunicipal)}</strong></div></div>
      <h3><Boxes size={14} /> Disponibilidad</h3>
      {stockLoading ? <FeatureState type="loading" text="Cargando stock" /> : stock ? <div className="stock-breakdown"><div className="stock-total"><span>Saldo disponible</span><strong>{stock.saldoDisponible}</strong></div><div className="stock-by-location">{stock.onHand.length ? stock.onHand.map((row) => <div key={row.ubicacionId}><span>{locationLabel(row.ubicacionId)}</span><strong>{row.cantidadBase}</strong></div>) : <span className="empty-hint">Sin stock registrado</span>}</div></div> : <span className="empty-hint">Sin información de stock</span>}
    </div></Modal>}
  </FeatureShell>
}
