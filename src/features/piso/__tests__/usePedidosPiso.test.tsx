// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { PedidoVendedorRecord } from '../../../application/shared/models'

const svc = vi.hoisted(() => ({ guardar: vi.fn(), retirar: vi.fn(), anular: vi.fn(), misPedidos: vi.fn(), clavesAbiertas: vi.fn() }))
vi.mock('../../../infrastructure/services', () => ({ pedidoVendedorService: svc }))
import { usePedidosPiso } from '../usePedidosPiso'

const producto = { id: 49, nombre: 'Resma carta', sku: 'RC', precioRetail: 25 }
const respuesta = (over: Partial<PedidoVendedorRecord> = {}): PedidoVendedorRecord => ({
  pedidoId: '9', codigo: 'PDV-9', numeroDia: 12, fecha: '2026-10-06', estado: 'ARMANDO', canal: 'TIENDA', vendedor: 'Ana', nota: null, total: 25, enviadoEn: null, tomadoPor: null,
  ventaNumero: null, anuladoOrigen: null, anuladoMotivo: null, reintento: false,
  lineas: [{ lineaId: '77', orden: 1, productoId: 49, nombre: 'Resma carta', sku: 'RC', presentacionId: 47, presentacion: 'Unidad', esBase: true, factor: 1, esPersonalizado: false, unidadMedida: null, cantidad: 1, precioLista: 25, precioMinimo: 22.5, precioUnitario: 25, subtotal: 25, resultado: null, cantidadFinal: null, precioFinal: null, motivoCaja: null }],
  ...over,
})
const ms = (n: number) => act(async () => { await vi.advanceTimersByTimeAsync(n) })
const montar = async () => {
  const hook = renderHook(() => usePedidosPiso('u1'))
  await ms(0)
  return hook
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  Object.values(svc).forEach((f) => f.mockReset())
  svc.misPedidos.mockResolvedValue([])
  svc.clavesAbiertas.mockResolvedValue([])
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('usePedidosPiso', () => {
  it('guarda solo 1,5 s después del último cambio y aplica el número del día', async () => {
    svc.guardar.mockResolvedValue(respuesta())
    const { result } = await montar()
    act(() => result.current.agregar(producto))
    await ms(1400)
    expect(svc.guardar).not.toHaveBeenCalled()
    act(() => result.current.cambiarCantidad(result.current.activo.lineas[0].localId, 2))
    await ms(1400)
    expect(svc.guardar).not.toHaveBeenCalled()
    await ms(200)
    expect(svc.guardar).toHaveBeenCalledOnce()
    expect(svc.guardar.mock.calls[0][0]).toMatchObject({ lineas: [{ productoId: 49, presentacionId: null, cantidad: 2, precioUnitario: 25 }], nota: null })
    expect(result.current.activo).toMatchObject({ numeroDia: 12, pedidoId: '9' })
    expect(result.current.activo.lineas[0]).toMatchObject({ precioMinimo: 22.5, precioGuardado: 25 })
    // Con todo guardado no vuelve a mandar nada.
    await ms(5000)
    expect(svc.guardar).toHaveBeenCalledOnce()
  })

  it('persiste el pedido en este teléfono bajo una clave por usuario', async () => {
    const { result } = await montar()
    act(() => result.current.agregar(producto))
    const guardado = JSON.parse(localStorage.getItem('roari-piso-v1:u1') as string)
    expect(guardado.pedidos[0].lineas).toHaveLength(1)
    expect(guardado.activa).toBe(result.current.activo.clave)
  })

  it('23514: muestra el mensaje del servidor en la línea, vuelve al precio anterior y no reintenta solo', async () => {
    svc.guardar.mockResolvedValueOnce(respuesta())
    const { result } = await montar()
    act(() => result.current.agregar(producto))
    await ms(1500)
    const id = result.current.activo.lineas[0].localId
    const mensaje = 'Resma carta: el precio mínimo es Bs 22.50'
    svc.guardar.mockRejectedValueOnce(Object.assign(new Error(mensaje), { code: '23514' }))
    act(() => result.current.cambiarPrecio(id, 10))
    await ms(1500)
    expect(svc.guardar).toHaveBeenCalledTimes(2)
    expect(result.current.activo.lineas[0]).toMatchObject({ error: mensaje, precioUnitario: 25 })
    await ms(60000)
    expect(svc.guardar).toHaveBeenCalledTimes(2)
  })

  it('sin conexión: sigue guardado en el teléfono, avisa y reintenta con espera creciente', async () => {
    svc.guardar.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    svc.guardar.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    svc.guardar.mockResolvedValue(respuesta())
    const { result } = await montar()
    act(() => result.current.agregar(producto))
    await ms(1500)
    expect(result.current.sinConexion).toBe(true)
    expect(svc.guardar).toHaveBeenCalledTimes(1)
    await ms(2000)
    expect(svc.guardar).toHaveBeenCalledTimes(2)
    await ms(3900)
    expect(svc.guardar).toHaveBeenCalledTimes(2)
    await ms(200)
    expect(svc.guardar).toHaveBeenCalledTimes(3)
    expect(result.current.sinConexion).toBe(false)
    expect(result.current.activo.numeroDia).toBe(12)
  })

  it('enviar: guarda con enviar = true, deja de autoguardar y no deja enviar sin precio', async () => {
    svc.guardar.mockResolvedValue(respuesta({ estado: 'ENVIADO', enviadoEn: 'x' }))
    const { result } = await montar()
    act(() => result.current.agregar({ ...producto, precioRetail: 0 }))
    await act(async () => { expect(await result.current.enviar()).toBe(false) })
    expect(svc.guardar).not.toHaveBeenCalled()
    expect(result.current.errorPedido[result.current.activo.clave]).toMatch(/precio/i)
    act(() => result.current.cambiarPrecio(result.current.activo.lineas[0].localId, 30))
    await act(async () => { expect(await result.current.enviar()).toBe(true) })
    expect(svc.guardar).toHaveBeenCalledOnce()
    expect(svc.guardar.mock.calls[0][0]).toMatchObject({ enviar: true })
    expect(result.current.activo.estado).toBe('ENVIADO')
    await ms(10000)
    expect(svc.guardar).toHaveBeenCalledOnce()
  })

  it('reconstruye desde el servidor un pedido abierto que no está en este teléfono (usa las claves de pedido_vendedor)', async () => {
    svc.misPedidos.mockResolvedValue([respuesta({ estado: 'ENVIADO' })])
    svc.clavesAbiertas.mockResolvedValue([{ pedidoId: '9', clave: 'clave-remota' }])
    const { result } = await montar()
    expect(svc.clavesAbiertas).toHaveBeenCalledWith('u1')
    const recuperado = result.current.pedidos.find((p) => p.clave === 'clave-remota')
    expect(recuperado).toMatchObject({ pedidoId: '9', estado: 'ENVIADO', numeroDia: 12 })
    expect(recuperado?.lineas).toHaveLength(1)
  })

  it('con un pedido enviado consulta mis_pedidos cada 5 s y refleja el avance de la caja', async () => {
    svc.misPedidos.mockResolvedValue([respuesta({ estado: 'ENVIADO' })])
    svc.clavesAbiertas.mockResolvedValue([{ pedidoId: '9', clave: 'k9' }])
    const { result } = await montar()
    const llamadas = svc.misPedidos.mock.calls.length
    svc.misPedidos.mockResolvedValue([respuesta({ estado: 'EN_CAJA', tomadoPor: 'Rony' })])
    await ms(5000)
    expect(svc.misPedidos.mock.calls.length).toBe(llamadas + 1)
    expect(result.current.pedidos.find((p) => p.clave === 'k9')).toMatchObject({ estado: 'EN_CAJA' })
    expect(result.current.pedidos.find((p) => p.clave === 'k9')?.snapshot?.tomadoPor).toBe('Rony')
  })
})

describe('usePedidosPiso — venta de almacén', () => {
  it('guarda con canal ALMACEN y exige la referencia del cliente para enviar', async () => {
    svc.guardar.mockImplementation(async (input: { canal?: 'TIENDA' | 'ALMACEN'; nota?: string | null; enviar?: boolean }) => respuesta({ canal: input.canal, nota: input.nota ?? null, estado: input.enviar ? 'ENVIADO' : 'ARMANDO' }))
    const { result } = await montar()
    act(() => result.current.agregar(producto))
    act(() => { result.current.setCanal('ALMACEN') })
    await ms(1600)
    expect(svc.guardar).toHaveBeenCalledOnce()
    expect(svc.guardar.mock.calls[0][0]).toMatchObject({ canal: 'ALMACEN', nota: null })

    // Sin cliente no se envía: ni siquiera llega al servidor.
    let ok = true
    await act(async () => { ok = await result.current.enviar() })
    expect(ok).toBe(false)
    expect(svc.guardar).toHaveBeenCalledOnce()
    expect(result.current.errorPedido[result.current.activo.clave]).toMatch(/quién es el cliente/)

    act(() => result.current.setNota('Doña Rosa'))
    await act(async () => { ok = await result.current.enviar() })
    expect(ok).toBe(true)
    expect(svc.guardar.mock.lastCall?.[0]).toMatchObject({ canal: 'ALMACEN', nota: 'Doña Rosa', enviar: true })
  })

  it('un pedido de tienda manda canal TIENDA', async () => {
    svc.guardar.mockResolvedValue(respuesta())
    const { result } = await montar()
    act(() => result.current.agregar(producto))
    await ms(1600)
    expect(svc.guardar.mock.calls[0][0]).toMatchObject({ canal: 'TIENDA' })
  })

  it('no pasa a ALMACEN si hay un producto fuera de catálogo', async () => {
    const { result } = await montar()
    act(() => result.current.agregarPersonalizado({ descripcion: 'Cartulina', unidadMedida: 'UNIDAD', cantidad: 1, precio: 3 }))
    let ok = true
    act(() => { ok = result.current.setCanal('ALMACEN') })
    expect(ok).toBe(false)
    expect(result.current.activo.canal).toBe('TIENDA')
  })

  it('«Mover» crea una segunda venta de almacén guardada (sin enviar) con esa línea y la quita de la primera', async () => {
    svc.guardar.mockImplementation(async (input: { clave: string; canal?: 'TIENDA' | 'ALMACEN' }) => respuesta({ pedidoId: input.clave, canal: input.canal }))
    const { result } = await montar()
    act(() => result.current.agregar(producto))
    act(() => result.current.agregar({ ...producto, id: 50, nombre: 'Lapicero', sku: 'LP' }))
    const origen = result.current.activo.clave
    const mover = result.current.activo.lineas[0].localId
    act(() => { result.current.mover(mover) })

    expect(result.current.pedidos).toHaveLength(2)
    const nueva = result.current.pedidos.find((p) => p.clave !== origen)!
    expect(nueva).toMatchObject({ canal: 'ALMACEN', estado: 'ARMANDO' })
    expect(nueva.lineas.map((l) => l.nombre)).toEqual(['Resma carta'])
    expect(result.current.activo.clave).toBe(origen)
    expect(result.current.activo.lineas.map((l) => l.nombre)).toEqual(['Lapicero'])

    await ms(1600)
    const guardados = svc.guardar.mock.calls.map((c) => c[0] as { clave: string; canal?: string; enviar?: boolean })
    expect(guardados.find((g) => g.clave === nueva.clave)).toMatchObject({ canal: 'ALMACEN' })
    expect(guardados.every((g) => !g.enviar)).toBe(true)
  })

  it('un segundo «Mover» suma a la venta de almacén que ya está en armado', async () => {
    svc.guardar.mockResolvedValue(respuesta())
    const { result } = await montar()
    act(() => result.current.agregar(producto))
    act(() => result.current.agregar({ ...producto, id: 50, nombre: 'Lapicero', sku: 'LP' }))
    act(() => { result.current.mover(result.current.activo.lineas[0].localId) })
    act(() => { result.current.mover(result.current.activo.lineas[0].localId) })
    expect(result.current.pedidos).toHaveLength(2)
    expect(result.current.pedidos.find((p) => p.canal === 'ALMACEN')?.lineas).toHaveLength(2)
  })
})
