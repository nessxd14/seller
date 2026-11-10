import { beforeEach, describe, expect, it, vi } from 'vitest'

// precioSugeridoLote y getStockByProductsBatch contra un cliente simulado.

const { fromMock, rpcMock, getSessionMock } = vi.hoisted(() => ({ fromMock: vi.fn(), rpcMock: vi.fn(), getSessionMock: vi.fn() }))
vi.mock('../supabaseClient', () => ({ supabase: { from: fromMock, rpc: rpcMock, auth: { getSession: getSessionMock } } }))

const TOPE = 1000
const crudo = (precio: number) => ({ factor: '1', ultimo_cliente: { precio: String(precio), fecha: '2026-11-01', numero: 'V-1', fuente: 'VENTA' }, categoria: null })
const lineas = (n: number) => Array.from({ length: n }, (_, i) => ({ productId: i + 1 }))

const cargarPrecios = async () => {
  vi.resetModules()
  return import('../PreciosRepository.supabase')
}

beforeEach(() => { fromMock.mockReset(); rpcMock.mockReset() })

describe('precioSugeridoLote', () => {
  it('entrada vacía devuelve [] sin pedir nada', async () => {
    const { precioSugeridoLote } = await cargarPrecios()
    await expect(precioSugeridoLote([])).resolves.toEqual([])
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('mapea igual que precioSugerido y conserva el orden', async () => {
    rpcMock.mockResolvedValue({ data: [crudo(10), crudo(20)], error: null })
    const { precioSugeridoLote } = await cargarPrecios()
    const res = await precioSugeridoLote([{ productId: 7, presentacionId: 3 }, { productId: 8 }], { clienteId: 5, categoria: 'MAYOREO' })
    expect(res.map((r) => r.ultimoCliente?.precio)).toEqual([10, 20])
    expect(res[0].factor).toBe(1)
    expect(rpcMock).toHaveBeenCalledWith('precio_sugerido_lote', {
      p_lineas: [{ producto_id: 7, presentacion_id: 3 }, { producto_id: 8, presentacion_id: null }], p_cliente_id: 5, p_categoria: 'MAYOREO',
    })
  })

  it('450 líneas salen en tres llamadas (200, 200, 50) y un solo arreglo de 450', async () => {
    rpcMock.mockImplementation(async (_n: string, args: { p_lineas: unknown[] }) => ({ data: args.p_lineas.map(() => crudo(1)), error: null }))
    const { precioSugeridoLote } = await cargarPrecios()
    const res = await precioSugeridoLote(lineas(450))
    expect(res).toHaveLength(450)
    expect(rpcMock.mock.calls.map(([, a]) => (a as { p_lineas: unknown[] }).p_lineas.length)).toEqual([200, 200, 50])
  })

  it('si la longitud no coincide, lanza', async () => {
    rpcMock.mockResolvedValue({ data: [crudo(1)], error: null })
    const { precioSugeridoLote } = await cargarPrecios()
    await expect(precioSugeridoLote(lineas(2))).rejects.toThrow(/1 resultados para 2 líneas/)
  })

  it('con PGRST202 responde línea por línea y no vuelve a llamar al lote en la sesión', async () => {
    rpcMock.mockImplementation(async (nombre: string) => (nombre === 'precio_sugerido_lote'
      ? { data: null, error: { code: 'PGRST202', message: 'no existe' } }
      : { data: crudo(5), error: null }))
    const { precioSugeridoLote } = await cargarPrecios()
    const res = await precioSugeridoLote([{ productId: 1, presentacionId: 9 }, { productId: 2 }])
    expect(res).toHaveLength(2)
    expect(rpcMock.mock.calls.map(([n]) => n)).toEqual(['precio_sugerido_lote', 'precio_sugerido', 'precio_sugerido'])
    expect(rpcMock).toHaveBeenCalledWith('precio_sugerido', { p_producto_id: 1, p_cliente_id: null, p_categoria: null, p_presentacion_id: 9 })
    rpcMock.mockClear()
    await precioSugeridoLote([{ productId: 3 }])
    expect(rpcMock.mock.calls.map(([n]) => n)).toEqual(['precio_sugerido'])
  })

  it('cualquier otro error se lanza tal cual', async () => {
    const error = { code: '42501', message: 'sin permiso' }
    rpcMock.mockResolvedValue({ data: null, error })
    const { precioSugeridoLote } = await cargarPrecios()
    await expect(precioSugeridoLote(lineas(1))).rejects.toBe(error)
    expect(rpcMock).toHaveBeenCalledTimes(1)
  })
})

describe('getStockByProductsBatch', () => {
  const builder = (filas: unknown[], llamadas: Array<{ metodo: string; args: unknown[] }>) => {
    const b: Record<string, unknown> = {}
    let ids: number[] | null = null
    for (const metodo of ['select', 'order']) b[metodo] = (...args: unknown[]) => { llamadas.push({ metodo, args }); return b }
    b.in = (...args: unknown[]) => { llamadas.push({ metodo: 'in', args }); ids = args[1] as number[]; return b }
    b.range = (desde: number, hasta: number) => {
      llamadas.push({ metodo: 'range', args: [desde, hasta] })
      const visibles = ids ? filas.filter((f) => ids!.includes((f as { producto_id: number }).producto_id)) : filas
      return Promise.resolve({ data: visibles.slice(desde, Math.min(hasta + 1, desde + TOPE)), error: null })
    }
    return b
  }
  const fila = (producto_id: number, ubicacion_id: number, cantidad = 1) => ({ producto_id, ubicacion_id, cantidad_base: String(cantidad), ubicacion: { sucursal_id: ubicacion_id, excluye_disponible: false } })

  it('una lectura de stock_actual, sin saldo_disponible_pedido, y todos los ids quedan en el mapa', async () => {
    const llamadas: Array<{ metodo: string; args: unknown[] }> = []
    fromMock.mockImplementation((tabla: string) => { expect(tabla).toBe('stock_actual'); return builder([fila(1, 1, 4), fila(1, 2, 6)], llamadas) })
    const { getStockByProductsBatch } = await import('../ProductRepository.supabase')
    const mapa = await getStockByProductsBatch([1, 2, 1])
    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).not.toHaveBeenCalled()
    expect([...mapa.keys()]).toEqual([1, 2])
    expect(mapa.get(2)).toEqual([])
    expect(mapa.get(1)).toEqual([
      { ubicacionId: 1, sucursalId: 1, cantidadBase: 4, excluyeDisponible: undefined },
      { ubicacionId: 2, sucursalId: 2, cantidadBase: 6, excluyeDisponible: undefined },
    ])
    expect(llamadas).toContainEqual({ metodo: 'in', args: ['producto_id', [1, 2]] })
    expect(llamadas.filter((c) => c.metodo === 'order').map((c) => c.args[0])).toEqual(['producto_id', 'ubicacion_id'])
  })

  it('lee completo lo que pasa de 1.000 filas', async () => {
    const filas = Array.from({ length: 1200 }, (_, i) => fila(1 + Math.floor(i / 6), (i % 6) + 1))
    fromMock.mockImplementation(() => builder(filas, []))
    const { getStockByProductsBatch } = await import('../ProductRepository.supabase')
    const mapa = await getStockByProductsBatch(Array.from({ length: 200 }, (_, i) => i + 1))
    expect([...mapa.values()].reduce((suma, rows) => suma + rows.length, 0)).toBe(1200)
  })

  it('parte los ids en lotes de 200', async () => {
    fromMock.mockImplementation(() => builder([], []))
    const { getStockByProductsBatch } = await import('../ProductRepository.supabase')
    const mapa = await getStockByProductsBatch(Array.from({ length: 450 }, (_, i) => i + 1))
    expect(fromMock).toHaveBeenCalledTimes(3)
    expect(mapa.size).toBe(450)
  })
})
