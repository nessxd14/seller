// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SensitiveOperationExecutor } from '../application/idempotency/SensitiveOperationExecutor'
import { AnticipoModal } from './AnticipoModal'
const mocks = vi.hoisted(() => ({ registerPayment: vi.fn(), operation: vi.fn(), getSession: vi.fn(), marcarFuera: vi.fn() }))
vi.mock('../context/PosContext', () => ({ usePos: () => ({ customer: { id: '123', name: 'Prueba' }, total: 100 }) }))
vi.mock('../context/CashSessionContext', () => ({ useCashSession: () => ({ sessionId: '10' }) }))
vi.mock('../infrastructure/services', () => ({
  cashService: { registerPayment: mocks.registerPayment },
  sensitiveOperations: { ejecutarIdempotente: (...args: unknown[]) => mocks.operation(...args) },
  authSessionProvider: { getSession: () => mocks.getSession() },
  turnoService: { marcarCobroFueraDeArqueo: (...args: unknown[]) => mocks.marcarFuera(...args) },
}))
const sessionOf = (role: string) => ({ user: { id: 'u', role, active: true }, expiresAt: '2999-01-01' })
const elegirMetodo = (value: string) => fireEvent.change(screen.getByRole('combobox', { name: /Método/ }), { target: { value } })
afterEach(cleanup)
beforeEach(() => { vi.clearAllMocks(); mocks.getSession.mockResolvedValue(sessionOf('cajero')) })
it('reintenta el mismo anticipo con una sola clave y sin imputarlo a deudas', async () => {
  const keys = new Map<string, string>()
  const executor = new SensitiveOperationExecutor({
    getOrCreate: (op, aggregate) => { const id = `${op}:${aggregate}`; if (!keys.has(id)) keys.set(id, crypto.randomUUID()); return keys.get(id)! },
    clear: (op, aggregate) => { keys.delete(`${op}:${aggregate}`) },
  })
  mocks.operation.mockImplementation(executor.ejecutarIdempotente.bind(executor))
  mocks.registerPayment.mockRejectedValueOnce(new Error('Respuesta perdida')).mockResolvedValueOnce({ movementId: '5', pagoId: '8' })
  const onClose = vi.fn()
  render(<AnticipoModal onClose={onClose} notify={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Monto del anticipo (Bs)'), { target: { value: '25' } })
  elegirMetodo('cash')
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar anticipo' }))
  await screen.findByText('Respuesta perdida')
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar anticipo' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  const first = mocks.registerPayment.mock.calls[0][0]
  const retry = mocks.registerPayment.mock.calls[1][0]
  expect(first).toMatchObject({ customerId: '123', amountCents: 2500, sessionId: '10', noImputar: true })
  expect(retry.idempotencyKey).toBe(first.idempotencyKey)
})

it('no preselecciona método: confirmar queda deshabilitado hasta elegir uno', () => {
  render(<AnticipoModal onClose={vi.fn()} notify={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Monto del anticipo (Bs)'), { target: { value: '25' } })
  expect((screen.getByRole('combobox', { name: /Método/ }) as HTMLSelectElement).value).toBe('')
  expect((screen.getByRole('button', { name: 'Confirmar anticipo' }) as HTMLButtonElement).disabled).toBe(true)
  elegirMetodo('qr')
  expect((screen.getByRole('button', { name: 'Confirmar anticipo' }) as HTMLButtonElement).disabled).toBe(false)
})

it('un cajero nunca ve la elección "dónde queda el efectivo"', async () => {
  render(<AnticipoModal onClose={vi.fn()} notify={vi.fn()} />)
  await waitFor(() => expect(mocks.getSession).toHaveBeenCalled())
  elegirMetodo('cash')
  expect(screen.queryByText(/fuera del arqueo/i)).toBeNull()
  expect(screen.queryByText('En el cajón del turno')).toBeNull()
})

it('gerente con efectivo: la elección es obligatoria y "fuera del arqueo" marca el movimiento devuelto', async () => {
  mocks.getSession.mockResolvedValue(sessionOf('gerente'))
  mocks.operation.mockImplementation((_op: string, _id: string, _huella: string, handler: (key: string) => Promise<unknown>) => handler('k1'))
  mocks.registerPayment.mockResolvedValue({ movementId: '77' })
  mocks.marcarFuera.mockResolvedValue(undefined)
  const onClose = vi.fn()
  render(<AnticipoModal onClose={onClose} notify={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Monto del anticipo (Bs)'), { target: { value: '25' } })
  elegirMetodo('cash')
  await screen.findByText('Lo recibo yo — fuera del arqueo')
  expect((screen.getByRole('button', { name: 'Confirmar anticipo' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByLabelText('Lo recibo yo — fuera del arqueo'))
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar anticipo' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(mocks.marcarFuera).toHaveBeenCalledWith('77', true)
})

it('gerente que elige "en el cajón" no llama a marcar fuera del arqueo; con QR la elección no aparece', async () => {
  mocks.getSession.mockResolvedValue(sessionOf('admin'))
  mocks.operation.mockImplementation((_op: string, _id: string, _huella: string, handler: (key: string) => Promise<unknown>) => handler('k1'))
  mocks.registerPayment.mockResolvedValue({ movementId: '78' })
  const onClose = vi.fn()
  render(<AnticipoModal onClose={onClose} notify={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Monto del anticipo (Bs)'), { target: { value: '10' } })
  elegirMetodo('qr')
  await waitFor(() => expect(mocks.getSession).toHaveBeenCalled())
  expect(screen.queryByText('En el cajón del turno')).toBeNull()
  elegirMetodo('cash')
  fireEvent.click(await screen.findByLabelText('En el cajón del turno'))
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar anticipo' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(mocks.marcarFuera).not.toHaveBeenCalled()
})

it('si marcar fuera del arqueo falla, avisa que el cobro quedó registrado y sigue en el cajón', async () => {
  mocks.getSession.mockResolvedValue(sessionOf('gerente'))
  mocks.operation.mockImplementation((_op: string, _id: string, _huella: string, handler: (key: string) => Promise<unknown>) => handler('k1'))
  mocks.registerPayment.mockResolvedValue({ movementId: '79' })
  mocks.marcarFuera.mockRejectedValue(new Error('boom'))
  const notify = vi.fn()
  const onClose = vi.fn()
  render(<AnticipoModal onClose={onClose} notify={notify} />)
  fireEvent.change(screen.getByLabelText('Monto del anticipo (Bs)'), { target: { value: '10' } })
  elegirMetodo('cash')
  fireEvent.click(await screen.findByLabelText('Lo recibo yo — fuera del arqueo'))
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar anticipo' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(notify).toHaveBeenCalledWith(expect.stringMatching(/quedó registrado, pero sigue contado en el cajón/))
})
