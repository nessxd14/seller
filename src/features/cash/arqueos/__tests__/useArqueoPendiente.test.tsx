// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ArqueoProgramado } from '../../../../application/shared/models'

const h = vi.hoisted(() => ({ arqueos: vi.fn(), registrar: vi.fn(), getSession: vi.fn(), sessionId: { current: '7' as string | null } }))
vi.mock('../../../../config/featureFlags', () => ({ featureFlags: { supabase: true } }))
vi.mock('../../../../context/CashSessionContext', () => ({ useCashSession: () => ({ sessionId: h.sessionId.current, loading: false, refresh: async () => {} }) }))
vi.mock('../../../../infrastructure/services', () => ({
  turnoService: { arqueos: h.arqueos, arqueoPeriodico: h.registrar },
  authSessionProvider: { getSession: h.getSession },
}))
import { derivarArqueoPendiente, useArqueoPendiente } from '../useArqueoPendiente'

const T0 = Date.parse('2026-11-13T10:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()
const MIN = 60_000
const arq = (numero: number, programadoMs: number, estado: ArqueoProgramado['estado'] = 'PROGRAMADO'): ArqueoProgramado => ({ numero, programadoEn: iso(programadoMs), venceEn: iso(programadoMs + 30 * MIN), estado })
const respuesta = (arqueos: ArqueoProgramado[], ahoraMs = Date.now()) => ({ ahoraServidor: iso(ahoraMs), arqueos })
const avanzar = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  h.sessionId.current = '7'
  h.arqueos.mockReset()
  h.registrar.mockReset()
  h.getSession.mockReset().mockResolvedValue({ user: { id: 'u', role: 'cajero', active: true } })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('derivarArqueoPendiente', () => {
  it('toma el más antiguo que ya tocó; cumplidos y cancelados no cuentan', () => {
    const lista = [arq(1, T0 - 100 * MIN, 'CUMPLIDO'), arq(2, T0 - 10 * MIN), arq(3, T0 + 60 * MIN), arq(4, T0 - 200 * MIN, 'CANCELADO')]
    const r = derivarArqueoPendiente(lista, T0)
    expect(r.estado).toBe('pendiente')
    expect(r.arqueo?.numero).toBe(2)
    expect(r.restanteMs).toBe(20 * MIN)
  })
  it('después de vence_en o con estado VENCIDO está fuera de hora', () => {
    expect(derivarArqueoPendiente([arq(1, T0 - 31 * MIN)], T0).estado).toBe('fuera_de_hora')
    expect(derivarArqueoPendiente([arq(1, T0 - 5 * MIN, 'VENCIDO')], T0).estado).toBe('fuera_de_hora')
  })
  it('sin nada que toque devuelve nada', () => {
    expect(derivarArqueoPendiente([], T0).estado).toBe('nada')
    expect(derivarArqueoPendiente([arq(1, T0 + MIN)], T0).estado).toBe('nada')
  })
})

describe('useArqueoPendiente', () => {
  it('se activa en programado_en, cuenta hacia atrás y pasa a fuera de hora en vence_en', async () => {
    h.arqueos.mockImplementation(async () => respuesta([arq(1, T0 + 5 * MIN)]))
    const { result } = renderHook(() => useArqueoPendiente())
    await avanzar(0)
    expect(result.current.estado).toBe('nada')
    expect(result.current.activo).toBe(true)
    await avanzar(5 * MIN - 1_000)
    expect(result.current.estado).toBe('nada')
    await avanzar(1_000)
    expect(result.current.estado).toBe('pendiente')
    expect(result.current.arqueo?.numero).toBe(1)
    expect(result.current.restanteMs).toBe(30 * MIN)
    await avanzar(10 * MIN)
    expect(result.current.restanteMs).toBe(20 * MIN)
    await avanzar(20 * MIN)
    expect(result.current.estado).toBe('pendiente')
    await avanzar(1_500)
    expect(result.current.estado).toBe('fuera_de_hora')
  })

  it('se limpia al registrar: refresca y ya no hay pendiente', async () => {
    let hecho = false
    h.arqueos.mockImplementation(async () => respuesta([arq(1, T0 - MIN, hecho ? 'CUMPLIDO' : 'PROGRAMADO')]))
    h.registrar.mockImplementation(async () => { hecho = true; return { numero: 1, estado: 'CUMPLIDO' } })
    const { result } = renderHook(() => useArqueoPendiente())
    await avanzar(0)
    expect(result.current.estado).toBe('pendiente')
    let r: unknown
    await act(async () => { r = await result.current.registrar({ '100': 1 }) })
    expect(r).toEqual({ numero: 1, estado: 'CUMPLIDO' })
    expect(h.registrar).toHaveBeenCalledWith('7', { '100': 1 })
    expect(result.current.estado).toBe('nada')
  })

  it('respeta el reloj del servidor cuando la PC está atrasada o adelantada', async () => {
    // La PC marca T0 pero el servidor va 10 min adelante: el arqueo de T0+5 min ya tocó.
    h.arqueos.mockImplementation(async () => respuesta([arq(1, T0 + 5 * MIN)], Date.now() + 10 * MIN))
    const { result } = renderHook(() => useArqueoPendiente())
    await avanzar(0)
    expect(result.current.estado).toBe('pendiente')
    expect(result.current.restanteMs).toBe(25 * MIN)
  })

  it('con el reloj del servidor atrasado, no se adelanta', async () => {
    h.arqueos.mockImplementation(async () => respuesta([arq(1, T0 - MIN)], Date.now() - 10 * MIN))
    const { result } = renderHook(() => useArqueoPendiente())
    await avanzar(0)
    expect(result.current.estado).toBe('nada')
    await avanzar(9 * MIN + 1_000)
    expect(result.current.estado).toBe('pendiente')
  })

  it('sondea cada 60 s con la pestaña visible', async () => {
    h.arqueos.mockImplementation(async () => respuesta([]))
    renderHook(() => useArqueoPendiente())
    await avanzar(0)
    expect(h.arqueos).toHaveBeenCalledTimes(1)
    await avanzar(60_000)
    expect(h.arqueos).toHaveBeenCalledTimes(2)
  })

  it('no hace nada si no es cajero o no hay turno abierto', async () => {
    h.getSession.mockResolvedValue({ user: { id: 'u', role: 'gerente', active: true } })
    const gerente = renderHook(() => useArqueoPendiente())
    await avanzar(0)
    expect(gerente.result.current.activo).toBe(false)
    expect(h.arqueos).not.toHaveBeenCalled()
    gerente.unmount()
    h.getSession.mockResolvedValue({ user: { id: 'u', role: 'cajero', active: true } })
    h.sessionId.current = null
    const sinTurno = renderHook(() => useArqueoPendiente())
    await avanzar(0)
    expect(sinTurno.result.current.activo).toBe(false)
    expect(h.arqueos).not.toHaveBeenCalled()
  })

  it('un error de lectura no rompe nada', async () => {
    h.arqueos.mockRejectedValue(new Error('sin red'))
    const { result } = renderHook(() => useArqueoPendiente())
    await avanzar(0)
    expect(result.current.estado).toBe('nada')
  })
})
