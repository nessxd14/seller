// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { VentaDirectaRecord } from '../../../application/shared/models'
import { VentaDirectaPage } from '../VentaDirectaPage'

const mocks = vi.hoisted(() => ({ listAbiertas: vi.fn(), completar: vi.fn(), cobrarVtd: vi.fn(), getById: vi.fn(), marcarPagoPosterior: vi.fn(), puedeAnular: vi.fn(), anular: vi.fn(), solicitar: vi.fn() }))
vi.mock('../../../context/CashSessionContext', () => ({ useCashSession: () => ({ sessionId: '1' }) }))
vi.mock('../../../components/VtdTicketPreviewModal', () => ({ VtdTicketPreviewModal: ({ venta }: { venta: VentaDirectaRecord }) => <div role="dialog" aria-label="ticket">ticket {venta.numero}</div> }))
vi.mock('../../../infrastructure/services', () => ({
  authSessionProvider: { subscribe: () => () => {} },
  anulacionService: { puedeAnular: (...a: unknown[]) => mocks.puedeAnular(...a), anular: (...a: unknown[]) => mocks.anular(...a), solicitar: (...a: unknown[]) => mocks.solicitar(...a) },
  ventaDirectaService: {
    listAbiertas: (...a: unknown[]) => mocks.listAbiertas(...a),
    completar: (...a: unknown[]) => mocks.completar(...a),
    cobrarVtd: (...a: unknown[]) => mocks.cobrarVtd(...a),
    getById: (...a: unknown[]) => mocks.getById(...a),
    marcarPagoPosterior: (...a: unknown[]) => mocks.marcarPagoPosterior(...a),
    anular: vi.fn(), ajustar: vi.fn(),
  },
}))

const base: VentaDirectaRecord = {
  id: '1', numero: 'VTD-2026-00001', estado: 'ABIERTA', modo: 'POSTCOBRADO', ubicacionId: 1, sesionCajaId: '1',
  subtotalCents: 15000, discountCents: 0, totalCents: 15000, paidCents: 0, cobroExigible: true, pagoPosterior: false,
  creadoEn: new Date().toISOString(), lines: [{ id: 'l1', productId: '9', name: 'Resma', sku: 'R', cantidadPresentacion: 1, precioUnitarioCents: 15000 }],
}
const TRIGGER_MSG = 'VTD-2026-00001 no está cobrada. Cóbrala en caja antes de entregar, o márcala como pago posterior con motivo.'
const entrega = () => screen.getByRole('button', { name: /Consultar entrega/ }) as HTMLButtonElement

beforeEach(() => { vi.clearAllMocks(); mocks.listAbiertas.mockResolvedValue([base]); mocks.puedeAnular.mockResolvedValue(true) })
afterEach(cleanup)

