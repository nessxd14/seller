// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { PagoModal } from './PagoModal'

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('../context/CashSessionContext', () => ({ useCashSession: () => ({ sessionId: '10' }) }))
vi.mock('../infrastructure/hermes/client', () => ({ consultarSaldo: vi.fn().mockResolvedValue({ estado: 'no-disponible' }) }))
vi.mock('../infrastructure/services', () => ({
  customerService: { list: vi.fn().mockResolvedValue([]) },
  orderService: { list: vi.fn().mockResolvedValue([]) },
  cashService: { registerPayment: vi.fn() },
  sensitiveOperations: { ejecutarIdempotente: vi.fn() },
  authSessionProvider: { getSession: () => mocks.getSession() },
  turnoService: { marcarCobroFueraDeArqueo: vi.fn() },
}))

afterEach(cleanup)

describe('PagoModal — sin método por defecto (Brief Caja D1)', () => {
  it('el método arranca sin elegir y el cajero no ve la elección del efectivo', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'u', role: 'cajero', active: true }, expiresAt: '2999-01-01' })
    render(<PagoModal onClose={() => {}} />)
    const select = screen.getByRole('combobox', { name: /Método de pago/ }) as HTMLSelectElement
    expect(select.value).toBe('')
    expect((screen.getByRole('button', { name: 'Confirmar pago' }) as HTMLButtonElement).disabled).toBe(true)
    await waitFor(() => expect(mocks.getSession).toHaveBeenCalled())
    expect(screen.queryByText('En el cajón del turno')).toBeNull()
  })
})
