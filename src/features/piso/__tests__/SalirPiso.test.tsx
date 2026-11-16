// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { PedidoLocal } from '../../../domain/sales/pedidoPiso'

const mocks = vi.hoisted(() => ({ turnoActual: vi.fn(), finalizarTurno: vi.fn(), signOut: vi.fn(), setMockUser: vi.fn() }))
vi.mock('../../../config/featureFlags', () => ({ featureFlags: { supabase: true } }))
vi.mock('../../../infrastructure/services', () => ({ pisoRepository: { turnoActual: mocks.turnoActual, finalizarTurno: mocks.finalizarTurno } }))
vi.mock('../../../infrastructure/supabase/SupabaseAuthSessionProvider', () => ({ supabaseAuthSessionProvider: { signOut: mocks.signOut } }))
vi.mock('../../../infrastructure/mock/MockAuthSessionProvider', () => ({ mockAuthSessionProvider: { setMockUser: mocks.setMockUser } }))
import { SalirPiso } from '../SalirPiso'

const turno = { turnoId: 1, inicio: '2026-11-16T13:00:00Z', sucursalId: 2, cobradas: 0, porCobrar: 0, noRealizadas: 0, porReclamar: 0 }
const guardado = { clave: 'a', estado: 'ARMANDO', numeroDia: 4, lineas: [{}] } as unknown as PedidoLocal
const abrir = (guardados: PedidoLocal[] = []) => render(<SalirPiso nombre="Josias" palabra="Venta" guardados={guardados} onClose={vi.fn()} />)
beforeEach(() => { vi.clearAllMocks(); mocks.signOut.mockResolvedValue(undefined); mocks.finalizarTurno.mockResolvedValue(undefined) })
afterEach(cleanup)

it('en turno: Finalizar turno y salir llama finalizarTurno y luego signOut', async () => {
  mocks.turnoActual.mockResolvedValue(turno)
  abrir([guardado])
  expect(await screen.findByText(/Tu venta 4 guardada no se pierde/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Finalizar turno y salir' }))
  await waitFor(() => expect(mocks.signOut).toHaveBeenCalled())
  expect(mocks.finalizarTurno.mock.invocationCallOrder[0]).toBeLessThan(mocks.signOut.mock.invocationCallOrder[0])
})

it('Salir y seguir en turno solo cierra sesión', async () => {
  mocks.turnoActual.mockResolvedValue(turno)
  abrir()
  fireEvent.click(await screen.findByRole('button', { name: 'Salir y seguir en turno' }))
  await waitFor(() => expect(mocks.signOut).toHaveBeenCalled())
  expect(mocks.finalizarTurno).not.toHaveBeenCalled()
})

it('si finalizarTurno falla, muestra el error y no cierra sesión', async () => {
  mocks.turnoActual.mockResolvedValue(turno)
  mocks.finalizarTurno.mockRejectedValue(new Error('No hay red'))
  abrir()
  fireEvent.click(await screen.findByRole('button', { name: 'Finalizar turno y salir' }))
  expect((await screen.findByRole('alert')).textContent).toBe('No hay red')
  expect(mocks.signOut).not.toHaveBeenCalled()
})

it('sin turno ofrece Cerrar sesión', async () => {
  mocks.turnoActual.mockResolvedValue(null)
  abrir()
  fireEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }))
  await waitFor(() => expect(mocks.signOut).toHaveBeenCalled())
})
