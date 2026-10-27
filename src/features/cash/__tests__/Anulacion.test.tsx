// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AnulacionSolicitud, VentaTicketRecord } from '../../../application/shared/models'
import { VentaDetalleModal } from '../VentaDetalleModal'
import { MisSolicitudesAnulacion, SolicitudesAnulacionBandeja } from '../SolicitudesAnulacion'

const mocks = vi.hoisted(() => ({ getTicket: vi.fn(), puedeAnular: vi.fn(), listar: vi.fn(), anular: vi.fn(), solicitar: vi.fn(), retirar: vi.fn(), aprobar: vi.fn(), rechazar: vi.fn() }))
vi.mock('../../../infrastructure/services', () => ({
  authSessionProvider: { subscribe: () => () => {} },
  saleService: { getTicket: (...a: unknown[]) => mocks.getTicket(...a) },
  anulacionService: { puedeAnular: mocks.puedeAnular, listar: mocks.listar, anular: mocks.anular, solicitar: mocks.solicitar, retirar: mocks.retirar, aprobar: mocks.aprobar, rechazar: mocks.rechazar },
}))

const ticket = (over: Partial<VentaTicketRecord> = {}): VentaTicketRecord => ({
  ventaId: '5', numero: 'VTA-2026-00005', estado: 'COMPLETADA', creadoEn: new Date().toISOString(), lineas: [],
  subtotalBs: 40, descuentoBs: 0, totalBs: 40, pagos: [{ metodo: 'EFECTIVO', montoBs: 40, estadoVerificacion: 'OK' }], ...over,
})
const solicitud = (over: Partial<AnulacionSolicitud> = {}): AnulacionSolicitud => ({
  id: '3', ventaId: '5', numero: 'VTA-2026-00005', total: 40, ventaEstado: 'COMPLETADA', cliente: 'Ana', estado: 'SOLICITADA', motivo: 'Cobro duplicado',
  solicitadaPor: 'caja@x.com', solicitadaEn: new Date().toISOString(), sesionCobroId: '7', sesionCobroAbierta: true, cobrado: 40, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getTicket.mockResolvedValue(ticket())
  mocks.puedeAnular.mockResolvedValue(false)
  mocks.listar.mockResolvedValue([])
})
afterEach(cleanup)

