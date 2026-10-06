// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { AuthSession } from '../../application/auth/AuthSessionProvider'

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }))
// vi.mock se eleva sobre los imports: el helper también debe estar elevado.
const { stub } = await vi.hoisted(async () => {
  const { createElement } = await import('react')
  return { stub: (name: string) => () => createElement('div', { 'data-testid': name }) }
})

vi.mock('../../infrastructure/services', () => ({ authSessionProvider: { getSession: () => mocks.getSession(), subscribe: () => () => undefined } }))
vi.mock('../../infrastructure/supabase/SupabaseAuthSessionProvider', () => ({ supabaseAuthSessionProvider: { signOut: vi.fn() } }))
vi.mock('../../infrastructure/supabase/ProductRepository.supabase', () => ({ productRepository: {} }))
vi.mock('../../config/empresaStore', () => ({ loadEmpresaConfig: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../context/PosContext', () => ({
  PosProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  usePos: () => ({ newOperation: vi.fn(), cart: [], loadSuspendedSale: vi.fn(), addProduct: vi.fn(), mode: 'venta', updateQuantity: vi.fn(), removeItem: vi.fn(), selectedLineId: null, setSelectedLineId: vi.fn(), undoLastAdd: vi.fn() }),
}))
vi.mock('../../context/CashSessionContext', () => ({ CashSessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('../../components/CartPanel', () => ({ CartPanel: stub('cart-panel') }))
vi.mock('../../components/PosHeader', () => ({ PosHeader: stub('pos-header') }))
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
vi.mock('../../features/piso/PedidoPisoApp', () => ({ PedidoPisoApp: () => <div data-testid="piso-app" /> }))

import { PosPage } from '../PosPage'
import { navigate } from '../../router/history'

const sessionOf = (role: string): AuthSession => ({ user: { id: 'u', name: role, role: role as AuthSession['user']['role'], active: true }, expiresAt: '2999-01-01' })

beforeEach(() => { window.history.replaceState({}, '', '/') })
afterEach(cleanup)

describe('PosPage — /piso y permisos de módulo (Brief Piso B)', () => {
  it('un vendedor que abre la raíz va a /piso y nunca ve el POS ni el carrito', async () => {
    mocks.getSession.mockResolvedValue(sessionOf('vendedor'))
    render(<PosPage />)
    await screen.findByTestId('piso-app')
    expect(window.location.pathname).toBe('/piso')
    expect(screen.queryByTestId('cart-panel')).toBeNull()
    expect(screen.queryByTestId('pos-sidebar')).toBeNull()
  })

  it('el piso se muestra sin app-shell (sin barra lateral, header ni carrito) para un cajero', async () => {
    mocks.getSession.mockResolvedValue(sessionOf('cajero'))
    navigate('/piso')
    render(<PosPage />)
    await screen.findByTestId('piso-app')
    for (const id of ['pos-sidebar', 'pos-header', 'cart-panel']) expect(screen.queryByTestId(id)).toBeNull()
  })

  it('sin floor_order en /piso: "Tu rol no permite abrir esta pantalla"', async () => {
    mocks.getSession.mockResolvedValue(sessionOf('auditor'))
    navigate('/piso')
    render(<PosPage />)
    await screen.findByText('Tu rol no permite abrir esta pantalla')
    expect(screen.queryByTestId('piso-app')).toBeNull()
  })

  it('un rol sin retail_sale ni wholesale_sale no alcanza el módulo Venta por defecto: bloqueado y sin CartPanel', async () => {
    mocks.getSession.mockResolvedValue(sessionOf('auditor'))
    render(<PosPage />)
    await screen.findByText('Tu rol no permite abrir este módulo')
    expect(screen.queryByTestId('cart-panel')).toBeNull()
    expect(screen.queryByTestId('catalog')).toBeNull()
  })

  it('un cajero sí ve Venta con su carrito', async () => {
    mocks.getSession.mockResolvedValue(sessionOf('cajero'))
    render(<PosPage />)
    await waitFor(() => expect(screen.getByTestId('cart-panel')).toBeTruthy())
    expect(screen.getByTestId('catalog')).toBeTruthy()
  })

  it('un vendedor en una ruta de detalle (/pedidos/:id) no es redirigido', async () => {
    mocks.getSession.mockResolvedValue(sessionOf('vendedor'))
    navigate('/pedidos/55')
    render(<PosPage />)
    await screen.findByTestId('orders')
    expect(window.location.pathname).toBe('/pedidos/55')
  })
})
