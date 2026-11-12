// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PagoModal } from '../../components/PagoModal'
import { SensitiveOperationExecutor } from '../../application/idempotency/SensitiveOperationExecutor'
import { LocalIdempotencyService } from '../../application/idempotency/IdempotencyService'

const mocks = vi.hoisted(() => ({ customers: vi.fn(), cuenta: vi.fn(), reparto: vi.fn(), register: vi.fn(), execute: vi.fn() }))
vi.mock('../../config/featureFlags', () => ({ featureFlags: { supabase: true } }))
vi.mock('../../context/CashSessionContext', () => ({ useCashSession: () => ({ sessionId: '10' }) }))
vi.mock('../../infrastructure/hermes/client', () => ({ consultarCuentaCobro: mocks.cuenta, calcularRepartoFifo: mocks.reparto, HermesHttpError: class extends Error {} }))
vi.mock('../../infrastructure/services', () => ({
  customerService: { list: mocks.customers },
  cashService: { registerPayment: mocks.register }, sensitiveOperations: { ejecutarIdempotente: mocks.execute },
  authSessionProvider: { getSession: async () => ({ user: { id: 'test', role: 'cajero', active: true }, expiresAt: '2999-01-01' }) },
  turnoService: { marcarCobroFueraDeArqueo: vi.fn() },
}))
const a = { id: '101', name: 'Cliente A', type: 'wholesale', usualChannel: 'mayoreo', document: 'TEST-A' }
const retail = { id: '103', name: 'Cliente R', type: 'retail', usualChannel: 'mostrador', document: 'TEST-R' }
// Caso real BNB: cuatro pedidos abiertos (4600, 4930, 3620, 70).
const pedido = (pedidoId: number, numero: string, pendiente: number) => ({ pedidoId, numero, fecha: '2026-10-01', pendiente, enRevision: 0, partidas: [{ partidaId: pedidoId + 1000, pendiente }] })
const cuentaBnb = {
  sinCuenta: false, aFavorLibre: 0, enRevision: 0, pendienteTotal: 13220, partidasSinPedido: [],
  pedidos: [pedido(1, 'PED-00597', 4600), pedido(2, 'PED-00600', 4930), pedido(3, 'PED-00802', 3620), pedido(4, 'PED-00805', 70)],
}
const cuentaLimpia = { ...cuentaBnb, pedidos: [], pendienteTotal: 0, aFavorLibre: 0 }
async function choose(name = 'Cliente A') {
  if (document.activeElement instanceof HTMLElement) fireEvent.blur(document.activeElement)
  fireEvent.focus(screen.getByRole('textbox', { name: 'Buscar cliente para registrar pago' }))
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }))
}
const monto = () => screen.getByRole('spinbutton', { name: 'Monto recibido (Bs)' }) as HTMLInputElement
function setMonto(value: number) { const input = monto(); fireEvent.focus(input); fireEvent.change(input, { target: { value: String(value) } }); fireEvent.blur(input) }
const method = (name = 'QR') => fireEvent.click(screen.getByRole('button', { name }))
const registrar = () => screen.getByRole('button', { name: /^Registrar Bs|^Registrar anticipo|Comprobar el mismo pago|Registrando/ }) as HTMLButtonElement
const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }))
const marcar = (n: string) => fireEvent.click(screen.getByRole('checkbox', { name: `Marcar ${n}` }))
async function listo() { await screen.findByText('Pendiente en pedidos') }
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear()
  mocks.customers.mockResolvedValue([a, retail]); mocks.cuenta.mockResolvedValue(cuentaBnb)
  mocks.reparto.mockResolvedValue([]); mocks.register.mockResolvedValue({ movementId: '77', pagoId: '88' })
  const executor = new SensitiveOperationExecutor(new LocalIdempotencyService(localStorage))
  mocks.execute.mockImplementation(executor.ejecutarIdempotente.bind(executor))
})
afterEach(cleanup)
describe('Registrar pago: pedidos marcados', () => {
  it('la pestaña Pedidos es la predeterminada y muestra los tiles de la cuenta', async () => {
    render(<PagoModal onClose={() => {}} />); await choose(); await listo()
    expect(screen.getByRole('tab', { name: 'Pedidos' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText(/13\.220,00/)).toBeTruthy()
    expect(screen.getByText('4 pedidos abiertos')).toBeTruthy()
    expect(screen.getByText('A favor sin aplicar')).toBeTruthy()
  })
  it('marcar pedidos suma el monto cubierto y el sobrante', async () => {
    render(<PagoModal onClose={() => {}} />); await choose(); await listo()
    setMonto(5000); marcar('PED-00597')
    expect(screen.getAllByText(/Sobran Bs 400,00/).length).toBeGreaterThan(0)
    expect(screen.getByText(/1 pedido marcado/)).toBeTruthy()
    marcar('PED-00600')
    expect(screen.getByText(/Monto cubierto Bs 5\.000,00/)).toBeTruthy()
    expect(screen.getByText('Queda pagado')).toBeTruthy()
    expect(screen.getByText('Pago parcial')).toBeTruthy()
  })
  it('sugiere la combinación exacta y "Marcar estos" marca ese conjunto (BNB)', async () => {
    render(<PagoModal onClose={() => {}} />); await choose(); await listo(); method()
    setMonto(3690)
    await screen.findByText('PED-00802 + PED-00805')
    fireEvent.click(screen.getByRole('button', { name: 'Marcar estos' }))
    expect((screen.getByRole('checkbox', { name: 'Marcar PED-00802' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Marcar PED-00805' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('Paga PED-00802 y PED-00805.')).toBeTruthy()
    fireEvent.click(registrar())
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({
      customerId: '101', amountCents: 369000, noImputar: false, aplicaciones: [{ partidaId: 1003, monto: 3620 }, { partidaId: 1004, monto: 70 }],
    })))
    expect(mocks.register.mock.calls[0][0].orderId).toBeUndefined()
  })
  it('bloquea el envío si sobra dinero y quedan pedidos sin marcar', async () => {
    render(<PagoModal onClose={() => {}} />); await choose(); await listo(); method()
    setMonto(5000); marcar('PED-00802')
    expect(registrar().disabled).toBe(true)
    expect(screen.getAllByText(/Sobran Bs 1\.380,00/).length).toBeGreaterThan(0)
    fireEvent.click(registrar()); expect(mocks.register).not.toHaveBeenCalled()
  })
  it('un cliente retail ve el formulario simple, sin pestañas', async () => {
    render(<PagoModal onClose={() => {}} />); await choose('Cliente R'); method()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(mocks.cuenta).not.toHaveBeenCalled()
    setMonto(25)
    await waitFor(() => expect(registrar().disabled).toBe(false)); fireEvent.click(registrar())
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ customerId: '103', amountCents: 2500, noImputar: false, aplicaciones: undefined })))
  })
})
describe('Registrar pago: anticipo con motivo', () => {
  it('con pedidos abiertos exige motivo y lo envía junto al pago', async () => {
    render(<PagoModal onClose={() => {}} />); await choose(); await listo(); method(); setMonto(9530)
    tab('Anticipo')
    expect(screen.getByRole('alert').textContent).toMatch(/4 pedidos pendientes por Bs 13\.220,00/)
    expect(registrar().disabled).toBe(true)
    fireEvent.change(screen.getByRole('combobox', { name: /Motivo del anticipo/ }), { target: { value: 'GARANTIA_RESERVA' } })
    await waitFor(() => expect(registrar().disabled).toBe(false))
    expect(registrar().textContent).toMatch(/^Registrar anticipo Bs 9\.530,00/)
    fireEvent.click(registrar())
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ noImputar: true, anticipoMotivo: 'GARANTIA_RESERVA', aplicaciones: undefined })))
  })
  it('el motivo OTRO exige un detalle de al menos 10 caracteres', async () => {
    render(<PagoModal onClose={() => {}} />); await choose(); await listo(); method(); setMonto(100); tab('Anticipo')
    fireEvent.change(screen.getByRole('combobox', { name: /Motivo del anticipo/ }), { target: { value: 'OTRO' } })
    expect(registrar().disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: /Detalle/ }), { target: { value: 'Pago de una obra futura' } })
    await waitFor(() => expect(registrar().disabled).toBe(false))
  })
  it('"Pagar … en su lugar" cambia a Pedidos y marca ese pedido', async () => {
    mocks.cuenta.mockResolvedValue({ ...cuentaBnb, pedidos: [pedido(3, 'PED-00802', 3620)], pendienteTotal: 3620 })
    render(<PagoModal onClose={() => {}} />); await choose(); await listo(); setMonto(3620); tab('Anticipo')
    fireEvent.click(screen.getByRole('button', { name: 'Pagar PED-00802 en su lugar' }))
    expect(screen.getByRole('tab', { name: 'Pedidos' }).getAttribute('aria-selected')).toBe('true')
    expect((screen.getByRole('checkbox', { name: 'Marcar PED-00802' }) as HTMLInputElement).checked).toBe(true)
  })
  it('sin pedidos abiertos no pide motivo ni lo envía', async () => {
    mocks.cuenta.mockResolvedValue(cuentaLimpia)
    render(<PagoModal onClose={() => {}} />); await choose(); await listo(); method(); setMonto(50); tab('Anticipo')
    expect(screen.queryByRole('combobox', { name: /Motivo/ })).toBeNull()
    await waitFor(() => expect(registrar().disabled).toBe(false)); fireEvent.click(registrar())
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ noImputar: true, anticipoMotivo: undefined, anticipoDetalle: undefined })))
  })
  it('abre directo en Anticipo con el cliente inicial (carrito)', async () => {
    render(<PagoModal onClose={() => {}} initialCustomer={a as never} initialTab="anticipo" />); await listo()
    expect(screen.getByRole('tab', { name: 'Anticipo' }).getAttribute('aria-selected')).toBe('true')
    expect(mocks.cuenta).toHaveBeenCalledWith('101')
  })
  it('PT422 muestra el mensaje, cambia a Anticipo y limpia el intento pendiente', async () => {
    mocks.register.mockRejectedValue(Object.assign(new Error('Un anticipo con pedidos abiertos requiere motivo'), { code: 'PT422', hint: 'anticipo_requiere_motivo' }))
    render(<PagoModal onClose={() => {}} />); await choose(); await listo(); method(); setMonto(3690)
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar estos' }))
    await waitFor(() => expect(registrar().disabled).toBe(false)); fireEvent.click(registrar())
    await screen.findByText('Un anticipo con pedidos abiertos requiere motivo')
    expect(screen.getByRole('tab', { name: 'Anticipo' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByText('Pago pendiente de comprobar')).toBeNull()
    expect(localStorage.getItem('cation-pago-pendiente:test')).toBeNull()
  })
})
describe('Registrar pago: idempotencia', () => {
  it('mantiene la clave y el importe al reabrir después de una respuesta perdida', async () => {
    mocks.register.mockRejectedValue(new Error('Respuesta perdida después de guardar'))
    let view = render(<PagoModal onClose={() => {}} />); await choose('Cliente R'); method(); setMonto(40); await waitFor(() => expect(registrar().disabled).toBe(false)); fireEvent.click(registrar())
    await screen.findByText('Respuesta perdida después de guardar')
    const key1 = mocks.register.mock.calls[0][0].idempotencyKey
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar el mismo pago' })); await waitFor(() => expect(mocks.register).toHaveBeenCalledTimes(2))
    expect(mocks.register.mock.calls[1][0].idempotencyKey).toBe(key1)
    await screen.findByText('Respuesta perdida después de guardar'); view.unmount()
    view = render(<PagoModal onClose={() => {}} />); fireEvent.click(await screen.findByRole('button', { name: 'Comprobar el mismo pago' }))
    await waitFor(() => expect(mocks.register).toHaveBeenCalledTimes(3))
    expect(mocks.register.mock.calls[2][0].idempotencyKey).toBe(key1)
    await screen.findByText('Respuesta perdida después de guardar'); view.unmount()
  })
  it('impide cerrar o enviar de nuevo mientras el pago está en curso', async () => {
    mocks.register.mockImplementation(() => new Promise(() => {}))
    const onClose = vi.fn(); render(<PagoModal onClose={onClose} />); await choose('Cliente R'); method(); setMonto(40); await waitFor(() => expect(registrar().disabled).toBe(false)); fireEvent.click(registrar())
    await screen.findByRole('button', { name: 'Registrando…' })
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' })); expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' }); expect(onClose).not.toHaveBeenCalled()
    expect(mocks.register).toHaveBeenCalledTimes(1)
  })
})