describe('VentaDetalleModal — anulación', () => {
  it('cajero (o admin que no es anulador): solo "Solicitar anulación", motivo obligatorio, y luego queda solicitada', async () => {
    mocks.solicitar.mockResolvedValue({ solicitudId: '3', ventaId: '5', estado: 'SOLICITADA' })
    const notify = vi.fn(); const onChanged = vi.fn(); const onClose = vi.fn()
    render(<VentaDetalleModal id="5" notify={notify} onChanged={onChanged} onClose={onClose} />)
    expect(screen.queryByRole('button', { name: 'Anular venta' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Solicitar anulación' }))
    const dialog = await screen.findByRole('dialog', { name: 'Solicitar anulación de VTA-2026-00005' })
    const enviar = within(dialog).getByRole('button', { name: 'Enviar solicitud' }) as HTMLButtonElement
    expect(enviar.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: 'Cobro duplicado' } })
    fireEvent.click(enviar)
    await waitFor(() => expect(mocks.solicitar).toHaveBeenCalledWith('5', 'Cobro duplicado'))
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Solicitud de anulación enviada'))
    expect(onChanged).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('con solicitud pendiente muestra "Anulación solicitada" y permite retirarla; oculta el botón de anular', async () => {
    mocks.listar.mockResolvedValue([solicitud()])
    mocks.retirar.mockResolvedValue(undefined)
    const onChanged = vi.fn()
    render(<VentaDetalleModal id="5" notify={() => {}} onChanged={onChanged} onClose={() => {}} />)
    await screen.findByText(/Anulación solicitada · esperando revisión/)
    expect(screen.queryByRole('button', { name: 'Solicitar anulación' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retirar' }))
    await waitFor(() => expect(mocks.retirar).toHaveBeenCalledWith('3'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('Ness/gerente: "Anular venta" anula con el motivo', async () => {
    mocks.puedeAnular.mockResolvedValue(true)
    mocks.anular.mockResolvedValue({ ventaId: '5', estado: 'ANULADA', devuelto: 40, fueraDeArqueo: true })
    const notify = vi.fn()
    render(<VentaDetalleModal id="5" notify={notify} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Anular venta' }))
    const dialog = await screen.findByRole('dialog', { name: 'Anular VTA-2026-00005' })
    fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: 'PRUEBA – anular' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anular venta' }))
    await waitFor(() => expect(mocks.anular).toHaveBeenCalledWith('5', 'PRUEBA – anular'))
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('FUERA DE ARQUEO'))
  })

  it('una venta anulada no ofrece anular', async () => {
    mocks.getTicket.mockResolvedValue(ticket({ estado: 'ANULADA' }))
    render(<VentaDetalleModal id="5" onClose={() => {}} />)
    await screen.findByText('Venta anulada')
    expect(screen.queryByRole('button', { name: /anul/i })).toBeNull()
  })
})

describe('SolicitudesAnulacionBandeja', () => {
  it('lista la solicitud con su badge y rechazar exige nota ≥ 5', async () => {
    mocks.rechazar.mockResolvedValue(undefined)
    const onResolved = vi.fn()
    render(<SolicitudesAnulacionBandeja pendientes={[solicitud()]} resueltas={[]} notify={() => {}} onResolved={onResolved} />)
    expect(screen.getByText('Devuelve desde turno #7')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar' }))
    const confirmar = screen.getByRole('button', { name: 'Confirmar rechazo' }) as HTMLButtonElement
    expect(confirmar.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Motivo del rechazo/), { target: { value: 'No procede' } })
    fireEvent.click(confirmar)
    await waitFor(() => expect(mocks.rechazar).toHaveBeenCalledWith('3', 'No procede'))
    expect(onResolved).toHaveBeenCalled()
  })

  it('aprobar muestra la línea de devolución antes de confirmar', async () => {
    mocks.aprobar.mockResolvedValue({ ventaId: '5', estado: 'ANULADA', devuelto: 40, fueraDeArqueo: false, reintegroSesionId: '7' })
    render(<SolicitudesAnulacionBandeja pendientes={[solicitud()]} resueltas={[]} notify={() => {}} onResolved={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }))
    expect(screen.getByText('Se devolverá Bs 40,00 desde el turno #7 (afecta su arqueo).')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar anulación' }))
    await waitFor(() => expect(mocks.aprobar).toHaveBeenCalledWith('3', undefined))
  })

  it('turno cerrado → badge "Fuera de arqueo"; las resueltas van en un desplegable', () => {
    render(<SolicitudesAnulacionBandeja pendientes={[solicitud({ sesionCobroAbierta: false })]} resueltas={[solicitud({ id: '4', estado: 'RECHAZADA', notaResolucion: 'No procede' })]} notify={() => {}} onResolved={() => {}} />)
    expect(screen.getByText('Fuera de arqueo')).toBeTruthy()
    expect(screen.getByText('Resueltas recientes (1)')).toBeTruthy()
  })
})

describe('MisSolicitudesAnulacion', () => {
  it('se oculta si no hay solicitudes', () => {
    const { container } = render(<MisSolicitudesAnulacion solicitudes={[]} notify={() => {}} onChanged={() => {}} />)
    expect(container.textContent).toBe('')
  })
  it('muestra el estado y permite retirar solo las pendientes', async () => {
    mocks.retirar.mockResolvedValue(undefined)
    const onChanged = vi.fn()
    render(<MisSolicitudesAnulacion solicitudes={[solicitud(), solicitud({ id: '4', estado: 'RECHAZADA', notaResolucion: 'No procede' })]} notify={() => {}} onChanged={onChanged} />)
    expect(screen.getByText('Pendiente')).toBeTruthy()
    expect(screen.getByText('Rechazada')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Retirar' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Retirar' }))
    await waitFor(() => expect(mocks.retirar).toHaveBeenCalledWith('3'))
    expect(onChanged).toHaveBeenCalled()
  })
})
