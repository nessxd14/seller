// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ ventasPorReclamar: vi.fn(), reclamar: vi.fn(), deshacerReclamo: vi.fn() }))
vi.mock('../../../infrastructure/services', () => ({ pisoRepository: mocks }))
import { VentasCajaPiso } from '../VentasCajaPiso'

const venta = (ventaId: number, over: Record<string, unknown> = {}) => ({ ventaId, numero: `VTA-${ventaId}`, total: 45.5, completadoEn: '2026-11-12T15:20:00Z', producto: 'Resma carta', nProductos: 1, ...over })
const vaciar = async () => { await act(async () => { await Promise.resolve() }) }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date('2026-11-12T15:30:00Z'))
  Object.values(mocks).forEach((m) => m.mockReset())
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('VentasCajaPiso', () => {
  it('lista solo monto, producto, hora, ticket y cantidad; sin nombres de cajero ni cliente', async () => {
    mocks.ventasPorReclamar.mockResolvedValue([venta(1), venta(2, { producto: 'Lápiz', nProductos: 3 })])
    const { container } = render(<VentasCajaPiso onVolver={vi.fn()} />)
    await vaciar()
    expect(screen.getByText('Bs 45,50 · Resma carta')).toBeTruthy()
    expect(screen.getByText('Bs 45,50 · Lápiz y 2 más')).toBeTruthy()
    expect(screen.getByText(/VTA-1 · 1 producto$/)).toBeTruthy()
    expect(screen.getByText(/VTA-2 · 3 productos$/)).toBeTruthy()
    expect(screen.getByText(/Toca/).textContent).toBe('Toca Es mía solo en las ventas que tú atendiste. Si hay un error, caja lo corrige.')
    expect(container.textContent).not.toMatch(/cajer|cliente/i)
  })

  it('vacío: dice que no hay ventas sin vendedor', async () => {
    mocks.ventasPorReclamar.mockResolvedValue([])
    render(<VentasCajaPiso onVolver={vi.fn()} />)
    await vaciar()
    expect(screen.getByText('No hay ventas de caja sin vendedor en los últimos 30 minutos.')).toBeTruthy()
  })

  it('Es mía: la tarjeta pasa a "Tuya" con cuenta regresiva y deshacer vuelve a pedir la lista', async () => {
    mocks.ventasPorReclamar.mockResolvedValue([venta(1)])
    mocks.reclamar.mockResolvedValue({ reclamoId: 9, ventaId: 1, deshacerHasta: '2026-11-12T15:35:00Z' })
    mocks.deshacerReclamo.mockResolvedValue(undefined)
    render(<VentasCajaPiso onVolver={vi.fn()} />)
    await vaciar()
    fireEvent.click(screen.getByRole('button', { name: 'Es mía' }))
    await vaciar()
    expect(mocks.reclamar).toHaveBeenCalledWith(1)
    expect(screen.getByText('Tuya')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Me equivoqué · deshacer (5:00)' })).toBeTruthy()
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(screen.getByRole('button', { name: 'Me equivoqué · deshacer (4:58)' })).toBeTruthy()
    mocks.ventasPorReclamar.mockResolvedValue([venta(1)])
    fireEvent.click(screen.getByRole('button', { name: /Me equivoqué/ }))
    await vaciar()
    expect(mocks.deshacerReclamo).toHaveBeenCalledWith(1)
    expect(screen.queryByText('Tuya')).toBeNull()
    expect(screen.getByRole('button', { name: 'Es mía' })).toBeTruthy()
  })

  it('a los 5 minutos ya no ofrece deshacer', async () => {
    mocks.ventasPorReclamar.mockResolvedValue([venta(1)])
    mocks.reclamar.mockResolvedValue({ reclamoId: 9, ventaId: 1, deshacerHasta: '2026-11-12T15:35:00Z' })
    render(<VentasCajaPiso onVolver={vi.fn()} />)
    await vaciar()
    fireEvent.click(screen.getByRole('button', { name: 'Es mía' }))
    await vaciar()
    await act(async () => { vi.advanceTimersByTime(5 * 60_000 + 1000) })
    expect(screen.getByText('Tuya')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Me equivoqué/ })).toBeNull()
  })

  it('si otro la reclamó antes: muestra el mensaje de la base y refresca la lista', async () => {
    mocks.ventasPorReclamar.mockResolvedValueOnce([venta(1)]).mockResolvedValue([])
    mocks.reclamar.mockRejectedValue(new Error('Esta venta ya no se puede reclamar (ya tiene dueño, pasaron los 30 minutos o es de otra sucursal)'))
    render(<VentasCajaPiso onVolver={vi.fn()} />)
    await vaciar()
    fireEvent.click(screen.getByRole('button', { name: 'Es mía' }))
    await vaciar()
    expect(screen.getByRole('alert').textContent).toMatch(/Esta venta ya no se puede reclamar/)
    expect(mocks.ventasPorReclamar).toHaveBeenCalledTimes(2)
  })

  it('refresca la lista cada 20 segundos', async () => {
    mocks.ventasPorReclamar.mockResolvedValue([])
    render(<VentasCajaPiso onVolver={vi.fn()} />)
    await vaciar()
    await act(async () => { vi.advanceTimersByTime(20_000) })
    expect(mocks.ventasPorReclamar).toHaveBeenCalledTimes(2)
  })
})
