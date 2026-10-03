// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AdvanceModal } from './OrdersPage'

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('../../infrastructure/services', () => ({
  authSessionProvider: { getSession: () => mocks.getSession() },
  turnoService: { marcarCobroFueraDeArqueo: vi.fn() },
}))

afterEach(cleanup)
const sessionOf = (role: string) => ({ user: { id: 'u', role, active: true }, expiresAt: '2999-01-01' })
const metodo = () => screen.getByRole('combobox', { name: /Método/ }) as HTMLSelectElement
const confirmar = () => screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement

describe('Anticipo de pedido — sin método por defecto (Brief Caja D1/D2)', () => {
  it('arranca sin método y confirmar espera a que se elija uno', () => {
    mocks.getSession.mockResolvedValue(sessionOf('cajero'))
    render(<AdvanceModal onClose={() => {}} onConfirm={() => {}} />)
    fireEvent.change(screen.getByLabelText(/Monto/), { target: { value: '30' } })
    fireEvent.blur(screen.getByLabelText(/Monto/))
    expect(metodo().value).toBe('')
    expect(confirmar().disabled).toBe(true)
    fireEvent.change(metodo(), { target: { value: 'qr' } })
    expect(confirmar().disabled).toBe(false)
  })

  it('cajero con efectivo: no hay elección de destino y confirma con destino null', async () => {
    mocks.getSession.mockResolvedValue(sessionOf('cajero'))
    const onConfirm = vi.fn()
    render(<AdvanceModal onClose={() => {}} onConfirm={onConfirm} />)
    fireEvent.change(screen.getByLabelText(/Monto/), { target: { value: '30' } })
    fireEvent.blur(screen.getByLabelText(/Monto/))
    await waitFor(() => expect(mocks.getSession).toHaveBeenCalled())
    fireEvent.change(metodo(), { target: { value: 'cash' } })
    expect(screen.queryByText('En el cajón del turno')).toBeNull()
    fireEvent.click(confirmar())
    expect(onConfirm).toHaveBeenCalledWith(3000, 'cash', null)
  })

  it('gerente con efectivo: exige elegir el destino antes de confirmar', async () => {
    mocks.getSession.mockResolvedValue(sessionOf('gerente'))
    const onConfirm = vi.fn()
    render(<AdvanceModal onClose={() => {}} onConfirm={onConfirm} />)
    fireEvent.change(screen.getByLabelText(/Monto/), { target: { value: '30' } })
    fireEvent.blur(screen.getByLabelText(/Monto/))
    fireEvent.change(metodo(), { target: { value: 'cash' } })
    const fuera = await screen.findByLabelText('Lo recibo yo — fuera del arqueo')
    expect(confirmar().disabled).toBe(true)
    fireEvent.click(fuera)
    expect(confirmar().disabled).toBe(false)
    fireEvent.click(confirmar())
    expect(onConfirm).toHaveBeenCalledWith(3000, 'cash', 'fuera')
  })
})
