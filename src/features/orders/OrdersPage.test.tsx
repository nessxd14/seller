// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { OrderView } from '../../application/shared/models'
import { OrdersPage } from './OrdersPage'
import { CashSessionProvider } from '../../context/CashSessionContext'
import { navigate } from '../../router/history'

vi.mock('../../infrastructure/supabase/CobroPedido.supabase', () => ({
  consultarDetalleCobroPedido: vi.fn().mockRejectedValue(new Error('Detalle de prueba sin activar')),
  consultarCobrosPedidos: vi.fn().mockResolvedValue(new Map([
    ['501', { estado: 'pagado', totalCents: 90000, aplicadoCents: 90000, enRevisionCents: 0, pendienteCents: 0, porCobrarCents: 0, partidas: 1 }],
    ['503', { estado: 'por_verificar', totalCents: 50000, aplicadoCents: 0, enRevisionCents: 50000, pendienteCents: 50000, porCobrarCents: 0, partidas: 1 }],
  ])),
}))

// Brief: mismo bug que en Cotizaciones — list() ya no trae líneas (tope de 1.000 filas
// de Supabase a nivel de proyecto, que ningún .range() del cliente puede levantar), así
// que abrir un pedido puntual por URL (recarga directa en /pedidos/:id, o el botón
// "Ver" de la fila) ya no puede reusar el objeto que trajo list() — siempre tendría
// lines: []. Este test simula justo ese escenario: orderService.list() devuelve la
// cabecera con lines: [] (como en producción tras el fix) y orderService.getById()
// devuelve las líneas reales — el detalle debe mostrar las de getById, nunca las
// (vacías) de list().
const { orderHeaderOnly, attentionHeaderOnly, getByIdMock, marcarVistaMock } = vi.hoisted(() => {
  const header: OrderView = {
    id: '501', number: 'PED-2026-00501', customerId: 'c1', customerName: 'Cliente Uno', channel: 'mayoreo',
    status: 'confirmed', createdAt: '2026-08-20T00:00:00Z', lines: [], events: [], totalCents: 90000, subtotalCents: 90000,
  }
  const withLines: OrderView = {
    ...header,
    lines: [{ id: 'l1', productId: 'p1', name: 'Producto Fresco', sku: 'P1', quantity: 1, unitPriceCents: 90000, discountBasisPoints: 0, prepared: 0, allocations: [] }],
  }
  // Brief: pedido con alerta_lineas_en sin ver todavía — needsAttention: true en la
  // grilla hasta que se abra el detalle (marcarPedidoAtencionVista lo apaga).
  const attentionHeader: OrderView = {
    id: '503', number: 'PED-2026-00503', customerId: 'c2', customerName: 'Cliente Dos', channel: 'mayoreo',
    status: 'confirmed', createdAt: '2026-08-21T00:00:00Z', lines: [], events: [], totalCents: 50000, subtotalCents: 50000, needsAttention: true,
  }
  const attentionWithLines: OrderView = { ...attentionHeader, lines: [] }
  const getByIdMock = vi.fn((id: string) => Promise.resolve(id === '501' ? withLines : id === '503' ? attentionWithLines : null))
  return { orderHeaderOnly: header, attentionHeaderOnly: attentionHeader, getByIdMock, marcarVistaMock: vi.fn().mockResolvedValue(undefined) }
})

