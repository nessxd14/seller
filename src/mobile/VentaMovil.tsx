import { BellRing, ChevronDown, Plus, ReceiptText, ScanLine, Search, ShoppingCart, X } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
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
import { CERRAR_CARRITO } from './useBotonAtras'
import { PreTicketMovil } from './PreTicketMovil'
import { TrasladoTicketMovil } from './TrasladoTicketMovil'
import type { TransferRecord } from '../application/shared/models'

const bs = (v: number) => v.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export interface VentaMovilProps {
  search: string
  setSearch: (value: string) => void
  category: string
  setCategory: (value: string) => void
  /** El mismo panel de carrito del escritorio (cliente, líneas, VTD, cobro); en el celular vive en una hoja.
   *  Recibe con qué avisar un traslado creado, para mostrar su ticket térmico con QR. */
  carrito: (alCrearTraslado: (traslado: TransferRecord) => void) => ReactNode
  /** Abre en caja un pedido de vendedor leído por su QR (PDV-…). Ausente si el rol no cobra pedidos. */
  onPedidoVendedor?: (pedidoId: string) => void
  /** Pedidos de piso enviados a caja y aún sin tomar (el mismo contador del carrito de escritorio). */
  pedidosEnEspera?: number
  /** Abre la cola de pedidos de piso. Ausente si el rol no cobra pedidos. */
  onAbrirPedidos?: () => void
  /** "Nueva operación" del escritorio: mismas validaciones y la misma confirmación. */
  onNueva: () => void
  nuevaBloqueada?: boolean
  notify: (mensaje: string) => void
}

const ETIQUETA_MODO: Record<string, string> = { venta: 'Venta', traslado: 'Traslado', ventaDirecta: 'Venta directa' }

export function VentaMovil({ search, setSearch, category, setCategory, carrito, onPedidoVendedor, pedidosEnEspera = 0, onAbrirPedidos, onNueva, nuevaBloqueada = false, notify }: VentaMovilProps) {
  const { cart, total, addProduct, mode } = usePos()
  const [carritoAbierto, setCarritoAbierto] = useState(false)
  const [camara, setCamara] = useState(false)
  const [ambiguos, setAmbiguos] = useState<number[] | null>(null)
  const [preTicket, setPreTicket] = useState(false)
  const [trasladoCreado, setTrasladoCreado] = useState<TransferRecord | null>(null)
  const unidades = cart.reduce((n, item) => n + item.cantidad, 0)

  // El carrito vacío no se queda abierto (por ejemplo, después de cobrar). Ajuste durante el render, sin efecto.
  const [largoPrevio, setLargoPrevio] = useState(cart.length)
  if (cart.length !== largoPrevio) { setLargoPrevio(cart.length); if (!cart.length && largoPrevio > 0) setCarritoAbierto(false) }

  // Abrir el carrito apaga la cámara: no tiene sentido seguir escaneando detrás de la hoja.
  const abrirCarrito = () => { setCamara(false); setCarritoAbierto(true) }
  // Botón Atrás de Android (ver useBotonAtras).
  useEffect(() => {
    const cerrar = () => setCarritoAbierto(false)
    window.addEventListener(CERRAR_CARRITO, cerrar)
    return () => window.removeEventListener(CERRAR_CARRITO, cerrar)
  }, [])

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

    {!carritoAbierto && <div className="movil-pie-venta">
      {pedidosEnEspera > 0 && onAbrirPedidos && <button type="button" className="movil-aviso-pedidos" onClick={onAbrirPedidos}><BellRing aria-hidden="true" /> {pedidosEnEspera} {pedidosEnEspera === 1 ? 'pedido de piso espera' : 'pedidos de piso esperan'} cobro</button>}
      {/* Siempre visible: aun vacío, el carrito es donde están "+ Agregar" (VTD por cobrar, pedidos de piso, ítem personalizado) y el cambio de modo. */}
      <button type="button" className={`movil-barra-carrito ${cart.length ? '' : 'vacio'}`} onClick={abrirCarrito}>
        <span className="movil-barra-carrito-cuenta"><ShoppingCart aria-hidden="true" />{cart.length > 0 && <b>{cart.length}</b>}</span>
        {cart.length
          ? <span className="movil-barra-carrito-texto"><small>{ETIQUETA_MODO[mode] ?? 'Venta'} · {cart.length} {cart.length === 1 ? 'producto' : 'productos'} · {unidades} uds</small><strong>{mode === 'traslado' ? 'Ver traslado' : `Bs ${bs(total)}`}</strong></span>
          : <span className="movil-barra-carrito-texto"><small>{ETIQUETA_MODO[mode] ?? 'Venta'} · carrito vacío</small><strong>Agregar VTD, pedido o ítem</strong></span>}
        <span className="movil-barra-carrito-accion">{cart.length ? 'Ver carrito' : 'Abrir'}</span>
      </button>
    </div>}

    {/* El panel queda montado aunque esté oculto: conserva lo que el cajero va armando (cliente, notas, VTD).
        pos-root + data-modo: los estilos del carrito de escritorio cuelgan de esos atributos. */}
    <section className={`movil-carrito pos-root ${carritoAbierto ? 'abierto' : ''}`} data-modo={mode} aria-label="Carrito" aria-hidden={!carritoAbierto} inert={!carritoAbierto}>
      <header className="movil-carrito-cabecera">
        <button type="button" onClick={() => setCarritoAbierto(false)}><ChevronDown aria-hidden="true" /> Seguir</button>
        {/* Pre-ticket de VTA, VTD o traslado según el modo del carrito. */}
        <button type="button" className="movil-ticket" disabled={!cart.length} onClick={() => setPreTicket(true)}><ReceiptText aria-hidden="true" /> Ticket previo</button>
        <button type="button" className="movil-nueva" disabled={nuevaBloqueada} onClick={onNueva} aria-label="Nueva venta"><Plus aria-hidden="true" /> Nueva</button>
      </header>
      {carrito(setTrasladoCreado)}
    </section>

    {preTicket && <PreTicketMovil onClose={() => setPreTicket(false)} />}
    {trasladoCreado && <TrasladoTicketMovil traslado={trasladoCreado} onClose={() => setTrasladoCreado(null)} />}
    {ambiguos && <AmbiguousScanPicker productIds={ambiguos} onPick={(p) => { setAmbiguos(null); void agregarProducto(p) }} onClose={() => setAmbiguos(null)} />}
  </div>
}
