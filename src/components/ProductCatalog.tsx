import { PackageOpen, Plus, SlidersHorizontal } from 'lucide-react'
import { categories, getPrice, products } from '../data/products'
import { usePos } from '../context/PosContext'
import { ProductVisual } from './ProductVisual'

const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function ProductCatalog({ search, category, setCategory }: { search: string; category: string; setCategory: (value: string) => void }) {
  const { channel, addProduct } = usePos()
  const query = search.trim().toLowerCase()
  const filtered = products.filter((product) => (category === 'Todos' || category === 'Frecuentes' || product.categoria === category) && (!query || [product.nombre, product.sku, product.codigoBarra, product.codigoFabrica].some((value) => value.toLowerCase().includes(query))))

  return <>
    <div className="category-row"><div className="category-scroll">{categories.map((item) => <button key={item} onClick={() => setCategory(item)} className={category === item ? 'active' : ''}>{item}</button>)}</div><button className="filter-button" title="Más filtros"><SlidersHorizontal /></button></div>
    <div className="section-heading"><div><p>Catálogo de productos</p><span>{filtered.length} productos disponibles</span></div><small>Precios en Bs</small></div>
    {filtered.length ? <div className="product-grid">{filtered.map((product) => <article className="product-card" key={product.id}>
      <ProductVisual type={product.imagen} color={product.color} />
      <div className="product-info"><div className="stock-pill"><span /> {product.stockTienda} en tienda</div><h3>{product.nombre}</h3><p>{product.descripcion}</p><small>SKU {product.sku}</small><div className="product-bottom"><div><span>Precio</span><strong>Bs {money(getPrice(product, channel))}</strong></div><button onClick={() => addProduct(product)}><Plus /> Agregar</button></div></div>
    </article>)}</div> : <div className="empty-products"><PackageOpen /><h3>No encontramos productos</h3><p>Prueba con otro nombre, código o categoría.</p></div>}
  </>
}
