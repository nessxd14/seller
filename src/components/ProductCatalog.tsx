import { PackageOpen, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getPrice, products } from '../data/products'
import { usePos } from '../context/PosContext'
import { ProductVisual } from './ProductVisual'
import { productRepository, listBrands, getStockBySucursalBatch, listFrecuentes } from '../infrastructure/services'
import { featureFlags } from '../config/featureFlags'
import type { Product } from '../types'
import { ProductInfoPopover } from './ProductInfoPopover'
import { isLineUnpriced } from '../domain/sales/priceCheck'

const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// TAREA 6: not the literal string 'Sin marca' as a filter VALUE colliding with a
// real brand — a sentinel that can never equal a real `marca` value.
const SIN_MARCA = '__sin_marca__'

// TAREA 2 (Tanda 3): producto.categoria no existe en el esquema y no hay tabla de
// categorías — familia (32% de cobertura) y marca (una sola marca cubre más de la
// mitad del catálogo) tampoco sirven como navegación. Solo quedan dos chips reales:
// Todos y Frecuentes (este último resuelto de verdad contra ventas, ver listFrecuentes).
// El filtro por marca sigue existiendo aparte (el <select> más abajo).
const CATEGORIAS = ['Todos', 'Frecuentes']

export function ProductCatalog({ search, category, setCategory }: { search: string; category: string; setCategory: (value: string) => void }) {
  const { channel, addProduct } = usePos()
  const query = search.trim().toLowerCase()
  const [brand, setBrand] = useState('')
  const [brandOptions, setBrandOptions] = useState<{ marcas: string[]; sinMarca: number }>({ marcas: [], sinMarca: 0 })
  useEffect(() => { void listBrands().then(setBrandOptions) }, [])

  // Supabase-sourced products, fetched async and debounced. Mock mode below keeps
  // the exact previous synchronous filtering behavior unchanged. Skipped entirely on
  // the Frecuentes chip: that data comes from listFrecuentes below instead.
  const [remoteProducts, setRemoteProducts] = useState<Product[]>([])
  useEffect(() => {
    if (!featureFlags.supabase || category === 'Frecuentes') return
    let cancelled = false
    const handle = setTimeout(() => {
      void productRepository.search({ query: search, active: true, page: { page: 1, pageSize: 60 } }).then((page) => { if (!cancelled) setRemoteProducts(page.items) })
    }, 300)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [search, category])

  // TAREA 2 (Tanda 3): los N productos más vendidos de los últimos 30 días — el único
  // chip real además de Todos. Se resuelve igual en ambos backends (mock también expone
  // listFrecuentes, ver su doc comment sobre qué aproxima ahí).
  const [frecuentes, setFrecuentes] = useState<Product[]>([])
  useEffect(() => {
    if (category !== 'Frecuentes') return
    let cancelled = false
    void listFrecuentes().then((items) => { if (!cancelled) setFrecuentes(items) })
    return () => { cancelled = true }
  }, [category])

  // TAREA 1: stockTienda/stockAlmacen vienen en 0 fijo desde rowToProduct (Supabase
  // no llena stock ahí, para no cargar stock_actual entero por cada producto listado).
  // Se resuelve acá, en un solo batch por lo que esté visible (página de grilla o
  // Frecuentes) — mientras carga, la píldora muestra "—" en vez de un 0 falso.
  const [stockByProduct, setStockByProduct] = useState<Map<number, { tienda: number; almacen: number }>>(new Map())
  const [stockLoading, setStockLoading] = useState(false)
  useEffect(() => {
    if (!featureFlags.supabase) return
    const activeItems = category === 'Frecuentes' ? frecuentes : remoteProducts
    if (!activeItems.length) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading flag must flip the instant the visible set changes, before the batch fetch resolves
    setStockLoading(true)
    void getStockBySucursalBatch(activeItems.map((product) => product.id))
      .then((stock) => { if (!cancelled) { setStockByProduct(stock); setStockLoading(false) } })
      .catch(() => { if (!cancelled) setStockLoading(false) })
    return () => { cancelled = true }
  }, [remoteProducts, frecuentes, category])

  // Brand ANDs with search + category (all three combined), never a replacement for
  // either. `descripcion` doubles as `marca` on the Supabase adapter's mapped Product
  // shape (see rowToProduct) — mock mode has no marca concept, so the brand filter is
  // effectively a no-op there (brandOptions.marcas is always empty in mock mode).
  const matchesBrand = (product: Product) => {
    if (!brand) return true
    if (brand === SIN_MARCA) return !product.descripcion
    return product.descripcion === brand
  }

  // Frecuentes y modo mock filtran texto en el cliente (listFrecuentes no toma query,
  // y el mock nunca llamó a productRepository.search); el resto ya viene filtrado por
  // texto del lado del servidor en productRepository.search.
  const matchesQuery = (product: Product) =>
    !query || [product.nombre, product.sku, product.codigoBarra, product.codigoFabrica].some((value) => value.toLowerCase().includes(query))
  const sourceItems = category === 'Frecuentes' ? frecuentes : featureFlags.supabase ? remoteProducts : products
  const needsClientTextFilter = category === 'Frecuentes' || !featureFlags.supabase
  const filtered = sourceItems.filter((product) => matchesBrand(product) && (!needsClientTextFilter || matchesQuery(product)))

  return <>
    <div className="category-row"><div className="category-scroll">{CATEGORIAS.map((item) => <button key={item} onClick={() => setCategory(item)} className={category === item ? 'active' : ''}>{item}</button>)}</div>
      {(brandOptions.marcas.length > 0 || brandOptions.sinMarca > 0) && (
        <select aria-label="Filtrar por marca" className="brand-filter select-skin" value={brand} onChange={(e) => setBrand(e.target.value)}>
          <option value="">Todas las marcas</option>
          {brandOptions.marcas.map((m) => <option key={m} value={m}>{m}</option>)}
          {brandOptions.sinMarca > 0 && <option value={SIN_MARCA}>Sin marca</option>}
        </select>
      )}</div>
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
