// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { PantallaEstado } from '../../../domain/pantalla/pantallaCliente'
import { faseVisible, reducirVista, vistaInicial } from '../pantallaVista'

const h = vi.hoisted(() => ({ onEstado: null as null | ((e: unknown) => void), cerrar: vi.fn() }))
vi.mock('../transporte', () => ({
  abrirReceptor: vi.fn(async ({ onEstado }: { onEstado: (e: unknown) => void }) => { h.onEstado = onEstado; return { cerrar: h.cerrar } }),
}))
import { usePantallaReceptor } from '../usePantallaReceptor'

const estado = (over: Partial<PantallaEstado> = {}): PantallaEstado => ({
  v: 1, seq: 1, emisorId: 'a', cajaId: 1, ts: '2026-11-26T10:00:00.000Z', fase: 'venta',
  lineas: [{ key: '1', nombre: 'Lápiz', presentacion: 'Unidad', cantidad: 1, precioUnitario: 2, subtotal: 2, imagenUrl: null }],
  ultimaKey: '1', ultimoCambio: 'agregado', unidades: 1, subtotal: 2, descuento: 0, total: 2, ...over,
})

describe('reducirVista', () => {
  it('ignora un seq menor del mismo emisor', () => {
    const v1 = reducirVista(vistaInicial, { tipo: 'estado', estado: estado({ seq: 5, total: 10 }) })
    const v2 = reducirVista(v1, { tipo: 'estado', estado: estado({ seq: 4, total: 99 }) })
    expect(v2.estado?.total).toBe(10)
  })
  it('acepta un seq menor de un emisor nuevo', () => {
    const v1 = reducirVista(vistaInicial, { tipo: 'estado', estado: estado({ seq: 50, emisorId: 'a', total: 10 }) })
    const v2 = reducirVista(v1, { tipo: 'estado', estado: estado({ seq: 1, emisorId: 'b', total: 7 }) })
    expect(v2.estado).toMatchObject({ emisorId: 'b', total: 7 })
  })
  it('un cambio de cantidad produce una corrección con la cantidad anterior; quitar, con la línea quitada', () => {
    const v1 = reducirVista(vistaInicial, { tipo: 'estado', estado: estado({ seq: 1 }) })
    const mas = estado({ seq: 2, ultimoCambio: 'cantidad', lineas: [{ ...estado().lineas[0], cantidad: 3, subtotal: 6 }] })
    const v2 = reducirVista(v1, { tipo: 'estado', estado: mas })
    expect(v2.correccion).toMatchObject({ tipo: 'cantidad', key: '1', cantidadAnterior: 1 })
    const quitado = estado({ seq: 3, ultimoCambio: 'quitado', lineas: [] })
    const v3 = reducirVista(v2, { tipo: 'estado', estado: quitado })
    expect(v3.correccion).toMatchObject({ tipo: 'quitado', key: '1' })
    expect(v3.correccion?.lineaQuitada?.nombre).toBe('Lápiz')
  })
})

describe('usePantallaReceptor — 35 s sin mensajes', () => {
  beforeEach(() => { vi.useFakeTimers(); h.onEstado = null; h.cerrar.mockClear() })
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('pasa a reposo con «sin conexión» a los 35 s y vuelve con el siguiente mensaje', async () => {
    const { result } = renderHook(() => usePantallaReceptor(1))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => h.onEstado?.(estado({ seq: 1 })))
    expect(faseVisible(result.current)).toBe('venta')

    await act(async () => { await vi.advanceTimersByTimeAsync(34_000) })
    expect(faseVisible(result.current)).toBe('venta')
    expect(result.current.sinConexion).toBe(false)

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(result.current.sinConexion).toBe(true)
    expect(faseVisible(result.current)).toBe('reposo')

    act(() => h.onEstado?.(estado({ seq: 2 })))
    expect(result.current.sinConexion).toBe(false)
    expect(faseVisible(result.current)).toBe('venta')
  })

  it('un mensaje de latido reinicia los 35 s', async () => {
    const { result } = renderHook(() => usePantallaReceptor(1))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    for (let i = 1; i <= 4; i++) {
      act(() => h.onEstado?.(estado({ seq: i })))
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    }
    expect(result.current.sinConexion).toBe(false)
  })

  it('la corrección dura 2,5 s', async () => {
    const { result } = renderHook(() => usePantallaReceptor(1))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => h.onEstado?.(estado({ seq: 1 })))
    act(() => h.onEstado?.(estado({ seq: 2, ultimoCambio: 'cantidad', lineas: [{ ...estado().lineas[0], cantidad: 2, subtotal: 4 }] })))
    expect(result.current.correccion).not.toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(2_500) })
    expect(result.current.correccion).toBeNull()
  })

  it('cierra el canal al desmontar', async () => {
    const { unmount } = renderHook(() => usePantallaReceptor(1))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    unmount()
    expect(h.cerrar).toHaveBeenCalled()
  })
})
