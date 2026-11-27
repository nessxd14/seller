// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { AuthSession } from '../../application/auth/AuthSessionProvider'

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), sessionId: { value: '5' as string | null }, resolve: vi.fn(), cola: vi.fn(), celular: { value: false } }))
// vi.mock se eleva sobre los imports: el helper también debe estar elevado.
const { stub } = await vi.hoisted(async () => {
  const { createElement } = await import('react')
  return { stub: (name: string) => () => createElement('div', { 'data-testid': name }) }
})

vi.mock('../../infrastructure/services', () => ({ authSessionProvider: { getSession: () => mocks.getSession(), subscribe: () => () => undefined }, pedidoVendedorService: { cola: () => mocks.cola() } }))
vi.mock('../../infrastructure/supabase/SupabaseAuthSessionProvider', () => ({ supabaseAuthSessionProvider: { signOut: vi.fn() } }))
vi.mock('../../infrastructure/supabase/ProductRepository.supabase', () => ({ productRepository: { resolveScannedCode: (c: string) => mocks.resolve(c) } }))
vi.mock('../../config/empresaStore', () => ({ loadEmpresaConfig: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../context/PosContext', () => ({
  PosProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  usePos: () => ({ newOperation: vi.fn(), cart: [], loadSuspendedSale: vi.fn(), addProduct: vi.fn(), mode: 'venta', updateQuantity: vi.fn(), removeItem: vi.fn(), selectedLineId: null, setSelectedLineId: vi.fn(), undoLastAdd: vi.fn() }),
}))
vi.mock('../../context/CashSessionContext', () => ({ CashSessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>, useCashSession: () => ({ sessionId: mocks.sessionId.value }) }))
vi.mock('../../components/CartPanel', () => ({ CartPanel: ({ pedidosVendedorEnEspera, onOpenPedidosVendedor }: { pedidosVendedorEnEspera?: number; onOpenPedidosVendedor?: () => void }) => <div data-testid="cart-panel" data-espera={pedidosVendedorEnEspera} data-enlace={onOpenPedidosVendedor ? 'si' : 'no'} /> }))
vi.mock('../../components/PosHeader', () => ({ PosHeader: ({ search, setSearch }: { search: string; setSearch: (v: string) => void }) => <div data-testid="pos-header" className="global-search"><input aria-label="buscar" value={search} onChange={(e) => setSearch(e.target.value)} /></div> }))
vi.mock('../../features/caja-pedidos/PedidoVendedorCobro', () => ({ PedidoVendedorCobro: ({ initialPedidoId }: { initialPedidoId?: string | null }) => <div data-testid="flujo-pedidos" data-pedido={initialPedidoId ?? ''} /> }))
vi.mock('../../components/PosSidebar', () => ({ PosSidebar: stub('pos-sidebar') }))
vi.mock('../../components/ProductCatalog', () => ({ ProductCatalog: stub('catalog') }))
vi.mock('../../components/SalesChannelTabs', () => ({ SalesChannelTabs: stub('tabs') }))
vi.mock('../../components/PagoModal', () => ({ PagoModal: stub('pago') }))
vi.mock('../../components/ShortcutsModal', () => ({ ShortcutsModal: stub('shortcuts') }))
vi.mock('../../components/AmbiguousScanPicker', () => ({ AmbiguousScanPicker: stub('ambiguous') }))
vi.mock('../../features/quotations/QuotationsPage', () => ({ QuotationsPage: stub('quotations') }))
vi.mock('../../features/orders/OrdersPage', () => ({ OrdersPage: stub('orders') }))
vi.mock('../../features/customers/CustomersPage', () => ({ CustomersPage: stub('customers') }))
vi.mock('../../features/cash/CashPage', () => ({ CashPage: stub('cash') }))
vi.mock('../../features/suspended-sales/SuspendedSalesPage', () => ({ SuspendedSalesPage: stub('suspended') }))
vi.mock('../../features/products/ProductsPage', () => ({ ProductsPage: stub('products') }))
vi.mock('../../features/inventory/InventoryPage', () => ({ InventoryPage: stub('inventory') }))
vi.mock('../../features/transfers/TransfersPage', () => ({ TransfersPage: stub('transfers') }))
vi.mock('../../features/venta-directa/VentaDirectaPage', () => ({ VentaDirectaPage: stub('vtd') }))
vi.mock('../../features/borradores/BorradoresPage', () => ({ BorradoresPage: stub('borradores') }))
vi.mock('../../features/settings/ConfigPage', () => ({ ConfigPage: stub('config') }))
vi.mock('../../features/reports/ReportsPage', () => ({ ReportsPage: stub('reports') }))
vi.mock('../../features/comisiones/ComisionesPage', () => ({ ComisionesPage: stub('comisiones') }))
vi.mock('../../features/auth/LoginScreen', () => ({ LoginScreen: stub('login') }))
vi.mock('../../features/auth/AuthDevSelector', () => ({ AuthDevSelector: stub('dev') }))
vi.mock('../../features/piso/PedidoPisoApp', () => ({ PedidoPisoApp: ({ modoTienda }: { modoTienda?: boolean }) => <div data-testid="piso-app" data-modo-tienda={String(!!modoTienda)} /> }))
vi.mock('../../features/pantalla/PantallaClientePage', () => ({ PantallaClientePage: () => <div data-testid="pantalla-cliente" /> }))
vi.mock('../../mobile/useEsCelular', () => ({ useEsCelular: () => mocks.celular.value }))

