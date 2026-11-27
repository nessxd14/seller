// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { PantallaEstado } from '../../../domain/pantalla/pantallaCliente'

const h = vi.hoisted(() => ({
  enviar: vi.fn(), cerrar: vi.fn(),
  pos: { cart: [] as unknown[], subtotal: 0, total: 0, mode: 'venta' },
  caja: { cajaId: null as number | null },
}))
vi.mock('../transporte', () => ({ abrirEmisor: vi.fn(async () => ({ enviar: h.enviar, cerrar: h.cerrar })) }))
vi.mock('../../../context/PosContext', () => ({ usePos: () => h.pos }))
vi.mock('../../../context/CashSessionContext', () => ({ useCashSession: () => h.caja }))
import { abrirEmisor } from '../transporte'
import { usePantallaClienteEmisor } from '../usePantallaClienteEmisor'
import { PantallaClienteProvider, usePantallaCliente } from '../PantallaClienteContext'

const linea = (id: number, cantidad: number) => ({ id, nombre: `P${id}`, cantidad, precioAplicado: 10, descuento: 0 })
const enviados = () => h.enviar.mock.calls.map((c) => c[0] as PantallaEstado)

beforeEach(() => {
  vi.useFakeTimers()
  h.enviar.mockReset().mockResolvedValue(undefined); h.cerrar.mockReset()
  h.pos = { cart: [], subtotal: 0, total: 0, mode: 'venta' }
  h.caja = { cajaId: null }
  vi.mocked(abrirEmisor).mockClear()
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

const montar = (rol: Parameters<typeof usePantallaClienteEmisor>[0]) => renderHook(() => usePantallaClienteEmisor(rol))
const avanzar = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('usePantallaClienteEmisor', () => {
  it('es un no-op sin sesión de caja abierta', async () => {
    h.pos.cart = [linea(1, 1)]; h.pos.subtotal = 10; h.pos.total = 10
    montar('cajero')
    await avanzar(500)
    expect(abrirEmisor).not.toHaveBeenCalled()
    expect(h.enviar).not.toHaveBeenCalled()
  })

  it('es un no-op para un rol que no es de caja', async () => {
    h.caja.cajaId = 1
    montar('vendedor')
    await avanzar(500)
    expect(abrirEmisor).not.toHaveBeenCalled()
  })

  it('con sesión abierta envía el snapshot completo con debounce de 120 ms y detecta la línea agregada', async () => {
    h.caja.cajaId = 1
    h.pos.cart = [linea(7, 2)]; h.pos.subtotal = 20; h.pos.total = 20
    montar('cajero')
    await avanzar(100)
    expect(h.enviar).not.toHaveBeenCalled()
    await avanzar(30)
    expect(h.enviar).toHaveBeenCalledTimes(1)
    expect(enviados()[0]).toMatchObject({ v: 1, cajaId: 1, fase: 'venta', ultimaKey: '7', ultimoCambio: 'agregado', unidades: 2, total: 20 })
  })

  it('reenvía el último snapshot cada 10 s con venta y cada 30 s en reposo, con seq creciente', async () => {
    h.caja.cajaId = 1
    h.pos.cart = [linea(1, 1)]; h.pos.subtotal = 10; h.pos.total = 10
    const { rerender } = montar('cajero')
    await avanzar(130)
    expect(h.enviar).toHaveBeenCalledTimes(1)
    await avanzar(10_000)
    expect(h.enviar).toHaveBeenCalledTimes(2)
    expect(enviados()[1].seq).toBeGreaterThan(enviados()[0].seq)

    h.pos = { ...h.pos, cart: [], subtotal: 0, total: 0 }
    rerender()
    await avanzar(130)
    const antes = h.enviar.mock.calls.length
    expect(enviados().at(-1)?.fase).toBe('reposo')
    await avanzar(29_000)
    expect(h.enviar.mock.calls.length).toBe(antes)
    await avanzar(1_000)
    expect(h.enviar.mock.calls.length).toBe(antes + 1)
  })

  it('en modo traslado manda reposo', async () => {
    h.caja.cajaId = 1
    h.pos = { cart: [linea(1, 1)], subtotal: 10, total: 10, mode: 'traslado' }
    montar('admin')
    await avanzar(130)
    expect(enviados()[0]).toMatchObject({ fase: 'reposo', lineas: [] })
  })

  it('no lanza hacia el POS cuando channel.send rechaza o lanza: solo console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    h.caja.cajaId = 1
    h.pos.cart = [linea(1, 1)]; h.pos.subtotal = 10; h.pos.total = 10
    h.enviar.mockRejectedValueOnce(new Error('canal caído')).mockImplementationOnce(() => { throw new Error('síncrono') })
    const { rerender } = montar('cajero')
    await avanzar(130)
    h.pos = { ...h.pos, cart: [linea(1, 2)], subtotal: 20, total: 20 }
    rerender()
    await avanzar(130)
    expect(warn).toHaveBeenCalled()
    expect(h.enviar).toHaveBeenCalledTimes(2)
  })

  it('si abrir el canal falla, solo avisa', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(abrirEmisor).mockRejectedValueOnce(new Error('sin realtime'))
    h.caja.cajaId = 1
    montar('cajero')
    await avanzar(130)
    expect(warn).toHaveBeenCalled()
  })

  it('al cerrar la sesión de caja manda reposo antes de soltar el canal', async () => {
    h.caja.cajaId = 1
    h.pos.cart = [linea(1, 1)]; h.pos.subtotal = 10; h.pos.total = 10
    const { rerender } = montar('cajero')
    await avanzar(130)
    h.caja = { cajaId: null }
    rerender()
    await avanzar(0)
    expect(enviados().at(-1)).toMatchObject({ fase: 'reposo', lineas: [] })
    expect(h.cerrar).toHaveBeenCalled()
  })

  it('cobro → gracias (6 s) → reposo sin volver a mostrar lo cobrado; una línea nueva vuelve a venta', async () => {
    h.caja.cajaId = 1
    h.pos.cart = [linea(1, 2)]; h.pos.subtotal = 20; h.pos.total = 20
    const { result, rerender } = renderHook(() => { usePantallaClienteEmisor('cajero'); return usePantallaCliente() }, { wrapper: PantallaClienteProvider })
    await avanzar(130)

    act(() => result.current.setCobro({ metodo: 'efectivo', recibido: 50, cambio: 30 }, 20))
    await avanzar(130)
    expect(enviados().at(-1)).toMatchObject({ fase: 'cobro', total: 20, cobro: { metodo: 'efectivo', cambio: 30 } })

    act(() => result.current.anunciarGracias({ ticket: 'VTA-2026-00042', total: 20, cobro: { metodo: 'efectivo', recibido: 50, cambio: 30 } }))
    await avanzar(130)
    expect(enviados().at(-1)).toMatchObject({ fase: 'gracias', ticket: 'VTA-2026-00042', total: 20 })

    await avanzar(6_000)
    await avanzar(130)
    expect(enviados().at(-1)).toMatchObject({ fase: 'reposo', lineas: [] })

    // El cajero escanea otro producto: vuelve a venta.
    h.pos = { ...h.pos, cart: [linea(1, 2), linea(2, 1)], subtotal: 30, total: 30 }
    rerender()
    await avanzar(130)
    expect(enviados().at(-1)).toMatchObject({ fase: 'venta', ultimaKey: '2', ultimoCambio: 'agregado', total: 30 })
  })

  it('una línea nueva corta «gracias» antes de los 6 s', async () => {
    h.caja.cajaId = 1
    h.pos.cart = [linea(1, 1)]; h.pos.subtotal = 10; h.pos.total = 10
    const { result, rerender } = renderHook(() => { usePantallaClienteEmisor('cajero'); return usePantallaCliente() }, { wrapper: PantallaClienteProvider })
    await avanzar(130)
    act(() => result.current.anunciarGracias({ ticket: 'VTA-1', total: 10 }))
    await avanzar(130)
    expect(enviados().at(-1)?.fase).toBe('gracias')
    h.pos = { ...h.pos, cart: [linea(1, 1), linea(3, 1)], subtotal: 20, total: 20 }
    rerender()
    await avanzar(130)
    expect(enviados().at(-1)).toMatchObject({ fase: 'venta', ultimaKey: '3' })
    expect(result.current.gracias).toBeNull()
  })
})
