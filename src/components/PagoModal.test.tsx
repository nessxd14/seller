// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { PagoModal } from './PagoModal'

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('../context/CashSessionContext', () => ({ useCashSession: () => ({ sessionId: '10' }) }))
vi.mock('../infrastructure/hermes/client', () => ({ consultarCuentaCobro: vi.fn() }))
vi.mock('../infrastructure/services', () => ({
  customerService: { list: vi.fn().mockResolvedValue([]) },
  cashService: { registerPayment: vi.fn() },
  sensitiveOperations: { ejecutarIdempotente: vi.fn() },
  authSessionProvider: { getSession: () => mocks.getSession() },
  turnoService: { marcarCobroFueraDeArqueo: vi.fn() },
}))

afterEach(cleanup)

describe('PagoModal — sin método por defecto (Brief Caja D1)', () => {
  it('ningún medio arranca elegido y el cajero no ve la elección del efectivo', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'u', role: 'cajero', active: true }, expiresAt: '2999-01-01' })
    render(<PagoModal onClose={() => {}} />)
    for (const name of ['Efectivo', 'QR', 'Depósito', 'Transferencia', 'SIGEP', 'Cheque']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('false')
    }
    expect((screen.getByRole('button', { name: /^Registrar Bs/ }) as HTMLButtonElement).disabled).toBe(true)
    await waitFor(() => expect(mocks.getSession).toHaveBeenCalled())
    expect(screen.queryByText('En el cajón del turno')).toBeNull()
  })
})
