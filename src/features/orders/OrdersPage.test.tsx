// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { OrderView } from '../../application/shared/models'
import { OrdersPage } from './OrdersPage'
import { CashSessionProvider } from '../../context/CashSessionContext'
import { navigate } from '../../router/history'

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
  authSessionProvider: { getSession: vi.fn().mockResolvedValue(null) },
  productRepository: { search: vi.fn().mockResolvedValue({ items: [], total: 0 }), getById: vi.fn().mockResolvedValue(null) },
  sensitiveOperations: { execute: vi.fn() },
}))
vi.mock('../../infrastructure/supabase/OrderAdmin.supabase', () => ({
  contarVersionesPedidos: vi.fn().mockResolvedValue(new Map()),
  listVersionesPedido: vi.fn().mockResolvedValue([]),
  puedeEliminarsePedido: vi.fn().mockResolvedValue(null),
  eliminarPedido: vi.fn(),
}))
vi.mock('../../infrastructure/supabase/OrderRepository.supabase', () => ({
  buildLineasJsonb: vi.fn().mockReturnValue([]),
  marcarPedidoAtencionVista: (id: number) => marcarVistaMock(id),
}))
vi.mock('../../infrastructure/hermes/client', () => ({
  registrarPago: vi.fn(),
  agregarLineasPedido: vi.fn(),
  AgregarLineasHttpError: class AgregarLineasHttpError extends Error {},
}))
vi.mock('../../infrastructure/supabase/PendienteSyncHermesPagoRepository', () => ({
  pendienteSyncHermesPagoRepository: { registrarFallo: vi.fn() },
}))

afterEach(cleanup)

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
