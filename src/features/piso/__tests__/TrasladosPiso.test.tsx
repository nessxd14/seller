// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AuthSession } from '../../../application/auth/AuthSessionProvider'
import type { TrasladoPiso } from '../../../application/ports/pisoRepository'
import type { TransferRecord } from '../../../application/shared/models'
import { qrContentForTraslado } from '../../../domain/documents/qrContent'

const mocks = vi.hoisted(() => ({ getById: vi.fn(), receive: vi.fn(), create: vi.fn(), turnoActual: vi.fn(), traslados: vi.fn() }))
vi.mock('../../../infrastructure/services', () => ({
  transferService: mocks, pisoRepository: { turnoActual: mocks.turnoActual, traslados: mocks.traslados },
  productRepository: { search: vi.fn(), resolveScannedCode: vi.fn() }, listPresentations: vi.fn(), getStockBySucursalBatch: vi.fn(),
}))
vi.mock('../EscanerContinuo', () => ({ EscanerContinuo: () => null, vibrarDesconocido: vi.fn() }))
vi.mock('../../../mobile/TrasladoTicketMovil', () => ({ TrasladoTicketMovil: () => <p>Ticket QR</p> }))
vi.mock('../../../components/DocQr', () => ({ DocQr: ({ content }: { content: string }) => <div data-testid="doc-qr" data-content={content} /> }))
import { TrasladosPiso } from '../TrasladosPiso'

const sesion: AuthSession = { user: { id: 'u', name: 'Josias', role: 'reponedor', active: true, sucursalId: 2 }, expiresAt: '2999-01-01' }
const hoy = new Date().toISOString()
const tr = (o: Partial<TrasladoPiso>): TrasladoPiso => ({
  id: '1', numero: 'TRA-2026-00088', estado: 'SOLICITADO', motivo: 'REPOSICION', origenId: 1, destinoId: 2, solicitadoEn: hoy, mio: true, nota: null,
  tareaEstado: null, alista: null, alistadoEn: null, retira: null, retiroMio: false, recibidoEn: null, lineas: 1, conFaltante: false, ...o,
})
const responder = (traslados: TrasladoPiso[]) => mocks.traslados.mockResolvedValue({ sucursalId: 2, traslados })

beforeEach(() => { vi.clearAllMocks(); mocks.turnoActual.mockResolvedValue(null) })
afterEach(cleanup)

it('arma las secciones y las pastillas de cada estado, con el flujo viejo en «Por recibir»', async () => {
  responder([
    tr({ id: '1', estado: 'EN_TRANSITO', numero: 'TRA-2026-00091' }),
    tr({ id: '2', numero: 'TRA-2026-00090', tareaEstado: 'PREPARADO', alista: 'Beto', alistadoEn: hoy }),
    tr({ id: '3', numero: 'TRA-2026-00089', tareaEstado: 'REVISANDO', retira: 'Ana' }),
    tr({ id: '4', numero: 'TRA-2026-00088', tareaEstado: 'PREPARANDO', alista: 'Beto' }),
    tr({ id: '5', numero: 'TRA-2026-00087' }),
    tr({ id: '6', numero: 'TRA-2026-00086', estado: 'RECIBIDO', tareaEstado: 'RECIBIDO', recibidoEn: hoy }),
    tr({ id: '7', numero: 'TRA-2026-00085', estado: 'RECIBIDO', tareaEstado: 'RECIBIDO', recibidoEn: hoy, conFaltante: true }),
    tr({ id: '8', numero: 'TRA-2026-00084', estado: 'CANCELADO' }),
  ])
  render(<TrasladosPiso session={sesion} aviso={vi.fn()} />)
  expect(await screen.findByRole('heading', { name: /Para retirar en almacén/ })).toBeTruthy()
  for (const texto of ['Listo para retirar', 'Retirando', 'En alistado', 'Pedido', 'Recibido', 'Con faltante', 'Cancelado', 'En camino']) expect(screen.getByText(texto)).toBeTruthy()
  expect(screen.getByText(/Alistó Beto a las \d{2}:\d{2} · lo pediste tú/)).toBeTruthy()
  expect(screen.getByText('Ana está comprobando')).toBeTruthy()
  expect(screen.getByText('Beto lo está alistando')).toBeTruthy()
  expect(screen.getAllByRole('button', { name: 'Ver QR' })).toHaveLength(2)
  expect(screen.getAllByRole('link', { name: 'Retirar en Almacén' })).toHaveLength(2)
  expect(screen.getByRole('button', { name: 'Recibir y contar' })).toBeTruthy()
  // Icono de QR solo en los abiertos de «Mis pedidos»: En alistado y Pedido.
  expect(screen.getAllByRole('button', { name: /Ver QR del traslado/ })).toHaveLength(2)
  expect(screen.getByText(/Almacén alista con el QR; tú lo retiras en Almacén/)).toBeTruthy()
})

