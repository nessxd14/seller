import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('./supabaseClient', () => ({ supabase: { rpc, from } }))
import { anular, clavesAbiertas, cobrar, cola, devolver, guardar, misPedidos, retirar, tomar } from './PedidoVendedorRepository.supabase'

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

describe('caja: cola, tomar, devolver', () => {
  it('pedidos_vendedor_cola mapea la cola', async () => {
    rpc.mockResolvedValue({ data: [{ pedido_id: 9, codigo: 'PDV-9', numero_dia: 3, estado: 'ENVIADO', vendedor: 'Ana', enviado_en: '2026-10-06T22:41:00Z', total: '105', lineas: 4, tomado_por: null, sesion_caja_id: null }, { pedido_id: 10, codigo: 'PDV-10', numero_dia: 4, estado: 'EN_CAJA', vendedor: 'Luis', enviado_en: null, total: 20, lineas: 1, tomado_por: 'Rony', sesion_caja_id: 7 }], error: null })
    const r = await cola()
    expect(rpc).toHaveBeenCalledWith('pedidos_vendedor_cola')
    expect(r[0]).toEqual({ pedidoId: '9', codigo: 'PDV-9', numeroDia: 3, estado: 'ENVIADO', vendedor: 'Ana', enviadoEn: '2026-10-06T22:41:00Z', total: 105, lineas: 4, tomadoPor: null, sesionCajaId: null })
    expect(r[1]).toMatchObject({ estado: 'EN_CAJA', tomadoPor: 'Rony', sesionCajaId: '7' })
  })

  it('cola vacía y 42501 conserva su code', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await cola()).toEqual([])
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'No autorizado', code: '42501' } })
    expect(((await cola().catch((e: unknown) => e)) as { code?: string }).code).toBe('42501')
  })

  it('tomar_pedido_vendedor con los parámetros exactos y devuelve el pedido mapeado', async () => {
    rpc.mockResolvedValue({ data: { ...pedido, estado: 'EN_CAJA' }, error: null })
    const r = await tomar('9', '4')
    expect(rpc).toHaveBeenCalledWith('tomar_pedido_vendedor', { p_pedido_id: 9, p_sesion_caja_id: 4 })
    expect(r).toMatchObject({ pedidoId: '9', estado: 'EN_CAJA' })
    expect(r.lineas[0].lineaId).toBe('31')
  })

  it('tomar: "ya lo tiene otra caja" llega tal cual', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'El pedido ya lo tiene otra caja', code: 'P0001' } })
    await expect(tomar('9', '4')).rejects.toThrow('El pedido ya lo tiene otra caja')
  })

  it('devolver_pedido_vendedor', async () => {
    rpc.mockResolvedValue({ data: pedido, error: null })
    await devolver('9')
    expect(rpc).toHaveBeenCalledWith('devolver_pedido_vendedor', { p_pedido_id: 9 })
  })
})

describe('cobrar_pedido_vendedor', () => {
  const resultado = { venta_id: 1300, numero: 'VTA-2026-00633', subtotal: 105, descuento_total: 0, total: 105, reintento: false, pedidos: [9], vendedor_id: 'x' }
  const input = {
    pedidoId: '9', sesionCajaId: '4',
    lineas: [{ producto_id: 49, cantidad_base: 3, precio_unitario: 15, sucursal_origen_id: 2, pedido_linea_id: 31, verificada: true as const }],
    quitadas: [{ pedido_linea_id: 34, motivo: 'No lo lleva' }],
    pagos: [{ method: 'cash' as const, amountCents: 10500, receivedCents: 20000 }],
  }

  it('parámetros exactos: p_pedido_ids es un arreglo con un número y no se mandan descuento, cliente ni motivo de reserva', async () => {
    rpc.mockResolvedValue({ data: resultado, error: null })
    const r = await cobrar(input)
    expect(rpc).toHaveBeenCalledWith('cobrar_pedido_vendedor', {
      p_pedido_ids: [9],
      p_lineas: input.lineas,
      p_pagos: [{ metodo: 'EFECTIVO', monto: 105, recibido: 200 }],
      p_sesion_caja_id: 4,
      p_idempotencia: 'pedido-vendedor:9',
      p_quitadas: input.quitadas,
    })
    const params = rpc.mock.calls[0][1]
    for (const k of ['p_descuento_total', 'p_cliente_id', 'p_motivo_reserva']) expect(params).not.toHaveProperty(k)
    expect(r).toEqual({ ventaId: '1300', numero: 'VTA-2026-00633', subtotal: 105, descuentoTotal: 0, total: 105, reintento: false, pedidos: ['9'] })
  })

  it('la clave de idempotencia es la misma en dos llamadas seguidas del mismo pedido y distinta entre pedidos', async () => {
    rpc.mockResolvedValue({ data: resultado, error: null })
    await cobrar(input)
    await cobrar(input)
    await cobrar({ ...input, pedidoId: '10' })
    expect(rpc.mock.calls.map((c) => c[1].p_idempotencia)).toEqual(['pedido-vendedor:9', 'pedido-vendedor:9', 'pedido-vendedor:10'])
  })

  it('"recibido" solo en efectivo; QR y transferencia no lo llevan', async () => {
    rpc.mockResolvedValue({ data: resultado, error: null })
    await cobrar({ ...input, pagos: [{ method: 'qr', amountCents: 10500, receivedCents: 99999 }] })
    expect(rpc.mock.calls[0][1].p_pagos).toEqual([{ metodo: 'QR', monto: 105 }])
  })

  it('reintento: true se refleja', async () => {
    rpc.mockResolvedValue({ data: { ...resultado, reintento: true }, error: null })
    expect((await cobrar(input)).reintento).toBe(true)
  })

  it('el 23514 del motivo de descuento pasa tal cual (mensaje y code)', async () => {
    const message = 'Resma: el precio bajo el 90 % de la lista necesita motivo'
    rpc.mockResolvedValue({ data: null, error: { message, code: '23514', details: null, hint: null } })
    const error = await cobrar(input).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(message)
    expect((error as { code?: string }).code).toBe('23514')
  })

  it('el 42501 conserva su code y un error de stock llega sin cambios', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'No autorizado', code: '42501' } })
    expect(((await cobrar(input).catch((e: unknown) => e)) as { code?: string }).code).toBe('42501')
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Producto 49 está reservado para otro pedido', code: 'P0001' } })
    await expect(cobrar(input)).rejects.toThrow('Producto 49 está reservado para otro pedido')
  })
})