import { PosPage } from '../PosPage'
import { navigate } from '../../router/history'

const sessionOf = (role: string): AuthSession => ({ user: { id: 'u', name: role, role: role as AuthSession['user']['role'], active: true }, expiresAt: '2999-01-01' })

beforeEach(() => { window.history.replaceState({}, '', '/'); mocks.sessionId.value = '5'; mocks.celular.value = false; localStorage.clear(); mocks.cola.mockReset(); mocks.cola.mockResolvedValue([]) })
afterEach(cleanup)

describe('PosPage — rol pantalla (tablet del cliente)', () => {
  for (const ruta of ['/', '/caja', '/pedidos/1']) {
    it(`el rol pantalla en ${ruta} termina en /pantalla-cliente sin ver POS, menú ni carrito`, async () => {
      mocks.getSession.mockResolvedValue(sessionOf('pantalla'))
      navigate(ruta)
      render(<PosPage />)
      await screen.findByTestId('pantalla-cliente')
      expect(window.location.pathname).toBe('/pantalla-cliente')
      for (const id of ['pos-sidebar', 'pos-header', 'cart-panel', 'catalog', 'piso-app']) expect(screen.queryByTestId(id)).toBeNull()
    })
  }

  it('el rol pantalla tampoco entra a /piso', async () => {
    mocks.getSession.mockResolvedValue(sessionOf('pantalla'))
    navigate('/piso')
    render(<PosPage />)
    await screen.findByTestId('pantalla-cliente')
    expect(window.location.pathname).toBe('/pantalla-cliente')
    expect(screen.queryByTestId('piso-app')).toBeNull()
  })

  it('un cajero conserva sus rutas: la raíz sigue mostrando Venta con carrito', async () => {
    mocks.getSession.mockResolvedValue(sessionOf('cajero'))
    render(<PosPage />)
    await screen.findByTestId('cart-panel')
    expect(window.location.pathname).toBe('/')
    expect(screen.queryByTestId('pantalla-cliente')).toBeNull()
  })

  it('un cajero en /piso sigue en /piso', async () => {
    mocks.getSession.mockResolvedValue(sessionOf('cajero'))
    navigate('/piso')
    render(<PosPage />)
    await screen.findByTestId('piso-app')
    expect(window.location.pathname).toBe('/piso')
  })

  it('un cajero que abre /pantalla-cliente vuelve a la raíz y no ve la pantalla', async () => {
    mocks.getSession.mockResolvedValue(sessionOf('cajero'))
    navigate('/pantalla-cliente')
    render(<PosPage />)
    await screen.findByTestId('cart-panel')
    expect(window.location.pathname).toBe('/')
    expect(screen.queryByTestId('pantalla-cliente')).toBeNull()
  })
})