describe('Bandeja de Venta Directa — cobro obligatorio (Brief Caja VTD obligatorio A3/A5)', () => {
  it('una VTD sin cobrar ofrece cobro y consulta de entrega sin descontar stock desde Caja', async () => {
    render(<VentaDirectaPage notify={() => {}} />)
    await screen.findByText('POR COBRAR')
    expect(screen.getByRole('button', { name: /^Cobrar$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pago posterior…' })).toBeTruthy()
    expect(entrega().disabled).toBe(false)
    expect(screen.queryByRole('button', { name: /Completar/ })).toBeNull()
    expect(mocks.completar).not.toHaveBeenCalled()
  })

  it('"Cobrar" confirma con cobrar_vtd para esa única venta y encola el ticket pagado', async () => {
    mocks.cobrarVtd.mockResolvedValue({ reintento: false, sesionCajaId: '1', ventas: [], totalBs: 150, cambioBs: 0, pendienteVerificacion: true })
    mocks.getById.mockResolvedValue({ ...base, paidCents: 15000, modo: 'PRECOBRADO' })
    const notify = vi.fn()
    render(<VentaDirectaPage notify={notify} />)
    fireEvent.click(await screen.findByRole('button', { name: /^Cobrar$/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar cobro' }))
    await waitFor(() => expect(mocks.cobrarVtd).toHaveBeenCalledOnce())
    expect(mocks.cobrarVtd).toHaveBeenCalledWith({ ventaIds: ['1'], sesionCajaId: '1', pagos: [{ method: 'cash', amountCents: 15000, receivedCents: 15000 }] })
    await screen.findByText('ticket VTD-2026-00001')
    expect(notify).toHaveBeenCalledWith('Pago QR/transferencia pendiente de verificación del gerente')
    expect(mocks.listAbiertas.mock.calls.length).toBeGreaterThan(1)
  })

  it('una VTD pagada o con pago posterior permite consultar su entrega y muestra motivo y contacto', async () => {
    mocks.listAbiertas.mockResolvedValue([
      { ...base, id: '2', numero: 'VTD-2026-00002', paidCents: 15000 },
      { ...base, id: '3', numero: 'VTD-2026-00003', pagoPosterior: true, pagoPosteriorMotivo: 'Cliente paga el viernes', pagoPosteriorContacto: 'Ana 70011223' },
    ])
    render(<VentaDirectaPage notify={() => {}} />)
    await screen.findByText('PAGADO')
    expect(screen.getByText('PAGO POSTERIOR')).toBeTruthy()
    expect(screen.getByText('Cliente paga el viernes')).toBeTruthy()
    expect(screen.getByText(/Ana 70011223/)).toBeTruthy()
    for (const button of screen.getAllByRole('button', { name: /Consultar entrega/ })) expect((button as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByRole('button', { name: /^Cobrar$/ })).toBeNull()
  })

  it('muestra el error recibido al consultar la entrega', async () => {
    mocks.listAbiertas.mockResolvedValue([{ ...base, cobroExigible: false }])
    mocks.getById.mockRejectedValue(new Error(TRIGGER_MSG))
    const notify = vi.fn()
    render(<VentaDirectaPage notify={notify} />)
    await screen.findByText('Histórica')
    fireEvent.click(entrega())
    await waitFor(() => expect(notify).toHaveBeenCalledWith(TRIGGER_MSG))
  })

  it('reconoce la entrega ya autorizada en Almacén y retira la VTD sin repetir la salida', async () => {
    mocks.getById.mockResolvedValue({ ...base, estado: 'COMPLETADA', paidCents: 15000 })
    const notify = vi.fn()
    render(<VentaDirectaPage notify={notify} />)
    await screen.findByText(base.numero!)
    mocks.listAbiertas.mockResolvedValue([])
    fireEvent.click(entrega())
    await screen.findByText('No hay ventas directas abiertas en este turno')
    expect(notify).toHaveBeenCalledWith(`${base.numero}: Almacén ya autorizó la salida`)
    expect(mocks.completar).not.toHaveBeenCalled()
    expect(mocks.cobrarVtd).not.toHaveBeenCalled()
  })

  it('una entrega pendiente explica que debe autorizarla Almacén', async () => {
    mocks.getById.mockResolvedValue(base)
    const notify = vi.fn()
    render(<VentaDirectaPage notify={notify} />)
    await screen.findByText(base.numero!)
    fireEvent.click(entrega())
    await waitFor(() => expect(notify).toHaveBeenCalledWith(`${base.numero}: pendiente de autorizar la salida en Almacén`))
    expect(mocks.completar).not.toHaveBeenCalled()
  })

  it('al volver a Caja consulta los cambios de Almacén', async () => {
    render(<VentaDirectaPage notify={vi.fn()} />)
    await screen.findByText(base.numero!)
    mocks.listAbiertas.mockResolvedValue([])
    fireEvent.focus(window)
    await screen.findByText('No hay ventas directas abiertas en este turno')
  })

  it('permite reintentar cuando la carga falla', async () => {
    mocks.listAbiertas.mockRejectedValueOnce(new Error('Sin conexión'))
    render(<VentaDirectaPage notify={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toBe('Sin conexión')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await screen.findByText(base.numero!)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  describe('Pago posterior…', () => {
    const abrir = async () => { render(<VentaDirectaPage notify={vi.fn()} />); fireEvent.click(await screen.findByRole('button', { name: 'Pago posterior…' })) }
    const confirmar = () => screen.getByRole('button', { name: 'Marcar pago posterior' }) as HTMLButtonElement

    it('sin cliente exige motivo (≥ 5) y contacto (≥ 3)', async () => {
      await abrir()
      const dialog = screen.getByRole('dialog', { name: /Pago posterior/ })
      expect(confirmar().disabled).toBe(true)
      fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: 'abc' } })
      fireEvent.change(within(dialog).getByLabelText(/Quién se lleva la mercadería \(nombre y teléfono\)/), { target: { value: 'Ana 700' } })
      expect(confirmar().disabled).toBe(true)
      fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: 'Paga el viernes' } })
      expect(confirmar().disabled).toBe(false)
      fireEvent.change(within(dialog).getByLabelText(/Quién se lleva/), { target: { value: 'ab' } })
      expect(confirmar().disabled).toBe(true)
    })

    it('con cliente el contacto es opcional y se envía a la RPC', async () => {
      mocks.listAbiertas.mockResolvedValue([{ ...base, customerId: '5', customerName: 'Cliente Cinco' }])
      mocks.marcarPagoPosterior.mockResolvedValue(undefined)
      await abrir()
      fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'Paga el viernes' } })
      expect(confirmar().disabled).toBe(false)
      fireEvent.click(confirmar())
      await waitFor(() => expect(mocks.marcarPagoPosterior).toHaveBeenCalledWith('1', 'Paga el viernes', undefined))
    })

    it('muestra el error de la base tal cual dentro del modal', async () => {
      mocks.marcarPagoPosterior.mockRejectedValue(new Error('VTD-2026-00001 ya tiene un pago registrado'))
      await abrir()
      fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'Paga el viernes' } })
      fireEvent.change(screen.getByLabelText(/Quién se lleva/), { target: { value: 'Ana 70011223' } })
      fireEvent.click(confirmar())
      expect((await screen.findByRole('alert')).textContent).toBe('VTD-2026-00001 ya tiene un pago registrado')
    })
  })
})

