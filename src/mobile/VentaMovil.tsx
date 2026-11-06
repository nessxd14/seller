import { ChevronDown, ScanLine, Search, ShoppingCart, X } from 'lucide-react'
import { useCallback, useState, type ReactNode } from 'react'
import { usePos } from '../context/PosContext'
import { featureFlags } from '../config/featureFlags'
import { products } from '../data/products'
import { parsearCodigoPedido } from '../domain/sales/pedidoCaja'
import { parseQuantityScan } from '../domain/sales/scanQuantity'
import { productRepository as supabaseProductRepository } from '../infrastructure/supabase/ProductRepository.supabase'
import { presentacionAlAgregar } from '../lib/presentacionAlAgregar'
import { AmbiguousScanPicker } from '../components/AmbiguousScanPicker'
import { ProductCatalog } from '../components/ProductCatalog'
import { SalesChannelTabs } from '../components/SalesChannelTabs'
import { EscanerContinuo, vibrar, vibrarDesconocido } from '../features/piso/EscanerContinuo'
import type { Product } from '../types'

const bs = (v: number) => v.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export interface VentaMovilProps {
  search: string
  setSearch: (value: string) => void
  category: string
  setCategory: (value: string) => void
  /** El mismo panel de carrito del escritorio (cliente, líneas, VTD, cobro); en el celular vive en una hoja. */
  carrito: ReactNode
  /** Abre en caja un pedido de vendedor leído por su QR (PDV-…). Ausente si el rol no cobra pedidos. */
  onPedidoVendedor?: (pedidoId: string) => void
  notify: (mensaje: string) => void
}

export function VentaMovil({ search, setSearch, category, setCategory, carrito, onPedidoVendedor, notify }: VentaMovilProps) {
  const { cart, total, addProduct, mode } = usePos()
  const [carritoAbierto, setCarritoAbierto] = useState(false)
  const [camara, setCamara] = useState(false)
  const [ambiguos, setAmbiguos] = useState<number[] | null>(null)
  const unidades = cart.reduce((n, item) => n + item.cantidad, 0)

  // El carrito vacío no se queda abierto (por ejemplo, después de cobrar). Ajuste durante el render, sin efecto.
  const [largoPrevio, setLargoPrevio] = useState(cart.length)
  if (cart.length !== largoPrevio) { setLargoPrevio(cart.length); if (!cart.length) setCarritoAbierto(false) }

  const agregarProducto = useCallback(async (producto: Product, cantidad = 1, presentacion?: Parameters<typeof presentacionAlAgregar>[2]) => {
    const permiso = mode === 'traslado' ? { ok: true as const } : await presentacionAlAgregar(producto.id, 'tienda', presentacion)
    if (!permiso.ok) { notify(permiso.mensaje); return false }
    addProduct(producto, cantidad)
    vibrar(30)
    notify(cantidad > 1 ? `${cantidad} × ${producto.nombre} agregado` : `${producto.nombre} agregado`)
    return true
  }, [mode, addProduct, notify])

  // Misma lectura que el Enter del buscador de escritorio: PDV-… abre el pedido del vendedor; "3*código" suma 3.
  const procesarCodigo = useCallback(async (crudo: string) => {
    const texto = crudo.trim()
    if (!texto) return
    const pedidoId = onPedidoVendedor ? parsearCodigoPedido(texto) : null
    if (pedidoId) { setSearch(''); setCamara(false); onPedidoVendedor?.(pedidoId); return }
    const leido = parseQuantityScan(texto)
    if (!leido) { notify('Cantidad inválida'); return }
    if (featureFlags.supabase) {
      const r = await supabaseProductRepository.resolveScannedCode(leido.code).catch(() => ({ kind: 'not_found' as const }))
      if (r.kind === 'found') { if (await agregarProducto(r.product, leido.quantity, r.presentation)) setSearch('') }
      else if (r.kind === 'ambiguous') { setAmbiguos(r.productIds); setSearch('') }
      else { vibrarDesconocido(); notify('Código no reconocido') }
      return
    }
    const buscado = leido.code.toLowerCase()
    const exacto = products.find((p) => [p.codigoBarra, p.sku, p.codigoFabrica, p.nombre].some((v) => v.toLowerCase() === buscado))
    if (exacto) { if (await agregarProducto(exacto, leido.quantity)) setSearch('') }
    else { vibrarDesconocido(); notify('Código no reconocido') }
  }, [onPedidoVendedor, setSearch, notify, agregarProducto])

  return <div className="movil-venta">
    <section className="movil-venta-captura" aria-label="Agregar productos">
      <form className="movil-buscador" role="search" onSubmit={(e) => { e.preventDefault(); void procesarCodigo(search) }}>
        <Search aria-hidden="true" />
        <input type="search" inputMode="search" enterKeyHint="search" autoComplete="off" placeholder="Buscar o escribir código" aria-label="Buscar producto" value={search} onChange={(e) => setSearch(e.target.value)} />
        {search && <button type="button" className="movil-limpiar" aria-label="Limpiar búsqueda" onClick={() => setSearch('')}><X /></button>}
        <button type="button" className="movil-escanear" aria-pressed={camara} aria-label={camara ? 'Cerrar cámara' : 'Escanear con la cámara'} onClick={() => setCamara((v) => !v)}><ScanLine /></button>
      </form>
      {camara && <div className="movil-camara">
        <EscanerContinuo onCodigo={(c) => void procesarCodigo(c)} plegado={false} linterna={false} onSoporteLinterna={() => undefined} />
        <button type="button" className="movil-camara-cerrar" onClick={() => setCamara(false)}><ChevronDown aria-hidden="true" /> Ocultar cámara</button>
      </div>}
    </section>

    <div className="movil-venta-canal"><SalesChannelTabs /></div>
    <div className="movil-venta-catalogo"><ProductCatalog search={search} category={category} setCategory={setCategory} /></div>

    {cart.length > 0 && !carritoAbierto && <button type="button" className="movil-barra-carrito" onClick={() => setCarritoAbierto(true)}>
      <span className="movil-barra-carrito-cuenta"><ShoppingCart aria-hidden="true" /><b>{cart.length}</b></span>
      <span className="movil-barra-carrito-texto"><small>{cart.length} {cart.length === 1 ? 'producto' : 'productos'} · {unidades} uds</small><strong>{mode === 'traslado' ? 'Ver traslado' : `Bs ${bs(total)}`}</strong></span>
      <span className="movil-barra-carrito-accion">Ver carrito</span>
    </button>}

    {/* El panel queda montado aunque esté oculto: conserva lo que el cajero va armando (cliente, notas, VTD).
        pos-root + data-modo: los estilos del carrito de escritorio cuelgan de esos atributos. */}
    <section className={`movil-carrito pos-root ${carritoAbierto ? 'abierto' : ''}`} data-modo={mode} aria-label="Carrito" aria-hidden={!carritoAbierto} inert={!carritoAbierto}>
      <header className="movil-carrito-cabecera"><button type="button" onClick={() => setCarritoAbierto(false)}><ChevronDown aria-hidden="true" /> Seguir agregando</button></header>
      {carrito}
    </section>

    {ambiguos && <AmbiguousScanPicker productIds={ambiguos} onPick={(p) => { setAmbiguos(null); void agregarProducto(p) }} onClose={() => setAmbiguos(null)} />}
  </div>
}
