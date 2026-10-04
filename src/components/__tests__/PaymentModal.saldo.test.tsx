// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PaymentModal } from '../PaymentModal'

const state = vi.hoisted(() => ({ available: 2193, checkout: vi.fn(), qrState: vi.fn(), updated: vi.fn() }))
vi.mock('../../context/PosContext', () => ({ usePos: () => ({ cart: [{ id: 1, cantidad: 1, precioAplicado: 228.5, descuentoPct: 0, ubicacion: 'Tienda' }], discount: 0, total: 228.5, customer: { id: '35', name: 'Acreedor de prueba' }, operationId: 'op-test', newOperation: vi.fn(), notifyVentaCompletada: vi.fn() }) }))
vi.mock('../../context/CashSessionContext', () => ({ useCashSession: () => ({ sessionId: '25' }) }))
vi.mock('../../infrastructure/services', () => ({ saleService: { checkout: state.checkout }, turnoService: { estadoBancoQr: state.qrState }, configService: { getEmpresa: vi.fn() } }))
vi.mock('../../infrastructure/supabase/SaldoCliente.supabase', () => ({ avisarSaldoActualizado: state.updated }))
vi.mock('../../hooks/useSaldoCliente', () => ({ useSaldoCliente: () => ({ saldo: { disponible: state.available, saldoConfirmado: -state.available, esAcreedor: true }, loading: false, error: '', refresh: vi.fn() }) }))
vi.mock('../VentaTicket', () => ({ VentaTicket: () => null }))
afterEach(cleanup)
beforeEach(() => {
 vi.clearAllMocks(); state.available = 2193
 localStorage.clear()
 state.checkout.mockImplementation(async input => ({ saleId: '1', numero: 'VTA-TEST', totalCents: 22850, balanceAppliedCents: input.balanceCents, balanceRemainingCents: Math.round(state.available * 100) - input.balanceCents }))
})
describe('Cobro con saldo propio del cliente', () => {
 it('cubre la compra sin cobrar efectivo ni esperar confirmación de QR', async () => {
  render(<PaymentModal onClose={() => {}} />)
  expect(screen.getByText(/No recibas dinero adicional/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar con saldo a favor' }))
  await waitFor(() => expect(state.checkout).toHaveBeenCalled())
  expect(state.checkout.mock.calls[0][0]).toMatchObject({ balanceCents: 22850, payments: [] })
  expect(state.qrState).not.toHaveBeenCalled()
  expect(await screen.findByText(/Saldo a favor restante/)).toBeTruthy()
 })
 it('cobra solo la diferencia cuando el saldo no alcanza', async () => {
  state.available = 100
  render(<PaymentModal onClose={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar cobro' }))
  await waitFor(() => expect(state.checkout).toHaveBeenCalled())
  expect(state.checkout.mock.calls[0][0]).toMatchObject({ balanceCents: 10000, payments: [{ method: 'cash', amountCents: 12850, receivedCents: 12850 }] })
 })
 it('permite elegir pagar completo sin consumir saldo', async () => {
  render(<PaymentModal onClose={() => {}} />)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar cobro' }))
  await waitFor(() => expect(state.checkout).toHaveBeenCalled())
  expect(state.checkout.mock.calls[0][0]).toMatchObject({ balanceCents: 0, payments: [{ method: 'cash', amountCents: 22850 }] })
 })
 it('conserva el cobro original después de una respuesta perdida, cambio de saldo y reapertura del diálogo', async () => {
  state.available = 100
  state.checkout.mockRejectedValueOnce(new Error('Respuesta perdida'))
  const first = render(<PaymentModal onClose={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar cobro' }))
  await screen.findByText('Respuesta perdida')
  const original = state.checkout.mock.calls[0][0]
  first.unmount()
  state.available = 0
  render(<PaymentModal onClose={() => {}} />)
  expect(screen.getByText('Cobro pendiente de comprobar')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Comprobar cobro anterior' }))
  await waitFor(() => expect(state.checkout).toHaveBeenCalledTimes(2))
  expect(state.checkout.mock.calls[1][0]).toEqual(original)
  await screen.findByText('¡Cobro confirmado!')
  expect(localStorage.getItem('roari-saldo-cobro:op-test')).toBeNull()
 })
})
