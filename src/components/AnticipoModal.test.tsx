// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SensitiveOperationExecutor } from '../application/idempotency/SensitiveOperationExecutor'
import { AnticipoModal } from './AnticipoModal'
const mocks = vi.hoisted(() => ({ registerPayment: vi.fn(), operation: vi.fn() }))
vi.mock('../context/PosContext', () => ({ usePos: () => ({ customer: { id: '123', name: 'Prueba' }, total: 100 }) }))
vi.mock('../context/CashSessionContext', () => ({ useCashSession: () => ({ sessionId: '10' }) }))
vi.mock('../infrastructure/services', () => ({ cashService: { registerPayment: mocks.registerPayment }, sensitiveOperations: { ejecutarIdempotente: (...args: unknown[]) => mocks.operation(...args) } }))
afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())
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
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar anticipo' }))
  await screen.findByText('Respuesta perdida')
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar anticipo' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  const first = mocks.registerPayment.mock.calls[0][0]
  const retry = mocks.registerPayment.mock.calls[1][0]
  expect(first).toMatchObject({ customerId: '123', amountCents: 2500, sessionId: '10', noImputar: true })
  expect(retry.idempotencyKey).toBe(first.idempotencyKey)
})
