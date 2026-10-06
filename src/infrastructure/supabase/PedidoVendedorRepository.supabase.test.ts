import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('./supabaseClient', () => ({ supabase: { rpc, from } }))
import { anular, clavesAbiertas, guardar, misPedidos, retirar } from './PedidoVendedorRepository.supabase'

const linea = { linea_id: 31, orden: 1, producto_id: 49, nombre: 'Resma', sku: 'RC', presentacion_id: 47, presentacion: 'Unidad', es_base: true, factor: 1, es_personalizado: false, unidad_medida: null, cantidad: 2, precio_lista: 15, precio_minimo: 13.5, precio_unitario: 15, subtotal: 30, resultado: null, cantidad_final: null, precio_final: null, motivo_caja: null }
const pedido = { pedido_id: 9, codigo: 'PDV-9', numero_dia: 1, fecha: '2026-10-06', estado: 'ARMANDO', vendedor: 'Ana', nota: null, total: 67.5, enviado_en: null, tomado_por: null, venta_numero: null, anulado_origen: null, anulado_motivo: null, reintento: false, lineas: [linea] }

beforeEach(() => { rpc.mockReset(); from.mockReset() })

describe('guardar_pedido_vendedor', () => {
  it('manda clave, líneas (catálogo y personalizado), p_enviar y p_nota con los nombres exactos del contrato', async () => {
    rpc.mockResolvedValue({ data: pedido, error: null })
    await guardar({
      clave: 'uuid-1', nota: 'para Ana',
      lineas: [
        { productoId: 49, presentacionId: 3001, cantidad: 2, precioUnitario: 14.5 },
        { productoId: 50, presentacionId: null, cantidad: 1 },
        { esPersonalizado: true, descripcion: 'Cartulina verde', unidadMedida: 'UNIDAD', cantidad: 5, precioUnitario: 3 },
      ],
    })
    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith('guardar_pedido_vendedor', {
      p_clave: 'uuid-1',
      p_lineas: [
        { producto_id: 49, presentacion_id: 3001, cantidad: 2, precio_unitario: 14.5 },
        { producto_id: 50, cantidad: 1 },
        { es_personalizado: true, descripcion: 'Cartulina verde', unidad_medida: 'UNIDAD', cantidad: 5, precio_unitario: 3 },
      ],
      p_enviar: false,
      p_nota: 'para Ana',
    })
  })

  it('p_enviar = true al enviar y p_nota null si no hay nota', async () => {
    rpc.mockResolvedValue({ data: { ...pedido, estado: 'ENVIADO' }, error: null })
    await guardar({ clave: 'k', lineas: [], enviar: true })
    expect(rpc).toHaveBeenCalledWith('guardar_pedido_vendedor', { p_clave: 'k', p_lineas: [], p_enviar: true, p_nota: null })
  })

  it('mapea la respuesta a camelCase', async () => {
    rpc.mockResolvedValue({ data: { ...pedido, reintento: true, total: '67.5' }, error: null })
    const r = await guardar({ clave: 'k', lineas: [] })
    expect(r).toMatchObject({ pedidoId: '9', codigo: 'PDV-9', numeroDia: 1, estado: 'ARMANDO', total: 67.5, reintento: true, tomadoPor: null, ventaNumero: null })
    expect(r.lineas[0]).toMatchObject({ lineaId: '31', orden: 1, productoId: 49, presentacionId: 47, esBase: true, factor: 1, esPersonalizado: false, precioLista: 15, precioMinimo: 13.5, precioUnitario: 15, subtotal: 30, cantidadFinal: null })
  })

  it('el 23514 del piso de precio pasa tal cual (mensaje y code)', async () => {
    const message = 'Resma carta: el precio mínimo es Bs 13.50'
    rpc.mockResolvedValue({ data: null, error: { message, code: '23514', details: null, hint: null } })
    const error = await guardar({ clave: 'k', lineas: [] }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(message)
    expect((error as { code?: string }).code).toBe('23514')
  })

  it('el 42501 conserva su code', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'No autorizado', code: '42501' } })
    const error = await guardar({ clave: 'k', lineas: [] }).catch((e: unknown) => e)
    expect((error as { code?: string }).code).toBe('42501')
  })
})

describe('retirar, anular y mis pedidos', () => {
  it('retirar_pedido_vendedor', async () => {
    rpc.mockResolvedValue({ data: pedido, error: null })
    await retirar('9')
    expect(rpc).toHaveBeenCalledWith('retirar_pedido_vendedor', { p_pedido_id: 9 })
  })

  it('anular_pedido_vendedor con y sin motivo', async () => {
    rpc.mockResolvedValue({ data: { ...pedido, estado: 'ANULADO' }, error: null })
    await anular('9')
    await anular('9', 'Se arrepintió')
    expect(rpc).toHaveBeenNthCalledWith(1, 'anular_pedido_vendedor', { p_pedido_id: 9, p_motivo: null })
    expect(rpc).toHaveBeenNthCalledWith(2, 'anular_pedido_vendedor', { p_pedido_id: 9, p_motivo: 'Se arrepintió' })
  })

  it('un rechazo de retirar llega con su mensaje', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'La caja ya tomó el pedido', code: 'P0001' } })
    await expect(retirar('9')).rejects.toThrow('La caja ya tomó el pedido')
  })

  it('mis_pedidos_vendedor devuelve la lista mapeada (vacía si es null)', async () => {
    rpc.mockResolvedValueOnce({ data: [pedido, { ...pedido, pedido_id: 10, lineas: [] }], error: null })
    rpc.mockResolvedValueOnce({ data: null, error: null })
    const lista = await misPedidos()
    expect(rpc).toHaveBeenCalledWith('mis_pedidos_vendedor')
    expect(lista.map((p) => p.pedidoId)).toEqual(['9', '10'])
    expect(await misPedidos()).toEqual([])
  })
})

describe('clavesAbiertas', () => {
  it('lee pedido_vendedor filtrando siempre por vendedor_id y por estados abiertos', async () => {
    const inFn = vi.fn().mockResolvedValue({ data: [{ id: 9, clave_cliente: 'uuid-9' }, { id: 12, clave_cliente: 'uuid-12' }], error: null })
    const eq = vi.fn().mockReturnValue({ in: inFn })
    const select = vi.fn().mockReturnValue({ eq })
    from.mockReturnValue({ select })
    const claves = await clavesAbiertas('user-1')
    expect(from).toHaveBeenCalledWith('pedido_vendedor')
    expect(select).toHaveBeenCalledWith('id,clave_cliente')
    expect(eq).toHaveBeenCalledWith('vendedor_id', 'user-1')
    expect(inFn).toHaveBeenCalledWith('estado', ['ARMANDO', 'ENVIADO'])
    expect(claves).toEqual([{ pedidoId: '9', clave: 'uuid-9' }, { pedidoId: '12', clave: 'uuid-12' }])
  })
})
