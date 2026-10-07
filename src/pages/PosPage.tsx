import { lazy, Suspense, useEffect, useState } from 'react'
import { PosProvider, usePos } from '../context/PosContext'
import { CashSessionProvider, useCashSession } from '../context/CashSessionContext'
import { CartPanel } from '../components/CartPanel'
import { PosHeader } from '../components/PosHeader'
import { PagoModal } from '../components/PagoModal'
import { PosSidebar } from '../components/PosSidebar'
import { ProductCatalog } from '../components/ProductCatalog'
import { SalesChannelTabs } from '../components/SalesChannelTabs'
import { QuotationsPage } from '../features/quotations/QuotationsPage'
import { OrdersPage } from '../features/orders/OrdersPage'
import { CustomersPage } from '../features/customers/CustomersPage'
import { CashPage } from '../features/cash/CashPage'
import { SuspendedSalesPage, type SuspendedSale } from '../features/suspended-sales/SuspendedSalesPage'
import { removeSuspendedSale } from '../infrastructure/local/suspendedSales'
import { ShortcutsModal } from '../components/ShortcutsModal'
import { parseQuantityScan } from '../domain/sales/scanQuantity'
import { resolveActiveLineId } from '../domain/sales/activeLine'
import { ProductsPage } from '../features/products/ProductsPage'
import { InventoryPage } from '../features/inventory/InventoryPage'
import { TransfersPage, type PendingTransferRequest } from '../features/transfers/TransfersPage'
import { VentaDirectaPage } from '../features/venta-directa/VentaDirectaPage'
import { BorradoresPage } from '../features/borradores/BorradoresPage'
import { ConfigPage } from '../features/settings/ConfigPage'
import { ReportsPage } from '../features/reports/ReportsPage'
import { ComisionesPage } from '../features/comisiones/ComisionesPage'
import { featureFlags } from '../config/featureFlags'
import { products } from '../data/products'
import { productRepository as supabaseProductRepository } from '../infrastructure/supabase/ProductRepository.supabase'
import { loadEmpresaConfig } from '../config/empresaStore'
import { AmbiguousScanPicker } from '../components/AmbiguousScanPicker'
import { AuthDevSelector } from '../features/auth/AuthDevSelector'
import { LoginScreen } from '../features/auth/LoginScreen'
import { IntegrationState } from '../features/integration/IntegrationState'
import { hasPermission, type AuthSession } from '../application/auth/AuthSessionProvider'
import { authSessionProvider, pedidoVendedorService } from '../infrastructure/services'
import { supabaseAuthSessionProvider } from '../infrastructure/supabase/SupabaseAuthSessionProvider'
import type { QuoteDraft } from '../application/shared/models'
import { parseRoute, pisoPath } from '../router/appRoute'
import { navigate as navigateTo } from '../router/history'
import { PedidoVendedorCobro } from '../features/caja-pedidos/PedidoVendedorCobro'
import { parsearCodigoPedido } from '../domain/sales/pedidoCaja'
import { useRoute } from '../router/useRoute'

// Piso (teléfono del vendedor): carga diferida para que el escáner y su código no entren al bundle del POS de escritorio.
const PedidoPisoApp = lazy(() => import('../features/piso/PedidoPisoApp').then((m) => ({ default: m.PedidoPisoApp })))

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