describe('Bandeja de Venta Directa — anulación con motivo', () => {
  const abrirAnular = async (nombre: RegExp) => {
    render(<VentaDirectaPage notify={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: nombre }))
    return screen.findByRole('dialog', { name: /Anular|Solicitar anulación/ })
  }

  it('Ness/gerente: pide motivo (>= 5) y anula con él', async () => {
    mocks.anular.mockResolvedValue({ ventaId: '1', estado: 'ANULADA', devuelto: 0, fueraDeArqueo: false })
    const notify = vi.fn()
    render(<VentaDirectaPage notify={notify} />)
    await waitFor(() => expect(mocks.puedeAnular).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole('button', { name: /^Anular$/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Anular VTD-2026-00001' })
    const enviar = within(dialog).getByRole('button', { name: 'Anular venta' }) as HTMLButtonElement
    expect(enviar.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: 'abc' } })
    expect(enviar.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: 'Error de cobro' } })
    fireEvent.click(enviar)
    await waitFor(() => expect(mocks.anular).toHaveBeenCalledWith('1', 'Error de cobro'))
    expect(mocks.solicitar).not.toHaveBeenCalled()
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining('VTD-2026-00001 anulada')))
  })

  it('cajero: solo "Solicitar anulación" y crea una solicitud', async () => {
    mocks.puedeAnular.mockResolvedValue(false)
    mocks.solicitar.mockResolvedValue({ solicitudId: '9', ventaId: '1', numero: 'VTD-2026-00001', estado: 'SOLICITADA' })
    const dialog = await abrirAnular(/Solicitar anulación/)
    expect(dialog.getAttribute('aria-label')).toBe('Solicitar anulación de VTD-2026-00001')
    expect(within(dialog).getByText('Ness o el gerente revisarán tu solicitud.')).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: 'Cliente se arrepintió' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar solicitud' }))
    await waitFor(() => expect(mocks.solicitar).toHaveBeenCalledWith('1', 'Cliente se arrepintió'))
    expect(mocks.anular).not.toHaveBeenCalled()
  })

  it('muestra el error de la base tal cual dentro del modal', async () => {
    mocks.anular.mockRejectedValue(new Error('La venta pasó por Caja–Almacén: resuélvela allí'))
    render(<VentaDirectaPage notify={() => {}} />)
    await waitFor(() => expect(mocks.puedeAnular).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole('button', { name: /^Anular$/ }))
    const dialog = await screen.findByRole('dialog', { name: /Anular/ })
    fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: 'Error de cobro' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anular venta' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe('La venta pasó por Caja–Almacén: resuélvela allí')
  })
})
