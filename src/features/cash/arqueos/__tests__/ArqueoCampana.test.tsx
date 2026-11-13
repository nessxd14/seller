// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ArqueoProgramado } from '../../../../application/shared/models'

const h = vi.hoisted(() => ({ arqueos: vi.fn(), registrar: vi.fn(), getSession: vi.fn() }))
vi.mock('../../../../config/featureFlags', () => ({ featureFlags: { supabase: true } }))
vi.mock('../../../../context/CashSessionContext', () => ({ useCashSession: () => ({ sessionId: '7', loading: false, refresh: async () => {} }) }))
vi.mock('../../../../infrastructure/services', () => ({ turnoService: { arqueos: h.arqueos, arqueoPeriodico: h.registrar }, authSessionProvider: { getSession: h.getSession } }))
import { ArqueoCampana } from '../ArqueoCampana'

const T0 = Date.parse('2026-11-13T10:00:00Z')
const MIN = 60_000
const iso = (ms: number) => new Date(ms).toISOString()
// Cada prueba usa horas distintas: la campana anuncia una sola vez por arqueo y estado.
let desfase = 0
const arq = (numero: number, programadoMs: number, estado: ArqueoProgramado['estado'] = 'PROGRAMADO'): ArqueoProgramado => ({ numero, programadoEn: iso(programadoMs + desfase), venceEn: iso(programadoMs + desfase + 30 * MIN), estado })
const cargar = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0) }) }

beforeEach(() => {
  desfase += 24 * 60 * MIN
  vi.useFakeTimers()
  vi.setSystemTime(T0 + desfase)
  h.arqueos.mockReset()
  h.registrar.mockReset()
  h.getSession.mockReset().mockResolvedValue({ user: { id: 'u', role: 'cajero', active: true } })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

const ahora = () => iso(Date.now())

describe('ArqueoCampana', () => {
  it('sin arqueo pendiente es una campana tranquila; al hacer clic lista los arqueos sin dinero', async () => {
    h.arqueos.mockImplementation(async () => ({ ahoraServidor: ahora(), arqueos: [arq(1, T0 - 120 * MIN, 'CUMPLIDO'), arq(2, T0 + 60 * MIN)] }))
    render(<ArqueoCampana notify={vi.fn()} />)
    await cargar()
    fireEvent.click(screen.getByRole('button', { name: 'Arqueos del turno' }))
    const lista = screen.getByRole('dialog', { name: 'Arqueos del turno' })
    expect(lista.textContent).toContain('Arqueo 1')
    expect(lista.textContent).toContain('a tiempo')
    expect(lista.textContent).toContain('programado')
    expect(lista.textContent).not.toMatch(/Bs|esperado|diferencia/i)
  })

  it('con un arqueo pendiente muestra cuenta regresiva, avisa y vibra una sola vez', async () => {
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', { ...navigator, vibrate })
    h.arqueos.mockImplementation(async () => ({ ahoraServidor: ahora(), arqueos: [arq(2, T0 - 18 * MIN)] }))
    const notify = vi.fn()
    render(<ArqueoCampana notify={notify} />)
    await cargar()
    const boton = screen.getByRole('button', { name: 'Arqueo 2 de 3 pendiente, quedan 12 minutos' })
    expect(boton.textContent).toContain('12:00')
    expect(notify).toHaveBeenCalledWith('Es hora del arqueo 2 de 3 — tienes 30 min')
    expect(vibrate).toHaveBeenCalledWith([200, 100, 200])
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent).toContain('Es hora del arqueo 2 de 3')
  })

  it('pasa a "Fuera de hora" en rojo y vibra otra vez', async () => {
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', { ...navigator, vibrate })
    h.arqueos.mockImplementation(async () => ({ ahoraServidor: ahora(), arqueos: [arq(3, T0 - 29 * MIN)] }))
    render(<ArqueoCampana notify={vi.fn()} />)
    await cargar()
    expect(vibrate).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(2 * MIN) })
    expect(screen.getByText('Fuera de hora').className).toContain('es-tarde')
    expect(screen.getByRole('button', { name: 'Arqueo 3 de 3 fuera de hora' })).toBeTruthy()
    expect(vibrate).toHaveBeenCalledTimes(2)
  })

  it('no lanza si el navegador no tiene vibrate (escritorio)', async () => {
    vi.stubGlobal('navigator', { userAgent: 'x' })
    h.arqueos.mockImplementation(async () => ({ ahoraServidor: ahora(), arqueos: [arq(1, T0 - 10 * MIN)] }))
    render(<ArqueoCampana notify={vi.fn()} />)
    await cargar()
    expect(screen.getByRole('button', { name: /Arqueo 1 de 3 pendiente/ })).toBeTruthy()
  })

  it('el clic abre el diálogo del conteo y "Más tarde" lo cierra dejando la campana activa', async () => {
    h.arqueos.mockImplementation(async () => ({ ahoraServidor: ahora(), arqueos: [arq(1, T0 - 10 * MIN)] }))
    render(<ArqueoCampana notify={vi.fn()} />)
    await cargar()
    fireEvent.click(screen.getByRole('button', { name: /Arqueo 1 de 3 pendiente/ }))
    expect(screen.getByRole('dialog', { name: /Arqueo 1 de 3/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Más tarde' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: /Arqueo 1 de 3 pendiente/ })).toBeTruthy()
  })

  it('no se pinta si no es cajero', async () => {
    h.getSession.mockResolvedValue({ user: { id: 'u', role: 'gerente', active: true } })
    const { container } = render(<ArqueoCampana notify={vi.fn()} />)
    await cargar()
    expect(container.querySelector('.arqueo-campana')).toBeNull()
  })
})