describe('Registrar pago: modo y sobrepago', () => {
  it('la pestaña se llama "Pago a cuenta" y cada pestaña tiene su (i) fuera del botón', async () => {
    render(<PagoModal onClose={() => {}} />); await choose(); await listo()
    expect(screen.getByRole('tab', { name: 'Pago a cuenta' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Por antigüedad' })).toBeNull()
    for (const t of ['Pedidos', 'Pago a cuenta', 'Anticipo']) expect(screen.getByRole('button', { name: `Qué es ${t}` }).closest('[role="tab"]')).toBeNull()
  })
  it('pestaña Pedidos envía modo PEDIDOS', async () => {
    render(<PagoModal onClose={() => {}} />); await choose(); await listo(); method(); setMonto(70); marcar('PED-00805')
    fireEvent.click(registrar())
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ modo: 'PEDIDOS' })))
  })
  it('pestaña Anticipo envía modo ANTICIPO', async () => {
    mocks.cuenta.mockResolvedValue(cuentaLimpia)
    render(<PagoModal onClose={() => {}} />); await choose(); await listo(); method(); setMonto(500); tab('Anticipo')
    fireEvent.click(registrar())
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ modo: 'ANTICIPO', noImputar: true })))
  })
  it('el modo simple (retail) no envía modo', async () => {
    render(<PagoModal onClose={() => {}} />); await choose('Cliente R'); method(); setMonto(25)
    fireEvent.click(registrar())
    await waitFor(() => expect(mocks.register).toHaveBeenCalled())
    expect(mocks.register.mock.calls[0][0].modo).toBeUndefined()
  })
  it('un sobrepago exige confirmar el sobrante y avisa si el monto es 5 veces o más lo pagado (caso JACOB)', async () => {
    mocks.cuenta.mockResolvedValue({ ...cuentaBnb, pedidos: [pedido(9, 'PED-JACOB', 3400)], pendienteTotal: 3400 })
    render(<PagoModal onClose={() => {}} />); await choose(); await listo(); method(); marcar('PED-JACOB'); setMonto(34000)
    expect(registrar().disabled).toBe(true)
    expect(screen.getByText(/Revisa el monto: es 10 veces lo que se paga\./)).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /Confirmo que el cliente entregó Bs 34\.000,00 y quedan Bs 30\.600,00 a su favor\./ }))
    await waitFor(() => expect(registrar().disabled).toBe(false))
    fireEvent.click(registrar())
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 3400000, modo: 'PEDIDOS' })))
  })
  it('un pago exacto no pide confirmación', async () => {
    mocks.cuenta.mockResolvedValue({ ...cuentaBnb, pedidos: [pedido(9, 'PED-JACOB', 3400)], pendienteTotal: 3400 })
    render(<PagoModal onClose={() => {}} />); await choose(); await listo(); method(); marcar('PED-JACOB'); setMonto(3400)
    expect(screen.queryByRole('checkbox', { name: /Confirmo que el cliente entregó/ })).toBeNull()
    await waitFor(() => expect(registrar().disabled).toBe(false))
  })
})
