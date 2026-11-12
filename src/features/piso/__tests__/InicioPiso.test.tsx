// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthSession } from '../../../application/auth/AuthSessionProvider'

const mocks = vi.hoisted(() => ({ turnoActual: vi.fn(), iniciarTurno: vi.fn(), finalizarTurno: vi.fn() }))
vi.mock('../../../infrastructure/services', () => ({ pisoRepository: mocks }))
vi.mock('../../transfers/TransfersPage', () => ({ sucursalLabel: { 1: 'Almacén Central', 2: 'Tienda' } }))
vi.mock('../VentasCajaPiso', () => ({ VentasCajaPiso: () => <p>Pantalla Ventas de caja</p> }))
import { InicioPiso } from '../InicioPiso'

const sesion = (sucursalId?: number): AuthSession => ({ user: { id: 'u', name: 'Josias', role: 'reponedor', active: true, sucursalId }, expiresAt: '2999-01-01' })
const turno = { turnoId: 3, inicio: '2026-11-12T13:30:00Z', sucursalId: 2, cobradas: 4, porCobrar: 1, noRealizadas: 2, porReclamar: 5 }
const abrir = (s = sesion(2), over: Partial<Parameters<typeof InicioPiso>[0]> = {}) =>
  render(<InicioPiso session={s} textoArmar="Armar venta" version={0} onArmar={vi.fn()} onTraslado={vi.fn()} onNoRealizada={vi.fn()} {...over} />)

beforeEach(() => { Object.values(mocks).forEach((m) => m.mockReset()) })
afterEach(cleanup)

describe('InicioPiso', () => {
  it('sin turno: Ventas de caja y Venta no realizada están desactivadas y avisa por qué', async () => {
    mocks.turnoActual.mockResolvedValue(null)
    abrir()
    await screen.findByText('Empieza tu turno')
    expect((screen.getByRole('button', { name: 'Ventas de caja' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Venta no realizada' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Se activan al iniciar el turno.')).toBeTruthy()
    expect(screen.getByText(/Armar venta, Traslados y Mis ventas funcionan con o sin turno/)).toBeTruthy()
  })

  it('Iniciar turno usa la sucursal de la sesión', async () => {
    mocks.turnoActual.mockResolvedValue(null)
    mocks.iniciarTurno.mockResolvedValue(turno)
    abrir(sesion(2))
    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar turno' }))
    await waitFor(() => expect(mocks.iniciarTurno).toHaveBeenCalledWith(2))
    expect(await screen.findByText('En turno')).toBeTruthy()
  })

  it('sin sucursal en el perfil pide elegir Tienda o Almacén Central y la manda', async () => {
    mocks.turnoActual.mockResolvedValue(null)
    mocks.iniciarTurno.mockResolvedValue({ ...turno, sucursalId: 1 })
    abrir(sesion(undefined))
    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar turno' }))
    expect(mocks.iniciarTurno).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Almacén Central' }))
    await waitFor(() => expect(mocks.iniciarTurno).toHaveBeenCalledWith(1))
  })

  it('en turno: chip, contadores, insignia de ventas por reclamar y accesos', async () => {
    mocks.turnoActual.mockResolvedValue(turno)
    const onArmar = vi.fn(); const onTraslado = vi.fn(); const onNoRealizada = vi.fn()
    abrir(sesion(2), { onArmar, onTraslado, onNoRealizada })
    await screen.findByText('En turno')
    expect(screen.getByText(/desde \d{2}:\d{2}/)).toBeTruthy()
    expect(screen.getByText('cobradas').textContent).toBe('4 cobradas')
    expect(screen.getByText('por cobrar').textContent).toBe('1 por cobrar')
    expect(screen.getByText('no realizadas').textContent).toBe('2 no realizadas')
    expect(screen.getByLabelText('5 por reclamar')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Armar venta' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pedir traslado' }))
    fireEvent.click(screen.getByRole('button', { name: 'Venta no realizada' }))
    expect([onArmar, onTraslado, onNoRealizada].map((f) => f.mock.calls.length)).toEqual([1, 1, 1])
    fireEvent.click(screen.getByRole('button', { name: /Ventas de caja/ }))
    expect(screen.getByText('Pantalla Ventas de caja')).toBeTruthy()
  })

  it('Finalizar turno pide confirmación y vuelve a "Empieza tu turno"', async () => {
    mocks.turnoActual.mockResolvedValue(turno)
    mocks.finalizarTurno.mockResolvedValue(undefined)
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    abrir()
    const boton = await screen.findByRole('button', { name: 'Finalizar turno' })
    fireEvent.click(boton)
    expect(mocks.finalizarTurno).not.toHaveBeenCalled()
    fireEvent.click(boton)
    await screen.findByText('Empieza tu turno')
    expect(mocks.finalizarTurno).toHaveBeenCalledTimes(1)
    confirmar.mockRestore()
  })

  it('si el turno no se puede leer muestra el error', async () => {
    mocks.turnoActual.mockRejectedValue(new Error('Se requiere un perfil activo'))
    abrir()
    expect((await screen.findByRole('alert')).textContent).toBe('Se requiere un perfil activo')
  })
})
