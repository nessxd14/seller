import { PackageOpen, Plus, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { categories, getPrice, products } from '../data/products'
import { usePos } from '../context/PosContext'
import { ProductVisual } from './ProductVisual'
import { productRepository, listBrands, getStockBySucursalBatch } from '../infrastructure/services'
import { featureFlags } from '../config/featureFlags'
import type { Product } from '../types'
import { ProductInfoPopover } from './ProductInfoPopover'
import { isLineUnpriced } from '../domain/sales/priceCheck'

const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// TAREA 6: not the literal string 'Sin marca' as a filter VALUE colliding with a
// real brand — a sentinel that can never equal a real `marca` value.
const SIN_MARCA = '__sin_marca__'

export function ProductCatalog({ search, category, setCategory }: { search: string; category: string; setCategory: (value: string) => void }) {
  const { channel, addProduct } = usePos()
  const query = search.trim().toLowerCase()
  const [brand, setBrand] = useState('')
  const [brandOptions, setBrandOptions] = useState<{ marcas: string[]; sinMarca: number }>({ marcas: [], sinMarca: 0 })
  useEffect(() => { void listBrands().then(setBrandOptions) }, [])

  // Supabase-sourced products, fetched async and debounced. Mock mode below keeps
  // the exact previous synchronous filtering behavior unchanged.
  const [remoteProducts, setRemoteProducts] = useState<Product[]>([])
  useEffect(() => {
    if (!featureFlags.supabase) return
    let cancelled = false
    const handle = setTimeout(() => {
      // Note: the Supabase adapter has no real `categoria` column (it's loosely
      // mapped from `marca`), so category filtering here is best-effort and out
      // of scope to fix — this only filters client-side on whatever `categoria`
      // the adapter already returns.
      void productRepository.search({ query: search, active: true, page: { page: 1, pageSize: 60 } }).then((page) => { if (!cancelled) setRemoteProducts(page.items) })
    }, 300)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [search, category])

  // TAREA 1: stockTienda/stockAlmacen vienen en 0 fijo desde rowToProduct (Supabase
  // no llena stock ahí, para no cargar stock_actual entero por cada producto listado).
  // Se resuelve acá, en un solo batch por página de grilla — mientras carga, la píldora
  // muestra "—" en vez de un 0 falso.
  const [stockByProduct, setStockByProduct] = useState<Map<number, { tienda: number; almacen: number }>>(new Map())
  const [stockLoading, setStockLoading] = useState(false)
  useEffect(() => {
    if (!featureFlags.supabase || !remoteProducts.length) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading flag must flip the instant the page changes, before the batch fetch resolves
    setStockLoading(true)
    void getStockBySucursalBatch(remoteProducts.map((product) => product.id))
      .then((stock) => { if (!cancelled) { setStockByProduct(stock); setStockLoading(false) } })
      .catch(() => { if (!cancelled) setStockLoading(false) })
    return () => { cancelled = true }
  }, [remoteProducts])

  // Brand ANDs with search + category (all three combined), never a replacement for
  // either. `descripcion` doubles as `marca` on the Supabase adapter's mapped Product
  // shape (see rowToProduct) — mock mode has no marca concept, so the brand filter is
  // effectively a no-op there (brandOptions.marcas is always empty in mock mode).
  const matchesBrand = (product: Product) => {
    if (!brand) return true
    if (brand === SIN_MARCA) return !product.descripcion
    return product.descripcion === brand
  }

  const filtered = featureFlags.supabase
    ? remoteProducts.filter((product) => (category === 'Todos' || category === 'Frecuentes' || product.categoria === category) && matchesBrand(product))
    : products.filter((product) => (category === 'Todos' || category === 'Frecuentes' || product.categoria === category) && matchesBrand(product) && (!query || [product.nombre, product.sku, product.codigoBarra, product.codigoFabrica].some((value) => value.toLowerCase().includes(query))))

  return <>
    <div className="category-row"><div className="category-scroll">{categories.map((item) => <button key={item} onClick={() => setCategory(item)} className={category === item ? 'active' : ''}>{item}</button>)}</div>
      {(brandOptions.marcas.length > 0 || brandOptions.sinMarca > 0) && (
        <select aria-label="Filtrar por marca" className="brand-filter select-skin" value={brand} onChange={(e) => setBrand(e.target.value)}>
          <option value="">Todas las marcas</option>
          {brandOptions.marcas.map((m) => <option key={m} value={m}>{m}</option>)}
          {brandOptions.sinMarca > 0 && <option value={SIN_MARCA}>Sin marca</option>}
        </select>
      )}
      <button className="filter-button" title="Más filtros"><SlidersHorizontal /></button></div>
    <div className="section-heading"><div><p>Catálogo de productos</p><span>{filtered.length} productos disponibles</span></div><small>Precios en Bs</small></div>
    {filtered.length ? <div className="product-grid">{filtered.map((product) => <article className="product-card" key={product.id}>
      <ProductVisual type={product.imagen} color={product.color} imagenUrl={product.imagenUrl} />
      <div className="product-info"><div className="stock-pill"><span /> {
        featureFlags.supabase
          ? (stockLoading ? '—' : (stockByProduct.get(product.id)?.tienda ?? 0))
          : product.stockTienda
      } en tienda</div><ProductInfoPopover product={product} /><h3 title={product.nombre}>{product.nombre}</h3><p>{product.descripcion}</p><small>SKU {product.sku}</small><div className="product-bottom"><div><span>Precio</span><strong>Bs {money(getPrice(product, channel))}{
        // TAREA A/three-state badges: "heredado" only means something when there's a real
        // (non-zero) price being inherited from retail — if retail itself is 0/NULL there's
        // nothing to inherit, so this shows "sin precio" instead of the misleading "heredado".
        isLineUnpriced({ precioAplicado: getPrice(product, channel) })
          ? <small className="price-heredado-badge price-overridden-badge" title="Este producto no tiene precio configurado en ningún canal.">sin precio</small>
          : channel !== 'retail' && product.preciosHeredados?.[channel] && <small className="price-heredado-badge" title="Sin precio propio para este canal: se usa el precio de mostrador.">heredado</small>
      }</strong></div><button onClick={() => addProduct(product)}><Plus /> Agregar</button></div></div>
    </article>)}</div> : <div className="empty-products"><PackageOpen /><h3>No encontramos productos</h3><p>Prueba con otro nombre, código o categoría.</p></div>}
  </>
}