it('«Retirar en Almacén» enlaza al QR del traslado', async () => {
  responder([tr({ id: '2', tareaEstado: 'PREPARADO', alista: 'Beto', alistadoEn: hoy })])
  render(<TrasladosPiso session={sesion} aviso={vi.fn()} />)
  const enlace = await screen.findByRole('link', { name: 'Retirar en Almacén' })
  expect(enlace.getAttribute('href')).toBe(qrContentForTraslado('2'))
  expect(enlace.getAttribute('target')).toBe('_blank')
})

it('«Ver QR» abre la hoja con el QR, el enlace y el ticket', async () => {
  responder([tr({ id: '2', numero: 'TRA-2026-00090', tareaEstado: 'PREPARADO', alista: 'Beto', alistadoEn: hoy })])
  mocks.getById.mockResolvedValue({ id: '2', numero: 'TRA-2026-00090' } as TransferRecord)
  render(<TrasladosPiso session={sesion} aviso={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ver QR' }))
  const hoja = await screen.findByRole('dialog')
  expect(within(hoja).getByText('Traslado 90')).toBeTruthy()
  expect(within(hoja).getByText(/TRA-2026-00090 · Almacén Central → Tienda · Listo para retirar/)).toBeTruthy()
  expect(within(hoja).getByText('Almacén lo escanea para alistar. Para retirarlo, ábrelo tú en Almacén con tu cuenta.')).toBeTruthy()
  expect(within(hoja).getByTestId('doc-qr').dataset.content).toBe(qrContentForTraslado('2'))
  expect(within(hoja).getByRole('link', { name: /Abrir en Almacén para retirar/ }).getAttribute('href')).toBe(qrContentForTraslado('2'))
  fireEvent.click(within(hoja).getByRole('button', { name: /Imprimir ticket/ }))
  expect(await screen.findByText('Ticket QR')).toBeTruthy()
  expect(mocks.getById).toHaveBeenCalledWith('2')
})

it('el icono de QR de un pedido abierto abre la misma hoja y Cerrar la quita', async () => {
  responder([tr({ id: '5', numero: 'TRA-2026-00087' })])
  render(<TrasladosPiso session={sesion} aviso={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ver QR del traslado 87' }))
  const hoja = await screen.findByRole('dialog')
  fireEvent.click(within(hoja).getAllByRole('button', { name: 'Cerrar' }).at(-1) as HTMLElement)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('no muestra nombres de cajeros ni de otras personas fuera de alistado y retiro', async () => {
  responder([tr({ id: '5', nota: 'Cajera Ana' })])
  render(<TrasladosPiso session={sesion} aviso={vi.fn()} />)
  await screen.findByText(/almacén aún no lo toma/)
  expect(screen.queryByText(/Cajera Ana/)).toBeNull()
})

it('iniciarPedido abre la pantalla de pedir', async () => {
  responder([])
  render(<TrasladosPiso session={sesion} aviso={vi.fn()} iniciarPedido />)
  expect(await screen.findByRole('heading', { name: 'Pedir a almacén' })).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Pedir a almacén' }) as HTMLButtonElement).disabled).toBe(true)
})

it('Recibir y contar (flujo viejo) abre la recepción', async () => {
  const t = tr({ estado: 'EN_TRANSITO' })
  responder([t])
  mocks.getById.mockResolvedValue({
    id: '1', numero: 'TRA-2026-00088', motivo: 'REPOSICION', estado: 'EN_TRANSITO', sucursalOrigenId: 1, sucursalDestinoId: 2, solicitadoPor: 'Josias', solicitadoEn: hoy, creadoEn: hoy, despachadoEn: hoy,
    lines: [{ id: '11', productId: '1', name: 'Cinta', sku: 'C', cantidadBase: 10, cantidadDespachada: 10, estado: 'DESPACHADA' }],
  })
  render(<TrasladosPiso session={sesion} aviso={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Recibir y contar' }))
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Recibir traslado 88' })).toBeTruthy())
})