// TAREA 3: mapa explícito de permiso por módulo — antes cualquier módulo no listado en la
// cadena de ternarios caía en `true` implícito, dejando Productos/Inventario/Traslados/
// Reportes/Configuración abiertos a cualquier rol. Los módulos que sí quedan abiertos a
// cualquier sesión activa (Suspendidas, Clientes, Productos, Inventario, Reportes) están
// deliberadamente fuera de este mapa: son de consulta y el equipo es de 5 personas.
const PERMISOS_MODULO: Record<string, (s: AuthSession | null) => boolean> = {
  'Venta': (s) => hasPermission(s, 'retail_sale') || hasPermission(s, 'wholesale_sale'),
  'Cotizaciones': (s) => hasPermission(s, 'quotes_write') || s?.user.role === 'auditor',
  'Pedidos': (s) => hasPermission(s, 'orders_view'),
  'Caja': (s) => hasPermission(s, 'cash_own') || hasPermission(s, 'cash_supervise'),
  'Traslados': (s) => hasPermission(s, 'orders_dispatch') || hasPermission(s, 'retail_sale'),
  // Brief VTD: la venta directa es retail-only (abrir_venta la rechaza para institución/
  // corporativo/mayorista) — mismo permiso que la venta de mostrador.
  'Venta Directa': (s) => hasPermission(s, 'retail_sale'),
  'Configuración': (s) => hasPermission(s, 'admin'),
}

