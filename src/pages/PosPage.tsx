import { useEffect, useState } from 'react'
import { PosProvider, usePos } from '../context/PosContext'
import { CashSessionProvider } from '../context/CashSessionContext'
import { CartPanel } from '../components/CartPanel'
import { PosHeader } from '../components/PosHeader'
import { PosSidebar } from '../components/PosSidebar'
import { ProductCatalog } from '../components/ProductCatalog'
import { SalesChannelTabs } from '../components/SalesChannelTabs'
import { QuotationsPage } from '../features/quotations/QuotationsPage'
import { OrdersPage } from '../features/orders/OrdersPage'
import { CustomersPage } from '../features/customers/CustomersPage'
import { CashPage } from '../features/cash/CashPage'
import { SuspendedSalesPage, type SuspendedSale } from '../features/suspended-sales/SuspendedSalesPage'
import { ProductsPage } from '../features/products/ProductsPage'
import { InventoryPage } from '../features/inventory/InventoryPage'
import { PlaceholderPage } from '../features/shared/PlaceholderPage'
import { featureFlags } from '../config/featureFlags'
import { products } from '../data/products'
import { productRepository } from '../infrastructure/services'
import { AuthDevSelector } from '../features/auth/AuthDevSelector'
import { IntegrationState } from '../features/integration/IntegrationState'
import { hasPermission, type AuthSession } from '../application/auth/AuthSessionProvider'
import type { QuoteDraft } from '../application/shared/models'

function PosContent() {
  const { newOperation, cart, loadSuspendedSale, addProduct } = usePos()
  const [activeModule, setActiveModule] = useState('Venta')
  const [session, setSession] = useState<AuthSession | null>(null)
  const [conflictDemo, setConflictDemo] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('Todos')
  const [toast, setToast] = useState('')
  const [pendingDraft, setPendingDraft] = useState<QuoteDraft | null>(null)
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2800) }
  const handleNew = () => { if (cart.length && !window.confirm('¿Crear una nueva operación y limpiar el carrito actual?')) return; newOperation(); setSearch(''); setCategory('Todos'); notify('Nueva operación lista') }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F2' || (event.key === '/' && !(event.target instanceof HTMLInputElement))) { event.preventDefault(); document.querySelector<HTMLInputElement>('.global-search input')?.focus() }
      if (event.ctrlKey && event.key.toLowerCase() === 'n') { event.preventDefault(); handleNew() }
      if (event.key === 'F8') { event.preventDefault(); document.querySelector<HTMLButtonElement>('[data-pos-action="suspend"]')?.click() }
      if (event.key === 'F9') { event.preventDefault(); document.querySelector<HTMLButtonElement>('[data-pos-action="pay"]')?.click() }
      if (event.key === 'Enter' && event.target === document.querySelector('.global-search input')) {
        const normalized = search.trim().toLowerCase()
        if (featureFlags.supabase) {
          event.preventDefault()
          const codigo = search.trim()
          void (async () => {
            const exact = await productRepository.findBySku(codigo).catch(() => null)
            if (exact) { addProduct(exact); setSearch(''); notify(`${exact.nombre} agregado`) }
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
  const navigate = (name: string) => {
    const enabled = name === 'Venta' || name === 'Suspendidas' || (name === 'Cotizaciones' && featureFlags.quotations) || (name === 'Pedidos' && featureFlags.orders) || name === 'Clientes' || (name === 'Caja' && featureFlags.cash) || name === 'Productos' || name === 'Inventario' || name === 'Reportes' || name === 'Configuración'
    const permission = name === 'Venta' ? (hasPermission(session,'retail_sale')||hasPermission(session,'wholesale_sale')) : name === 'Cotizaciones' ? (hasPermission(session,'quotes_write')||session?.user.role==='auditor') : name === 'Pedidos' ? hasPermission(session,'orders_view') : name === 'Caja' ? (hasPermission(session,'cash_own')||hasPermission(session,'cash_supervise')) : true
    if (enabled && permission) setActiveModule(name)
    else if(enabled) notify('Tu rol no permite abrir este módulo')
    else notify(`${name} estará disponible en una siguiente fase`)
  }
  const restoreSale = (sale: SuspendedSale) => {
    loadSuspendedSale({ channel: sale.channel as 'retail' | 'mayoreo' | 'institucional', cart: sale.cart, discount: sale.discount })
    localStorage.setItem('roari-suspended-sales-v2', JSON.stringify((JSON.parse(localStorage.getItem('roari-suspended-sales-v2') || '[]') as SuspendedSale[]).filter((item) => item.id !== sale.id)))
    setActiveModule('Venta')
  }
  const readOnly=session?.user.role==='auditor'||session?.user.role==='operario'
  const page = activeModule === 'Cotizaciones' ? <QuotationsPage notify={notify} readOnly={readOnly} onOrderCreated={() => setActiveModule('Pedidos')} initialDraft={pendingDraft} onInitialDraftConsumed={() => setPendingDraft(null)} /> : activeModule === 'Pedidos' ? <OrdersPage notify={notify} readOnly={readOnly} canDispatch={hasPermission(session,'orders_dispatch')} /> : activeModule === 'Clientes' ? <CustomersPage notify={notify} /> : activeModule === 'Caja' ? <CashPage notify={notify} /> : activeModule === 'Suspendidas' ? <SuspendedSalesPage hasCurrentCart={Boolean(cart.length)} onRestore={restoreSale} notify={notify} /> : activeModule === 'Productos' ? <ProductsPage notify={notify} /> : activeModule === 'Inventario' ? <InventoryPage notify={notify} /> : activeModule === 'Reportes' ? <PlaceholderPage title="Reportes" /> : activeModule === 'Configuración' ? <PlaceholderPage title="Configuración" /> : <main className="catalog"><div className="catalog-title"><div><span className="eyebrow">PUNTO DE VENTA</span><h1>¿Qué vamos a vender hoy?</h1></div><p>Miércoles, 23 de julio</p></div><SalesChannelTabs /><ProductCatalog search={search} category={category} setCategory={setCategory} /></main>
  const blockKind = !session || session.user.hasProfile === false
    ? 'unauthorized'
    : !session.user.active
      ? 'inactive_user'
      : new Date(session.expiresAt).getTime() <= 0
        ? 'session_expired'
        : null
  const blocked=Boolean(blockKind)||conflictDemo
  if(conflictDemo)return <div className="integration-demo-page"><IntegrationState kind="conflict" onReload={()=>setConflictDemo(false)} onKeepCopy={()=>{setConflictDemo(false);notify('Copia local conservada')}} onCancel={()=>setConflictDemo(false)}/></div>
  return <div className={`app-shell ${activeModule !== 'Venta' || blocked ? 'module-mode' : ''}`}><PosSidebar active={activeModule} onNavigate={navigate} /><div className="workspace"><PosHeader search={search} setSearch={setSearch} onNew={handleNew} />{blockKind?<IntegrationState kind={blockKind}/>:page}</div>{activeModule === 'Venta'&&!blocked && <CartPanel notify={notify} onOpenDraftOrder={(draft) => { setPendingDraft(draft); setActiveModule('Cotizaciones') }} onGoToCash={() => setActiveModule('Caja')} />}<AuthDevSelector onChange={setSession}/>{toast && <div className="toast">✓ <span>{toast}</span></div>}</div>
}

export function PosPage() { return <PosProvider><CashSessionProvider><PosContent /></CashSessionProvider></PosProvider> }
