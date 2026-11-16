// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AuthSession } from '../../../application/auth/AuthSessionProvider'
import type { TransferRecord } from '../../../application/shared/models'

const mocks = vi.hoisted(() => ({ list: vi.fn(), getById: vi.fn(), receive: vi.fn(), create: vi.fn(), turnoActual: vi.fn() }))
vi.mock('../../../infrastructure/services', () => ({
  transferService: mocks, pisoRepository: { turnoActual: mocks.turnoActual },
  productRepository: { search: vi.fn(), resolveScannedCode: vi.fn() }, listPresentations: vi.fn(), getStockBySucursalBatch: vi.fn(),
}))
vi.mock('../EscanerContinuo', () => ({ EscanerContinuo: () => null, vibrarDesconocido: vi.fn() }))
vi.mock('../../../mobile/TrasladoTicketMovil', () => ({ TrasladoTicketMovil: () => <p>Ticket QR</p> }))
import { TrasladosPiso } from '../TrasladosPiso'

const sesion: AuthSession = { user: { id: 'u', name: 'Josias', role: 'reponedor', active: true, sucursalId: 2 }, expiresAt: '2999-01-01' }
const hoy = new Date().toISOString()
const linea = (id: string, recibida?: number) => ({ id, productId: '1', name: 'Cinta', sku: 'C', cantidadBase: 10, cantidadDespachada: 10, cantidadRecibida: recibida, estado: 'DESPACHADA' as const })
const base = (o: Partial<TransferRecord>): TransferRecord => ({ id: '1', numero: 'TRA-2026-00088', motivo: 'REPOSICION', estado: 'SOLICITADO', sucursalOrigenId: 1, sucursalDestinoId: 2, solicitadoPor: 'Josias', solicitadoEn: hoy, creadoEn: hoy, lines: [linea('11')], ...o })
beforeEach(() => { vi.clearAllMocks(); mocks.turnoActual.mockResolvedValue(null) })
afterEach(cleanup)

it('solo muestra traslados a Tienda, en camino arriba y con pastillas', async () => {
  mocks.list.mockResolvedValue([
    base({ id: '1', estado: 'EN_TRANSITO', despachadoEn: hoy }),
    base({ id: '2', numero: 'TRA-2026-00087', estado: 'SOLICITADO' }),
    base({ id: '3', numero: 'TRA-2026-00086', estado: 'RECIBIDO', recibidoEn: hoy, lines: [linea('31', 8)] }),
    base({ id: '4', numero: 'TRA-2026-00085', estado: 'RECIBIDO', recibidoEn: hoy, lines: [linea('41', 10)] }),
    base({ id: '5', numero: 'TRA-2026-00084', estado: 'CANCELADO' }),
    base({ id: '6', numero: 'TRA-2026-00001', estado: 'SOLICITADO', sucursalDestinoId: 1 }),
  ])
  render(<TrasladosPiso session={sesion} aviso={vi.fn()} />)
  expect(await screen.findByText(/Traslado 88 · 1 producto/)).toBeTruthy()
  expect(screen.getByText('En camino')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Recibir y contar' })).toBeTruthy()
  expect(screen.getByText('Pedido')).toBeTruthy()
  expect(screen.getByText('Con faltante')).toBeTruthy()
  expect(screen.getByText('Recibido')).toBeTruthy()
  expect(screen.getByText('Cancelado')).toBeTruthy()
  expect(screen.queryByText(/Traslado 1 ·/)).toBeNull()
  expect(screen.getByText(/lo pediste tú/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /despach|revert|recuper|devoluci/i })).toBeNull()
})

it('el detalle es de solo lectura y no muestra nombres de otras personas', async () => {
  mocks.list.mockResolvedValue([base({ id: '2', solicitadoPor: 'Cajera Ana', despachadoPor: 'Almacenero Beto' })])
  render(<TrasladosPiso session={sesion} aviso={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /Traslado 88/ }))
  expect(await screen.findByText(/Pediste 10/)).toBeTruthy()
  expect(screen.queryByText(/Ana|Beto/)).toBeNull()
})

it('iniciarPedido abre la pantalla de pedir', async () => {
  mocks.list.mockResolvedValue([])
  render(<TrasladosPiso session={sesion} aviso={vi.fn()} iniciarPedido />)
  expect(await screen.findByRole('heading', { name: 'Pedir a almacén' })).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Pedir a almacén' }) as HTMLButtonElement).disabled).toBe(true)
})

it('Recibir y contar abre la recepción', async () => {
  const t = base({ estado: 'EN_TRANSITO', despachadoEn: hoy })
  mocks.list.mockResolvedValue([t]); mocks.getById.mockResolvedValue(t)
  render(<TrasladosPiso session={sesion} aviso={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Recibir y contar' }))
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Recibir traslado 88' })).toBeTruthy())
})