vi.mock('../../infrastructure/services', () => ({
  orderService: { list: vi.fn().mockResolvedValue([orderHeaderOnly, attentionHeaderOnly]), getById: (id: string) => getByIdMock(id), save: vi.fn(), partialDispatch: vi.fn(), cancel: vi.fn(), restore: vi.fn() },
  cashService: { list: vi.fn().mockResolvedValue([]), getOpenSession: vi.fn().mockResolvedValue(null), getAdvancesForOrder: vi.fn().mockResolvedValue([]) },
  turnoService: { getSesionAbierta: vi.fn().mockResolvedValue(null) },
  authSessionProvider: { getSession: vi.fn().mockResolvedValue(null) },
  productRepository: { search: vi.fn().mockResolvedValue({ items: [], total: 0 }), getById: vi.fn().mockResolvedValue(null) },
  sensitiveOperations: { execute: vi.fn() },
}))
// Estas pruebas cubren el detalle de siempre: con el flag de edición de pedidos apagado la
// pantalla tiene que seguir exactamente igual (es el camino de vuelta atrás).
vi.mock('../../config/featureFlags', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../config/featureFlags')>()
  return { featureFlags: { ...original.featureFlags, edicionPedido: false } }
})
vi.mock('../../infrastructure/supabase/OrderAdmin.supabase', () => ({
  contarVersionesPedidos: vi.fn().mockResolvedValue(new Map()),
  listVersionesPedido: vi.fn().mockResolvedValue([]),
  puedeEliminarsePedido: vi.fn().mockResolvedValue(null),
  eliminarPedido: vi.fn(),
}))
vi.mock('../../infrastructure/supabase/OrderRepository.supabase', () => ({
  buildLineasJsonb: vi.fn().mockReturnValue([]),
  listComprasDePedido: vi.fn().mockResolvedValue([]),
  marcarPedidoAtencionVista: (id: number) => marcarVistaMock(id),
}))
vi.mock('../../infrastructure/hermes/client', () => ({
  registrarPago: vi.fn(),
  agregarLineasPedido: vi.fn(),
  AmpliarPedidoError: class AmpliarPedidoError extends Error { get esConflicto() { return false } },
}))
vi.mock('../../infrastructure/supabase/PendienteSyncHermesPagoRepository', () => ({
  pendienteSyncHermesPagoRepository: { registrarFallo: vi.fn() },
}))

afterEach(cleanup)

describe('OrdersPage — cobro visible y separado del estado de entrega', () => {
  it('muestra y filtra el cobro de cada pedido sin marcar como pagado una propuesta', async () => {
    window.history.pushState({}, '', '/')
    render(<CashSessionProvider><OrdersPage notify={() => {}} /></CashSessionProvider>)
    const first = (await screen.findByText('PED-2026-00501')).closest('article')!
    const second = (await screen.findByText('PED-2026-00503')).closest('article')!
    await waitFor(() => expect(within(first).getByText('Pagado')).toBeTruthy())
    expect(within(second).getByText('Por verificar')).toBeTruthy()
    expect(within(second).queryByText('Pagado')).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por cobro' }), { target: { value: 'pagado' } })
    expect(screen.queryByText('PED-2026-00503')).toBeNull()
    expect(screen.getByText('PED-2026-00501')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por cobro' }), { target: { value: 'por_verificar' } })
    expect(screen.queryByText('PED-2026-00501')).toBeNull()
    expect(screen.getByText('PED-2026-00503')).toBeTruthy()
  })
})

describe('OrdersPage — abrir por URL trae el pedido fresco', () => {
  it('/pedidos/501 muestra las líneas de getById, no las (vacías) de list()', async () => {
    window.history.pushState({}, '', '/pedidos/501')
    render(<CashSessionProvider><OrdersPage notify={() => {}} /></CashSessionProvider>)

    await waitFor(() => expect(getByIdMock).toHaveBeenCalledWith('501'))
    expect((await screen.findAllByText('Producto Fresco')).length).toBeGreaterThan(0)

    window.history.pushState({}, '', '/')
  })
})

// Brief: Almacén rechazó/cambió una línea → pedido.alerta_lineas_en se marca en Cation.
// La grilla debe mostrar un flag de "necesita atención" para ese pedido hasta que
// alguien lo abra en Seller (marcar_pedido_atencion_vista lo apaga).
describe('OrdersPage — flag de atención de Almacén', () => {
  it('la fila muestra el flag mientras needsAttention es true, y desaparece al abrir el detalle', async () => {
    window.history.pushState({}, '', '/')
    render(<CashSessionProvider><OrdersPage notify={() => {}} /></CashSessionProvider>)

    const flagTitle = 'Almacén rechazó o cambió un ítem — sin revisar'
    await screen.findByTitle(flagTitle)

    navigate('/pedidos/503')
    await waitFor(() => expect(getByIdMock).toHaveBeenCalledWith('503'))
    await waitFor(() => expect(marcarVistaMock).toHaveBeenCalledWith(503))

    navigate('/')
    await waitFor(() => expect(screen.queryByTitle(flagTitle)).toBeNull())
  })
})
