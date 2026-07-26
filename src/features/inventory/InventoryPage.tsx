import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Product } from '../../types'
import { productRepository, getStockByProduct } from '../../infrastructure/services'
import type { StockByLocation } from '../../infrastructure/supabase/ProductRepository.supabase'
import { FeatureShell, FeatureState } from '../shared/FeatureShell'
import { aggregateStockBySucursal } from './stockAggregation'

export function InventoryPage({ notify }: { notify: (message: string) => void }) {
  const [products, setProducts] = useState<Product[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selected, setSelected] = useState<Product | null>(null)
  const [stock, setStock] = useState<{ onHand: StockByLocation[]; saldoDisponible: number } | null>(null)
  const [stockLoading, setStockLoading] = useState(false)

  const runSearch = (value: string) => {
    setStatus('loading')
    return productRepository.search({ query: value, active: true, page: { page: 1, pageSize: 50 } }).then((page) => { setProducts(page.items); setStatus('ready'); if (page.items.length && !selected) setSelected(page.items[0]) }).catch(() => setStatus('error'))
  }

  useEffect(() => {
    let cancelled = false
    const handle = setTimeout(() => { if (!cancelled) void runSearch(query) }, 300)
    return () => { cancelled = true; clearTimeout(handle) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting local stock state when the selected product changes, not an external sync
    if (!selected) { setStock(null); return }
    setStock(null)
    setStockLoading(true)
    void getStockByProduct(selected.id).then((result) => setStock(result)).catch(() => notify('No se pudo cargar el stock')).finally(() => setStockLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const summary = useMemo(() => stock ? aggregateStockBySucursal(stock.onHand) : null, [stock])

  return <FeatureShell eyebrow="OPERACIONES" title="Inventario" subtitle="Disponibilidad por producto y ubicación">
    <div className="feature-toolbar"><label><Search /><input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(query) }} placeholder="Buscar producto por nombre o SKU... (Enter para buscar de inmediato)" /></label></div>
    <div className="inventory-layout">
      <div className="feature-table inventory-product-list">
        <div className="table-head"><span>Producto</span><span>SKU</span></div>
        {status === 'loading' ? <FeatureState type="loading" text="Cargando productos" /> : status === 'error' ? <FeatureState type="error" text="No se pudieron cargar" /> : !products.length ? <FeatureState type={query ? 'no-results' : 'empty'} text="No hay productos" /> : products.map((product) => <article key={product.id} className={`clickable-row ${selected?.id === product.id ? 'active' : ''}`} onClick={() => setSelected(product)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setSelected(product) }}><div><strong>{product.nombre}</strong></div><span>{product.sku}</span></article>)}
      </div>
      <div className="inventory-detail">
        {!selected ? <FeatureState type="empty" text="Selecciona un producto" /> : stockLoading ? <FeatureState type="loading" text="Cargando stock" /> : !summary ? <FeatureState type="error" text="No se pudo cargar el stock" /> : <div className="stock-breakdown">
          <h3>{selected.nombre}</h3>
          <div className="stock-total"><span>Saldo disponible</span><strong>{stock?.saldoDisponible ?? 0}</strong></div>
          {summary.hasSucursalSplit
            ? <div className="customer-metrics"><div><span>Tienda</span><strong>{summary.tienda}</strong></div><div><span>Almacén</span><strong>{summary.almacen}</strong></div></div>
            : <div className="customer-metrics"><div><span>Disponible</span><strong>{summary.total}</strong></div></div>}
        </div>}
      </div>
    </div>
  </FeatureShell>
}
