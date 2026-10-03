// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { VentaDirectaRecord } from '../../../application/shared/models'
import { VentaDirectaPage } from '../VentaDirectaPage'

const mocks = vi.hoisted(() => ({ listAbiertas: vi.fn(), completar: vi.fn(), cobrarVtd: vi.fn(), getById: vi.fn(), marcarPagoPosterior: vi.fn() }))
vi.mock('../../../context/CashSessionContext', () => ({ useCashSession: () => ({ sessionId: '1' }) }))
vi.mock('../../../components/VtdTicketPreviewModal', () => ({ VtdTicketPreviewModal: ({ venta }: { venta: VentaDirectaRecord }) => <div role="dialog" aria-label="ticket">ticket {venta.numero}</div> }))
vi.mock('../../../infrastructure/services', () => ({
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
const completar = () => screen.getByRole('button', { name: /Completar/ }) as HTMLButtonElement

beforeEach(() => { vi.clearAllMocks(); mocks.listAbiertas.mockResolvedValue([base]) })
afterEach(cleanup)

describe('Bandeja de Venta Directa — cobro obligatorio (Brief Caja VTD obligatorio A3/A5)', () => {
  it('una VTD sin cobrar muestra POR COBRAR, "Cobrar" y "Pago posterior…", y Completar está deshabilitado', async () => {
    render(<VentaDirectaPage notify={() => {}} />)
    await screen.findByText('POR COBRAR')
    expect(screen.getByRole('button', { name: /^Cobrar$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pago posterior…' })).toBeTruthy()
    expect(completar().disabled).toBe(true)
    expect(completar().title).toBe('Cobra la venta o márcala como pago posterior para poder entregar')
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

  it('una VTD pagada o con pago posterior se completa como siempre; la de pago posterior muestra motivo y contacto', async () => {
    mocks.listAbiertas.mockResolvedValue([
      { ...base, id: '2', numero: 'VTD-2026-00002', paidCents: 15000 },
      { ...base, id: '3', numero: 'VTD-2026-00003', pagoPosterior: true, pagoPosteriorMotivo: 'Cliente paga el viernes', pagoPosteriorContacto: 'Ana 70011223' },
    ])
    render(<VentaDirectaPage notify={() => {}} />)
    await screen.findByText('PAGADO')
    expect(screen.getByText('PAGO POSTERIOR')).toBeTruthy()
    expect(screen.getByText('Cliente paga el viernes')).toBeTruthy()
    expect(screen.getByText(/Ana 70011223/)).toBeTruthy()
    for (const button of screen.getAllByRole('button', { name: /Completar/ })) expect((button as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByRole('button', { name: /^Cobrar$/ })).toBeNull()
  })

  it('el mensaje del trigger llega tal cual a la cajera al completar (sin texto genérico)', async () => {
    mocks.listAbiertas.mockResolvedValue([{ ...base, cobroExigible: false }])
    mocks.completar.mockRejectedValue(new Error(TRIGGER_MSG))
    const notify = vi.fn()
    render(<VentaDirectaPage notify={notify} />)
    await screen.findByText('Histórica')
    fireEvent.click(completar())
    await waitFor(() => expect(notify).toHaveBeenCalledWith(TRIGGER_MSG))
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