function PosContent() {
  const { pedidoEnCarrito, setPedidoEnCarrito, operationId, vtdsEnCarrito, newOperation, cart, loadSuspendedSale, addProduct, mode, updateQuantity, removeItem, selectedLineId, setSelectedLineId, undoLastAdd } = usePos()
  // Brief S3 Parte A: /pedidos/:id, /cotizaciones/:id, /ventas/:id deben sobrevivir un
  // refresco — si el load arranca directo en una de esas URLs, hay que montar el módulo
  // que sabe abrir ese detalle (OrdersPage/QuotationsPage/ReportsPage), no el catálogo
  // de Venta por default.
  const [activeModule, setActiveModule] = useState(() => {
    const route = parseRoute(window.location.pathname)
    return route.kind === 'pedido' ? 'Pedidos' : route.kind === 'cotizacion' ? 'Cotizaciones' : route.kind === 'venta' ? 'Reportes' : 'Venta'
  })
  const route = useRoute()
  const { sessionId } = useCashSession()
  const [session, setSession] = useState<AuthSession | null>(null)
  const [sessionLoaded, setSessionLoaded] = useState(!featureFlags.supabase)
  const [conflictDemo, setConflictDemo] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('Todos')
  const [toast, setToast] = useState('')
  const [pendingDraft, setPendingDraft] = useState<QuoteDraft | null>(null)
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransferRequest | null>(null)
  const [pagoModalOpen, setPagoModalOpen] = useState(false)
  const [ambiguousIds, setAmbiguousIds] = useState<number[] | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  // Un vendedor no usa el POS de escritorio: cualquier ruta que no sea un detalle (/pedidos/:id, …) lo lleva a /piso.
  const esVendedor = session?.user.role === 'vendedor'
  useEffect(() => { if (esVendedor && route.kind === 'none') navigateTo(pisoPath, { replace: true }) }, [esVendedor, route.kind])
  // Pedidos de vendedor (caja): el flujo vive acá; el carrito solo recibe el contador y un callback.
  const puedeCobrarPedidos = featureFlags.supabase && (hasPermission(session, 'cash_own') || hasPermission(session, 'cash_supervise'))
  const [pedidosVendedor, setPedidosVendedor] = useState<{ pedidoId?: string } | null>(null)
  const [enEspera, setEnEspera] = useState(0)
  const [refrescoCola, setRefrescoCola] = useState(0)
  useEffect(() => {
    if (!puedeCobrarPedidos || !sessionId || activeModule !== 'Venta') return
    let cancelado = false
    const consultar = () => {
      if (document.visibilityState !== 'visible') return
      pedidoVendedorService.cola().then((cola) => { if (!cancelado) setEnEspera(cola.filter((p) => p.estado === 'ENVIADO').length) }).catch(() => undefined)
    }
    consultar()
    const id = window.setInterval(consultar, 10_000)
    return () => { cancelado = true; window.clearInterval(id) }
  }, [puedeCobrarPedidos, sessionId, activeModule, refrescoCola])
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2800) }
  const handleNew = () => { if (localStorage.getItem(`roari-saldo-cobro:${operationId}`)) { notify('Comprueba el cobro anterior desde Cobrar o desde Caja antes de iniciar otra operación'); return }; if (pedidoEnCarrito) { setPedidosVendedor({}); notify('Devuelve o anula el pedido desde su revisión antes de iniciar otra operación'); return }; if ((cart.length || vtdsEnCarrito.length) && !window.confirm('¿Crear una nueva operación y limpiar el carrito actual?')) return; newOperation(); setSearch(''); setCategory('Todos'); notify('Nueva operación lista') }
  useEffect(() => {
    // TAREA 9 (Tanda 3): '/' solo secuestra el foco cuando NO se está escribiendo en un
    // campo — antes solo excluía <input>, así que tipear "24/06" en el <textarea> de
    // observación de una línea mandaba el foco al buscador. contentEditable cubre
    // cualquier futuro campo enriquecido con el mismo problema.
    const isEditableTarget = (target: EventTarget | null) =>
      target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)
    const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)?.click()
    const searchInput = () => document.querySelector<HTMLInputElement>('.global-search input')
    const onKeyDown = (event: KeyboardEvent) => {
      // F2/F8/F9/etc. no deben dispararse con un modal abierto (Cobrar, Anticipo, etc. ya
      // atienden su propio teclado) — .modal-backdrop es el portal común a todos ellos.
      // La excepción es F1/'?' (abre el panel de atajos): preventDefault siempre, pero la
      // acción de abrir el panel solo corre si no hay OTRO modal ya abierto.
      const modalOpen = Boolean(document.querySelector('.modal-backdrop'))

      // --- Ayuda ---------------------------------------------------------------
      // F1: Chrome abre su propia ayuda si no se hace preventDefault. '?' es el
      // atajo alcanzable sin tecla de función, solo fuera de campos editables.
      if (event.key === 'F1') { event.preventDefault(); if (!modalOpen) setShortcutsOpen(true) }
      else if (event.key === '?' && !modalOpen && !isEditableTarget(event.target)) { event.preventDefault(); setShortcutsOpen(true) }

      // --- Búsqueda --------------------------------------------------------------
      if (event.key === 'F2' && !modalOpen) { event.preventDefault(); searchInput()?.focus() }
      else if (event.key === '/' && !modalOpen && !isEditableTarget(event.target)) { event.preventDefault(); searchInput()?.focus() }

      // --- Operación ---------------------------------------------------------------
      // Ctrl+N: Chrome lo reserva para "nueva ventana" y nunca lo entrega a la página —
      // se mantiene el handler igual, pero Alt+N es el atajo documentado.
      if (event.ctrlKey && event.key.toLowerCase() === 'n') { event.preventDefault(); handleNew() }
      if (event.altKey && event.key.toLowerCase() === 'n' && !modalOpen) { event.preventDefault(); handleNew() }
      // Ctrl+Shift+Backspace cancela la venta actual (mismo flujo que Nueva operación).
      // Nunca Ctrl+Backspace solo — ese borra una palabra dentro de un campo de texto.
      if (event.ctrlKey && event.shiftKey && event.key === 'Backspace' && !modalOpen) { event.preventDefault(); handleNew() }
      if (event.key === 'F8' && !modalOpen) { event.preventDefault(); click('[data-pos-action="suspend"]') }
      // F9 o Ctrl+Enter abren el paso de cierre del modo activo — Ctrl+Enter funciona
      // incluso con foco en el buscador, así que va aparte del Enter simple de abajo.
      if ((event.key === 'F9' || (event.ctrlKey && event.key === 'Enter')) && !modalOpen) {
        event.preventDefault()
        if (mode === 'traslado') click('[data-pos-action="solicitar-traslado"]')
        else if (mode === 'ventaDirecta') click('[data-pos-action="abrir-venta-directa"]')
        else click('[data-pos-action="pay"]')
      }
      // F6 abre el selector de cliente. Ambiente sandbox: no fue posible confirmar en vivo
      // si Chrome-on-Windows entrega F6 a la página (Chrome lo reserva en algunos builds
      // para ciclar el foco entre barra de direcciones/página) — Alt+C queda cableado en
      // paralelo como respaldo siempre activo, sin depender de detectarlo en runtime.
      if ((event.key === 'F6' || (event.altKey && event.key.toLowerCase() === 'c')) && !modalOpen) {
        event.preventDefault()
        click('.customer-select')
      }
      // F7 enfoca el descuento general. Mismo respaldo que F6: Alt+U cableado en paralelo.
      // Si el resumen está colapsado, la fila del descuento se expande antes de enfocar.
      if ((event.key === 'F7' || (event.altKey && event.key.toLowerCase() === 'u')) && !modalOpen) {
        event.preventDefault()
        const toggle = document.querySelector<HTMLButtonElement>('.cart-chrome-toggle')
        if (toggle?.getAttribute('aria-pressed') === 'true') toggle.click()
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="Descuento general"]')?.focus())
      }
      // F10 agrega un ítem personalizado (solo modo Venta). Mismo respaldo: Alt+I.
      if ((event.key === 'F10' || (event.altKey && event.key.toLowerCase() === 'i')) && !modalOpen && mode === 'venta') {
        event.preventDefault()
        click('[data-pos-action="custom-item"]')
      }

      // --- Modos ---------------------------------------------------------------
      if (event.altKey && event.key.toLowerCase() === 'v' && !modalOpen) { event.preventDefault(); click('[data-pos-action="mode-venta"]') }
      if (event.altKey && event.key.toLowerCase() === 't' && !modalOpen) { event.preventDefault(); click('[data-pos-action="mode-traslado"]') }
      if (event.altKey && event.key.toLowerCase() === 'r' && !modalOpen && featureFlags.ventaDirectaAlmacen) { event.preventDefault(); click('[data-pos-action="mode-venta-directa"]') }

      // --- Carrito ---------------------------------------------------------------
      // Activos fuera de campos editables, o con foco en el buscador si está vacío —
      // así siguen andando justo después de escanear sin romper la escritura normal
      // (los SKU llevan '-', y +/- también son parte de texto libre en otros campos).
      const inEmptySearch = event.target === searchInput() && search.trim() === ''
      const cartShortcutsActive = !modalOpen && (!isEditableTarget(event.target) || inEmptySearch)
      if (cartShortcutsActive && cart.length && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault()
        const ids = cart.map((item) => item.id)
        const current = selectedLineId != null ? ids.indexOf(selectedLineId) : -1
        const next = event.key === 'ArrowUp' ? Math.max(0, (current < 0 ? ids.length : current) - 1) : Math.min(ids.length - 1, current + 1)
        setSelectedLineId(ids[next])
      }
      // Línea objetivo de +/-, F4, *, F3: la seleccionada o, si no hay, la última (se
      // resalta antes de actuar). Supr nunca cae a la última: no se borra lo que no se ve.
      const cartIds = cart.map((item) => item.id)
      const runOnActiveLine = (action: string) => {
        const targetId = resolveActiveLineId(cartIds, selectedLineId, { fallbackToLast: true })
        if (targetId == null) return
        if (targetId === selectedLineId) { click(`.cart-item-selected [data-line-action="${action}"]`); return }
        setSelectedLineId(targetId)
        requestAnimationFrame(() => click(`.cart-item-selected [data-line-action="${action}"]`))
      }
      if (cartShortcutsActive && cart.length && (event.key === '+' || event.key === '-')) {
        event.preventDefault()
        const targetId = resolveActiveLineId(cartIds, selectedLineId, { fallbackToLast: true })
        const item = cart.find((line) => line.id === targetId)
        if (item && targetId != null) {
          if (targetId !== selectedLineId) setSelectedLineId(targetId)
          updateQuantity(targetId, item.cantidad + (event.key === '+' ? 1 : -1))
        }
      }
      // F4 / Alt+P: precio en línea (sin precios en traslado). '*' / Alt+Q: cantidad.
      // F3 / Alt+L: editor completo de la línea. Las teclas Alt van en paralelo por el mismo
      // motivo que F6/F7/F10; F3 es "buscar siguiente" en Chrome (preventDefault lo anula).
      if (cartShortcutsActive && cart.length && (event.key === 'F4' || (event.altKey && event.key.toLowerCase() === 'p')) && mode !== 'traslado') {
        event.preventDefault()
        runOnActiveLine('price')
      }
      if (cartShortcutsActive && cart.length && (event.key === '*' || (event.altKey && event.key.toLowerCase() === 'q'))) {
        event.preventDefault()
        runOnActiveLine('qty')
      }
      if (cartShortcutsActive && cart.length && (event.key === 'F3' || (event.altKey && event.key.toLowerCase() === 'l')) && mode !== 'traslado') {
        event.preventDefault()
        runOnActiveLine('edit')
      }
      if (cartShortcutsActive && selectedLineId != null && event.key === 'Delete') {
        event.preventDefault()
        const ids = cart.map((item) => item.id)
        const removedIndex = ids.indexOf(selectedLineId)
        removeItem(selectedLineId)
        const remaining = ids.filter((id) => id !== selectedLineId)
        setSelectedLineId(remaining[removedIndex] ?? remaining[removedIndex - 1] ?? null)
      }
      if (cartShortcutsActive && event.ctrlKey && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        const nombre = undoLastAdd()
        if (nombre) notify(`Deshecho: ${nombre}`)
      }

      if (event.key === 'Enter' && !event.ctrlKey && event.target === searchInput()) {
        const raw = search.trim()
        // El QR del teléfono del vendedor trae "PDV-<id>": el lector lo teclea en el buscador y abre ese pedido en caja.
        const pedidoVendedorId = puedeCobrarPedidos ? parsearCodigoPedido(raw) : null
        if (pedidoVendedorId) {
          event.preventDefault()
          setSearch('')
          if (!sessionId) notify('Abrí tu turno para cobrar')
          else setPedidosVendedor({ pedidoId: pedidoVendedorId })
          return
        }
        const parsed = parseQuantityScan(raw)
        if (!parsed) { event.preventDefault(); notify('Cantidad inválida'); return }
        const { quantity, code } = parsed
        const normalized = code.toLowerCase()
        if (featureFlags.supabase) {
          event.preventDefault()
          void (async () => {
            const resolved = await supabaseProductRepository.resolveScannedCode(code).catch(() => ({ kind: 'not_found' as const }))
            if (resolved.kind === 'found') {
              addProduct(resolved.product, quantity)
              setSearch('')
              notify(quantity > 1 ? `${quantity} × ${resolved.product.nombre} agregado` : `${resolved.product.nombre} agregado`)
            } else if (resolved.kind === 'ambiguous') {
              setAmbiguousIds(resolved.productIds)
              setSearch('')
            } else {
              notify('Código no reconocido')
            }
          })()
        } else {
          const exact = products.find((product) => [product.codigoBarra, product.sku, product.codigoFabrica, product.nombre].some((value) => value.toLowerCase() === normalized))
          if (exact) { event.preventDefault(); addProduct(exact, quantity); setSearch(''); notify(quantity > 1 ? `${quantity} × ${exact.nombre} agregado` : `${exact.nombre} agregado`) }
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })
  useEffect(() => { const show = () => setConflictDemo(true); window.addEventListener('roari:conflict-demo', show); return () => window.removeEventListener('roari:conflict-demo', show) }, [])
  // Loaded once at app start so real config_empresa data has had a chance to arrive
  // before a user opens a print preview or the login screen; empresaStore keeps
  // rendering the hardcoded fallback until this resolves (or forever, on failure).
  // Mutates a plain module-level object, not React state, so this is not subject to
  // the react-hooks/set-state-in-effect rule.
  useEffect(() => { void loadEmpresaConfig() }, [])
  // Supabase mode: real session via authSessionProvider (AuthDevSelector only wires the
  // mock provider). Mock mode is untouched — AuthDevSelector keeps driving `session` below.
  useEffect(() => {
    if (!featureFlags.supabase) return
    let cancelled = false
    void authSessionProvider.getSession().then((value) => { if (!cancelled) { setSession(value); setSessionLoaded(true) } })
    const unsubscribe = authSessionProvider.subscribe((value) => setSession(value))
    return () => { cancelled = true; unsubscribe() }
  }, [])
  const navigate = (name: string) => {
    const enabled = name === 'Venta' || name === 'Suspendidas' || name === 'Borradores' || (name === 'Cotizaciones' && featureFlags.quotations) || (name === 'Pedidos' && featureFlags.orders) || (name === 'Venta Directa' && featureFlags.ventaDirectaAlmacen) || name === 'Clientes' || (name === 'Caja' && featureFlags.cash) || name === 'Productos' || name === 'Inventario' || name === 'Traslados' || name === 'Reportes' || (name === 'Comisiones' && featureFlags.comisiones) || name === 'Configuración'
    const permission = (PERMISOS_MODULO[name] ?? (() => true))(session)
    if (enabled && permission) setActiveModule(name)
    else if(enabled) notify('Tu rol no permite abrir este módulo')
    else notify(`${name} estará disponible en una siguiente fase`)
  }
  const restoreSale = (sale: SuspendedSale) => {
    loadSuspendedSale({
      channel: sale.channel as 'retail' | 'mayoreo' | 'institucional',
      cart: sale.cart,
      discount: sale.discount,
      customer: sale.customerId || sale.customerName ? { id: sale.customerId, name: sale.customerName ?? 'Cliente de mostrador', documento: sale.customerDocument } : null,
    })
    removeSuspendedSale(sale.id)
    setActiveModule('Venta')
  }
  const readOnly=session?.user.role==='auditor'||session?.user.role==='operario'
  const page = activeModule === 'Cotizaciones' ? <QuotationsPage notify={notify} readOnly={readOnly} onOrderCreated={() => setActiveModule('Pedidos')} initialDraft={pendingDraft} onInitialDraftConsumed={() => setPendingDraft(null)} /> : activeModule === 'Pedidos' ? <OrdersPage notify={notify} readOnly={readOnly} canDispatch={hasPermission(session,'orders_dispatch')} /> : activeModule === 'Venta Directa' ? <VentaDirectaPage notify={notify} /> : activeModule === 'Borradores' ? <BorradoresPage notify={notify} onRetomado={() => setActiveModule('Venta')} /> : activeModule === 'Clientes' ? <CustomersPage notify={notify} /> : activeModule === 'Caja' ? <CashPage notify={notify} canCloseCash={!featureFlags.supabase || hasPermission(session, 'admin')} /> : activeModule === 'Suspendidas' ? <SuspendedSalesPage hasCurrentCart={Boolean(cart.length)} onRestore={restoreSale} onOpenCotizaciones={() => setActiveModule('Cotizaciones')} notify={notify} /> : activeModule === 'Productos' ? <ProductsPage notify={notify} /> : activeModule === 'Inventario' ? <InventoryPage notify={notify} /> : activeModule === 'Traslados' ? <TransfersPage notify={notify} initialRequest={pendingTransfer} onInitialRequestConsumed={() => setPendingTransfer(null)} onRegistrarDevolucion={() => setActiveModule('Venta')} /> : activeModule === 'Reportes' ? <ReportsPage notify={notify} /> : activeModule === 'Comisiones' ? <ComisionesPage notify={notify} vendedorEmail={session?.user.email ?? ''} esGerente={!featureFlags.supabase || hasPermission(session, 'commissions_manage')} /> : activeModule === 'Configuración' ? <ConfigPage notify={notify} canEdit={!featureFlags.supabase || hasPermission(session, 'admin')} /> : <main className="catalog"><div className="catalog-title"><div><span className="eyebrow">PUNTO DE VENTA</span><h1>¿Qué vamos a vender hoy?</h1></div><p>{capitalize(new Date().toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long' }))}</p></div><SalesChannelTabs /><ProductCatalog search={search} category={category} setCategory={setCategory} /></main>
  const blockKind = !session || session.user.hasProfile === false
    ? 'unauthorized'
    : !session.user.active
      ? 'inactive_user'
      : new Date(session.expiresAt).getTime() <= 0
        ? 'session_expired'
        : null
  const blocked=Boolean(blockKind)||conflictDemo
  // El módulo activo (incluido 'Venta', el de arranque) debe estar permitido para el rol: antes solo se verificaba en navigate().
  const moduloPermitido = !session || (PERMISOS_MODULO[activeModule] ?? (() => true))(session)
  if(conflictDemo)return <div className="integration-demo-page"><IntegrationState kind="conflict" onReload={()=>setConflictDemo(false)} onKeepCopy={()=>{setConflictDemo(false);notify('Copia local conservada')}} onCancel={()=>setConflictDemo(false)}/></div>
  if (featureFlags.supabase && !sessionLoaded) return null
  if (featureFlags.supabase && !session) return <LoginScreen />
  if (route.kind === 'piso') {
    if (!hasPermission(session, 'floor_order')) return <div className="piso-bloqueado" role="alert"><p>Tu rol no permite abrir esta pantalla</p></div>
    return <Suspense fallback={null}><PedidoPisoApp session={session as AuthSession} /></Suspense>
  }
  // Un vendedor que aún no fue redirigido (primer render) no debe ver ni un instante el POS completo.
  if (esVendedor && route.kind === 'none') return null
  return <div className={`app-shell pos-root ${activeModule !== 'Venta' || blocked ? 'module-mode' : ''}`} data-modo={mode}><PosSidebar active={activeModule} onNavigate={navigate} /><div className="workspace"><PosHeader search={search} setSearch={setSearch} onNew={handleNew} onRegistrarPago={() => setPagoModalOpen(true)} user={session?.user} onOpenSettings={() => navigate('Configuración')} onOpenShortcuts={() => setShortcutsOpen(true)} />{blockKind?<IntegrationState kind={blockKind}/>:!moduloPermitido?<main className="catalog"><div className="module-blocked" role="alert"><h2>Tu rol no permite abrir este módulo</h2></div></main>:page}</div>{activeModule === 'Venta'&&!blocked&&moduloPermitido && <CartPanel notify={notify} onOpenDraftOrder={(draft) => { setPendingDraft(draft); setActiveModule('Cotizaciones') }} onGoToCash={() => setActiveModule('Caja')} sellerName={session?.user.name} onRequestTransfer={(request) => { setPendingTransfer(request); setActiveModule('Traslados') }} pedidosVendedorEnEspera={enEspera} onOpenPedidosVendedor={puedeCobrarPedidos ? () => setPedidosVendedor({}) : undefined} />}{featureFlags.supabase ? <button className="logout-button" onClick={() => void supabaseAuthSessionProvider.signOut()}>Cerrar sesión{session?.user.name ? ` (${session.user.name})` : ''}</button> : <AuthDevSelector onChange={setSession}/>}{toast && <div className="toast">✓ <span>{toast}</span></div>}{pagoModalOpen && <PagoModal onClose={() => setPagoModalOpen(false)} notify={notify} />}{pedidosVendedor && sessionId && <PedidoVendedorCobro initialCart={pedidoEnCarrito} onCartChange={setPedidoEnCarrito} sessionId={sessionId} initialPedidoId={pedidosVendedor.pedidoId} notify={notify} onChanged={() => setRefrescoCola((n) => n + 1)} onClose={() => setPedidosVendedor(null)} />}{ambiguousIds && <AmbiguousScanPicker productIds={ambiguousIds} onPick={(product) => { addProduct(product); setAmbiguousIds(null); notify(`${product.nombre} agregado`) }} onClose={() => setAmbiguousIds(null)} />}{shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}</div>
}

export function PosPage() { return <PosProvider><CashSessionProvider><PosContent /></CashSessionProvider></PosProvider> }
