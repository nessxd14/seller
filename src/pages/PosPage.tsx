import { useEffect, useState } from 'react'
import { PosProvider, usePos } from '../context/PosContext'
import { CashSessionProvider } from '../context/CashSessionContext'
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
import { ProductsPage } from '../features/products/ProductsPage'
import { InventoryPage } from '../features/inventory/InventoryPage'
import { TransfersPage, type PendingTransferRequest } from '../features/transfers/TransfersPage'
import { VentaDirectaPage } from '../features/venta-directa/VentaDirectaPage'
import { BorradoresPage } from '../features/borradores/BorradoresPage'
import { ConfigPage } from '../features/settings/ConfigPage'
import { ReportsPage } from '../features/reports/ReportsPage'
import { featureFlags } from '../config/featureFlags'
import { products } from '../data/products'
import { productRepository as supabaseProductRepository } from '../infrastructure/supabase/ProductRepository.supabase'
import { loadEmpresaConfig } from '../config/empresaStore'
import { AmbiguousScanPicker } from '../components/AmbiguousScanPicker'
import { AuthDevSelector } from '../features/auth/AuthDevSelector'
import { LoginScreen } from '../features/auth/LoginScreen'
import { IntegrationState } from '../features/integration/IntegrationState'
import { hasPermission, type AuthSession } from '../application/auth/AuthSessionProvider'
import { authSessionProvider } from '../infrastructure/services'
import { supabaseAuthSessionProvider } from '../infrastructure/supabase/SupabaseAuthSessionProvider'
import type { QuoteDraft } from '../application/shared/models'
import { parseRoute } from '../router/appRoute'

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
  const { newOperation, cart, loadSuspendedSale, addProduct, mode } = usePos()
  // Brief S3 Parte A: /pedidos/:id, /cotizaciones/:id, /ventas/:id deben sobrevivir un
  // refresco — si el load arranca directo en una de esas URLs, hay que montar el módulo
  // que sabe abrir ese detalle (OrdersPage/QuotationsPage/ReportsPage), no el catálogo
  // de Venta por default.
  const [activeModule, setActiveModule] = useState(() => {
    const route = parseRoute(window.location.pathname)
    return route.kind === 'pedido' ? 'Pedidos' : route.kind === 'cotizacion' ? 'Cotizaciones' : route.kind === 'venta' ? 'Reportes' : 'Venta'
  })
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
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2800) }
  const handleNew = () => { if (cart.length && !window.confirm('¿Crear una nueva operación y limpiar el carrito actual?')) return; newOperation(); setSearch(''); setCategory('Todos'); notify('Nueva operación lista') }
  useEffect(() => {
    // TAREA 9 (Tanda 3): '/' solo secuestra el foco cuando NO se está escribiendo en un
    // campo — antes solo excluía <input>, así que tipear "24/06" en el <textarea> de
    // observación de una línea mandaba el foco al buscador. contentEditable cubre
    // cualquier futuro campo enriquecido con el mismo problema.
    const isEditableTarget = (target: EventTarget | null) =>
      target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)
    const onKeyDown = (event: KeyboardEvent) => {
      // F2/F8/F9 no deben dispararse con un modal abierto (Cobrar, Anticipo, etc. ya
      // atienden su propio teclado) — .modal-backdrop es el portal común a todos ellos.
      const modalOpen = Boolean(document.querySelector('.modal-backdrop'))
      if (event.key === 'F2' && !modalOpen) { event.preventDefault(); document.querySelector<HTMLInputElement>('.global-search input')?.focus() }
      else if (event.key === '/' && !modalOpen && !isEditableTarget(event.target)) { event.preventDefault(); document.querySelector<HTMLInputElement>('.global-search input')?.focus() }
      if (event.ctrlKey && event.key.toLowerCase() === 'n') { event.preventDefault(); handleNew() }
      if (event.key === 'F8' && !modalOpen) { event.preventDefault(); document.querySelector<HTMLButtonElement>('[data-pos-action="suspend"]')?.click() }
      if (event.key === 'F9' && !modalOpen) { event.preventDefault(); document.querySelector<HTMLButtonElement>('[data-pos-action="pay"]')?.click() }
      if (event.key === 'Enter' && event.target === document.querySelector('.global-search input')) {
        const normalized = search.trim().toLowerCase()
        if (featureFlags.supabase) {
          event.preventDefault()
          const codigo = search.trim()
          void (async () => {
            const resolved = await supabaseProductRepository.resolveScannedCode(codigo).catch(() => ({ kind: 'not_found' as const }))
            if (resolved.kind === 'found') {
              addProduct(resolved.product)
              setSearch('')
              notify(`${resolved.product.nombre} agregado`)
            } else if (resolved.kind === 'ambiguous') {
              setAmbiguousIds(resolved.productIds)
              setSearch('')
            } else {
              notify('Código no reconocido')
            }
          })()
        } else {
          const exact = products.find((product) => [product.codigoBarra, product.sku, product.codigoFabrica, product.nombre].some((value) => value.toLowerCase() === normalized))
          if (exact) { event.preventDefault(); addProduct(exact); setSearch(''); notify(`${exact.nombre} agregado`) }
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
    const enabled = name === 'Venta' || name === 'Suspendidas' || name === 'Borradores' || (name === 'Cotizaciones' && featureFlags.quotations) || (name === 'Pedidos' && featureFlags.orders) || (name === 'Venta Directa' && featureFlags.ventaDirectaAlmacen) || name === 'Clientes' || (name === 'Caja' && featureFlags.cash) || name === 'Productos' || name === 'Inventario' || name === 'Traslados' || name === 'Reportes' || name === 'Configuración'
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
  const page = activeModule === 'Cotizaciones' ? <QuotationsPage notify={notify} readOnly={readOnly} onOrderCreated={() => setActiveModule('Pedidos')} initialDraft={pendingDraft} onInitialDraftConsumed={() => setPendingDraft(null)} /> : activeModule === 'Pedidos' ? <OrdersPage notify={notify} readOnly={readOnly} canDispatch={hasPermission(session,'orders_dispatch')} /> : activeModule === 'Venta Directa' ? <VentaDirectaPage notify={notify} /> : activeModule === 'Borradores' ? <BorradoresPage notify={notify} onRetomado={() => setActiveModule('Venta')} /> : activeModule === 'Clientes' ? <CustomersPage notify={notify} /> : activeModule === 'Caja' ? <CashPage notify={notify} canCloseCash={!featureFlags.supabase || session?.user.role === 'admin'} /> : activeModule === 'Suspendidas' ? <SuspendedSalesPage hasCurrentCart={Boolean(cart.length)} onRestore={restoreSale} onOpenCotizaciones={() => setActiveModule('Cotizaciones')} notify={notify} /> : activeModule === 'Productos' ? <ProductsPage notify={notify} /> : activeModule === 'Inventario' ? <InventoryPage notify={notify} /> : activeModule === 'Traslados' ? <TransfersPage notify={notify} initialRequest={pendingTransfer} onInitialRequestConsumed={() => setPendingTransfer(null)} onRegistrarDevolucion={() => setActiveModule('Venta')} /> : activeModule === 'Reportes' ? <ReportsPage notify={notify} /> : activeModule === 'Configuración' ? <ConfigPage notify={notify} canEdit={!featureFlags.supabase || hasPermission(session, 'admin')} /> : <main className="catalog"><div className="catalog-title"><div><span className="eyebrow">PUNTO DE VENTA</span><h1>¿Qué vamos a vender hoy?</h1></div><p>{capitalize(new Date().toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long' }))}</p></div><SalesChannelTabs /><ProductCatalog search={search} category={category} setCategory={setCategory} /></main>
  const blockKind = !session || session.user.hasProfile === false
    ? 'unauthorized'
    : !session.user.active
      ? 'inactive_user'
      : new Date(session.expiresAt).getTime() <= 0
        ? 'session_expired'
        : null
  const blocked=Boolean(blockKind)||conflictDemo
  if(conflictDemo)return <div className="integration-demo-page"><IntegrationState kind="conflict" onReload={()=>setConflictDemo(false)} onKeepCopy={()=>{setConflictDemo(false);notify('Copia local conservada')}} onCancel={()=>setConflictDemo(false)}/></div>
  if (featureFlags.supabase && !sessionLoaded) return null
  if (featureFlags.supabase && !session) return <LoginScreen />
  return <div className={`app-shell pos-root ${activeModule !== 'Venta' || blocked ? 'module-mode' : ''}`} data-modo={mode}><PosSidebar active={activeModule} onNavigate={navigate} /><div className="workspace"><PosHeader search={search} setSearch={setSearch} onNew={handleNew} onRegistrarPago={() => setPagoModalOpen(true)} user={session?.user} onOpenSettings={() => navigate('Configuración')} />{blockKind?<IntegrationState kind={blockKind}/>:page}</div>{activeModule === 'Venta'&&!blocked && <CartPanel notify={notify} onOpenDraftOrder={(draft) => { setPendingDraft(draft); setActiveModule('Cotizaciones') }} onGoToCash={() => setActiveModule('Caja')} sellerName={session?.user.name} onRequestTransfer={(request) => { setPendingTransfer(request); setActiveModule('Traslados') }} />}{featureFlags.supabase ? <button className="logout-button" onClick={() => void supabaseAuthSessionProvider.signOut()}>Cerrar sesión{session?.user.name ? ` (${session.user.name})` : ''}</button> : <AuthDevSelector onChange={setSession}/>}{toast && <div className="toast">✓ <span>{toast}</span></div>}{pagoModalOpen && <PagoModal onClose={() => setPagoModalOpen(false)} />}{ambiguousIds && <AmbiguousScanPicker productIds={ambiguousIds} onPick={(product) => { addProduct(product); setAmbiguousIds(null); notify(`${product.nombre} agregado`) }} onClose={() => setAmbiguousIds(null)} />}</div>
}

export function PosPage() { return <PosProvider><CashSessionProvider><PosContent /></CashSessionProvider></PosProvider> }
