// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PagoModal } from '../../components/PagoModal'
import { SensitiveOperationExecutor } from '../../application/idempotency/SensitiveOperationExecutor'
import { LocalIdempotencyService } from '../../application/idempotency/IdempotencyService'

const mocks = vi.hoisted(() => ({ customers: vi.fn(), orders: vi.fn(), saldo: vi.fn(), reparto: vi.fn(), register: vi.fn(), execute: vi.fn() }))
vi.mock('../../config/featureFlags', () => ({ featureFlags: { supabase: true } }))
vi.mock('../../context/CashSessionContext', () => ({ useCashSession: () => ({ sessionId: '10' }) }))
vi.mock('../../infrastructure/hermes/client', () => ({ consultarPedidosCobro: mocks.orders, consultarSaldo: mocks.saldo, calcularRepartoFifo: mocks.reparto, HermesHttpError: class extends Error {} }))
vi.mock('../../infrastructure/services', () => ({
  customerService: { list: mocks.customers }, orderService: { list: mocks.orders },
  cashService: { registerPayment: mocks.register }, sensitiveOperations: { ejecutarIdempotente: mocks.execute },
  authSessionProvider: { getSession: async () => ({ user: { id: 'test', role: 'cajero', active: true }, expiresAt: '2999-01-01' }) },
  turnoService: { marcarCobroFueraDeArqueo: vi.fn() },
}))
const a = { id: '101', name: 'Cliente A', type: 'wholesale', usualChannel: 'mayoreo', document: 'TEST-A' }
const b = { id: '102', name: 'Cliente B', type: 'wholesale', usualChannel: 'mayoreo', document: 'TEST-B' }
async function choose(name = 'Cliente A') {
  if (document.activeElement instanceof HTMLElement) fireEvent.blur(document.activeElement)
  fireEvent.focus(screen.getByRole('textbox', { name: 'Buscar cliente para registrar pago' }))
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }))
  await waitFor(() => expect(mocks.saldo).toHaveBeenCalled())
}
function method() { fireEvent.change(screen.getByRole('combobox', { name: /Método de pago/ }), { target: { value: 'qr' } }) }
function confirm() { return screen.getByRole('button', { name: 'Confirmar pago' }) as HTMLButtonElement }
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear()
  mocks.customers.mockResolvedValue([a, b]); mocks.orders.mockResolvedValue([])
  mocks.saldo.mockResolvedValue({ estado: 'ok', saldoConfirmado: 100, saldoProvisional: 100, situacion: 'DEUDOR' })
  mocks.reparto.mockResolvedValue([]); mocks.register.mockResolvedValue({ movementId: '77', pagoId: '88' })
  const executor = new SensitiveOperationExecutor(new LocalIdempotencyService(localStorage))
  mocks.execute.mockImplementation(executor.ejecutarIdempotente.bind(executor))
})
afterEach(cleanup)
describe('Registrar pago: regresiones de caja y Hermes', () => {
  it('no vuelve a sugerir un importe que ya está en revisión', async () => {
    mocks.saldo.mockResolvedValue({ estado: 'ok', saldoConfirmado: 100, saldoProvisional: 0 })
    render(<PagoModal onClose={() => {}} />); await choose(); method()
    await screen.findByText(/en revisión en Hermes/)
    await waitFor(() => expect((screen.getByRole('spinbutton', { name: 'Monto (Bs)' }) as HTMLInputElement).value).toBe('0'))
    expect(confirm().disabled).toBe(true)
  })
  it('incluye pedidos entregados con deuda y precarga el pendiente', async () => {
    mocks.orders.mockResolvedValue([{ id: '11', customerId: '101', number: 'PED-ENTREGADO', pendienteBs: 40 }])
    render(<PagoModal onClose={() => {}} />); await choose()
    fireEvent.click(screen.getByRole('button', { name: 'Sobre un pedido específico' }))
    await waitFor(() => expect(mocks.orders).toHaveBeenCalled())
    fireEvent.change(await screen.findByRole('combobox', {name: 'Pedido'}), {target:{value:'11'}})
    expect(screen.getByRole('option', {name: /PED-ENTREGADO/})).toBeTruthy()
    await waitFor(() => expect((screen.getByRole('spinbutton',{name:'Monto (Bs)'}) as HTMLInputElement).value).toBe('40'))
  })
  it('cambiar de cliente borra el pedido anterior y bloquea el envío', async () => {
    mocks.orders.mockImplementation(async id => id === '101' ? [{id:'11',number:'PED-A',pendienteBs:100}] : [{id:'12',number:'PED-B',pendienteBs:100}])
    render(<PagoModal onClose={() => {}} />); await choose()
    fireEvent.click(screen.getByRole('button', { name: 'Sobre un pedido específico' }))
    await screen.findByRole('option', { name: /PED-A/ })
    fireEvent.change(screen.getByRole('combobox', { name: 'Pedido' }), { target: { value: '11' } })
    await choose('Cliente B'); await screen.findByRole('option', { name: /PED-B/ }); method()
    expect((screen.getByRole('combobox', { name: 'Pedido' }) as HTMLSelectElement).value).toBe('')
    expect(confirm().disabled).toBe(true); fireEvent.click(confirm())
    expect(mocks.register).not.toHaveBeenCalled()
  })
  it('explica la actualización pendiente y bloquea el importe y el cobro', async () => {
    mocks.orders.mockRejectedValue(Object.assign(new Error('Function not found'), { code: 'PGRST202' }))
    render(<PagoModal onClose={() => {}} />); await choose(); method()
    fireEvent.click(screen.getByRole('button', { name: 'Sobre un pedido específico' }))
    await screen.findByText(/Falta activar la actualización de la base de datos/)
    expect((screen.getByRole('combobox', { name: 'Pedido' }) as HTMLSelectElement).disabled).toBe(true)
    expect((screen.getByRole('spinbutton', { name: 'Monto (Bs)' }) as HTMLInputElement).disabled).toBe(true)
    expect(confirm().disabled).toBe(true)
    fireEvent.click(confirm()); expect(mocks.register).not.toHaveBeenCalled()
  })
  it('permite reintentar la consulta sin cambiar de cliente', async () => {
    mocks.orders.mockRejectedValueOnce(new Error('sin conexión')).mockResolvedValue([{ id: '11', number: 'PED-A', pendienteBs: 40 }])
    render(<PagoModal onClose={() => {}} />); await choose()
    fireEvent.click(screen.getByRole('button', { name: 'Sobre un pedido específico' }))
    await screen.findByText('No se pudieron consultar los pedidos. Reintenta la consulta.')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar pedidos' }))
    await screen.findByRole('option', { name: /PED-A/ })
    expect(mocks.orders.mock.calls.map(call => call[0])).toEqual(['101', '101'])
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('registra un abono únicamente al pedido elegido y diferencia su pendiente del saldo total', async () => {
    mocks.orders.mockResolvedValue([{ id: '11', number: 'PED-A', pendienteBs: 40 }])
    render(<PagoModal onClose={() => {}} />); await choose()
    fireEvent.click(screen.getByRole('button', { name: 'Sobre un pedido específico' }))
    await screen.findByRole('option', { name: /PED-A/ })
    fireEvent.change(screen.getByRole('combobox', { name: 'Pedido' }), { target: { value: '11' } }); method()
    expect(screen.getByText('Saldo total del cliente')).toBeTruthy()
    expect(screen.getByText(/Pendiente de este pedido:.*40,00/)).toBeTruthy()
    const input = screen.getByRole('spinbutton', { name: 'Monto (Bs)' })
    fireEvent.focus(input); fireEvent.change(input, { target: { value: '25' } }); fireEvent.blur(input)
    await waitFor(() => expect(confirm().disabled).toBe(false)); fireEvent.click(confirm())
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ customerId: '101', orderId: '11', amountCents: 2500, aplicaciones: undefined, noImputar: false })))
  })
  it('avisa del excedente respecto al pedido aunque el cliente tenga una deuda total mayor', async () => {
    mocks.orders.mockResolvedValue([{ id: '11', number: 'PED-A', pendienteBs: 40 }])
    render(<PagoModal onClose={() => {}} />); await choose()
    fireEvent.click(screen.getByRole('button', { name: 'Sobre un pedido específico' }))
    await screen.findByRole('option', { name: /PED-A/ })
    fireEvent.change(screen.getByRole('combobox', { name: 'Pedido' }), { target: { value: '11' } })
    const input = screen.getByRole('spinbutton', { name: 'Monto (Bs)' })
    fireEvent.focus(input); fireEvent.change(input, { target: { value: '50' } }); fireEvent.blur(input)
    await screen.findByText(/Supera el pendiente del pedido en.*10,00/)
  })
  it('bloquea el cobro cuando falla el reparto y permite dejar anticipo explícito', async () => {
    mocks.reparto.mockRejectedValue(new Error('sin conexión'))
    render(<PagoModal onClose={() => {}} />); await choose(); method()
    await screen.findByText('No se pudo calcular el reparto')
    expect(confirm().disabled).toBe(true); fireEvent.click(confirm()); expect(mocks.register).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(confirm())
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ aplicaciones: undefined, noImputar: true })))
  })
  it('poner el reparto en cero guarda un anticipo sin FIFO', async () => {
    mocks.reparto.mockResolvedValue([{ partidaId: 7, referencia: 'PED-A', pendiente: 100, aplica: 100 }])
    render(<PagoModal onClose={() => {}} />); await choose(); method()
    const input = await screen.findByRole('spinbutton', { name: 'Monto a aplicar a PED-A' })
    fireEvent.change(input, { target: { value: '0' } }); fireEvent.blur(input)
    await screen.findByText(/quedarán como anticipo a favor del cliente/)
    fireEvent.click(confirm())
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ aplicaciones: undefined, noImputar: true })))
  })
  it('mantiene la clave y el importe al reabrir después de una respuesta perdida', async () => {
    mocks.register.mockRejectedValue(new Error('Respuesta perdida después de guardar'))
    let view = render(<PagoModal onClose={() => {}} />); await choose(); method(); await waitFor(() => expect(confirm().disabled).toBe(false)); fireEvent.click(confirm())
    await screen.findByText('Respuesta perdida después de guardar')
    const key1 = mocks.register.mock.calls[0][0].idempotencyKey
    fireEvent.click(screen.getByRole('button',{name:'Comprobar el mismo pago'})); await waitFor(() => expect(mocks.register).toHaveBeenCalledTimes(2))
    expect(mocks.register.mock.calls[1][0].idempotencyKey).toBe(key1)
    await screen.findByText('Respuesta perdida después de guardar'); view.unmount()
    view = render(<PagoModal onClose={() => {}} />); fireEvent.click(await screen.findByRole('button',{name:'Comprobar el mismo pago'}))
    await waitFor(() => expect(mocks.register).toHaveBeenCalledTimes(3))
    expect(mocks.register.mock.calls[2][0].idempotencyKey).toBe(key1)
    await screen.findByText('Respuesta perdida después de guardar'); view.unmount()
  })
  it('impide cerrar o enviar de nuevo mientras el pago está en curso', async () => {
    mocks.register.mockImplementation(() => new Promise(() => {}))
    const onClose = vi.fn(); render(<PagoModal onClose={onClose} />); await choose(); method(); await waitFor(() => expect(confirm().disabled).toBe(false)); fireEvent.click(confirm())
    await screen.findByRole('button', { name: 'Registrando…' })
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' })); expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document, {key:'Escape'}); expect(onClose).not.toHaveBeenCalled()
    expect(mocks.register).toHaveBeenCalledTimes(1)
  })
})
