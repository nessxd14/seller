import { beforeEach, describe, expect, it, vi } from 'vitest'

// Brief lecturas-paginadas: PostgREST corta cada respuesta en 1000 filas sin avisar.
// Cada lectura migrada se prueba contra un cliente simulado que, como el real, nunca
// devuelve más de 1000 filas por request: si el repositorio leyera una sola página,
// estos tests verían filas de menos.

const TOPE = 1000

type Llamada = { metodo: string; args: unknown[] }
type Constructor = Record<string, unknown>

const { fromMock, rpcMock, getSessionMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  getSessionMock: vi.fn(),
}))

vi.mock('../supabaseClient', () => ({
  supabase: { from: fromMock, rpc: rpcMock, auth: { getSession: getSessionMock } },
}))

/** Constructor encadenable. `.range()` entrega la porción pedida (máx. 1000); esperarlo sin
 * `.range()` entrega las primeras 1000 filas, como el tope del servidor. */
const constructorDe = (filas: unknown[], llamadas: Llamada[]): Constructor => {
  const builder: Constructor = {}
  for (const metodo of ['select', 'eq', 'in', 'gte', 'lte', 'is', 'not', 'ilike', 'order']) {
    builder[metodo] = (...args: unknown[]) => { llamadas.push({ metodo, args }); return builder }
  }
  builder.range = (desde: number, hasta: number) => {
    llamadas.push({ metodo: 'range', args: [desde, hasta] })
    return Promise.resolve({ data: filas.slice(desde, Math.min(hasta + 1, desde + TOPE)), error: null, count: filas.length })
  }
  builder.then = (resolver: (v: unknown) => unknown, rechazar: (e: unknown) => unknown) =>
    Promise.resolve({ data: filas.slice(0, TOPE), error: null, count: filas.length }).then(resolver, rechazar)
  return builder
}

/** Registra `from(tabla)` → filas. Devuelve las llamadas hechas por tabla. */
const tablas = (datos: Record<string, unknown[]>) => {
  const llamadas: Record<string, Llamada[]> = {}
  fromMock.mockImplementation((tabla: string) => {
    if (!(tabla in datos)) throw new Error(`tabla inesperada en el mock: ${tabla}`)
    llamadas[tabla] ??= []
    return constructorDe(datos[tabla], llamadas[tabla])
  })
  return llamadas
}

const serie = <T>(n: number, fila: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => fila(i + 1))

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
  getSessionMock.mockReset().mockResolvedValue({ data: { session: { access_token: 'tok' } } })
})

describe('ReportsRepository.getSummary — ventas y caja', () => {
  it('suma todas las ventas aunque pasen de 1000 y las ordena por venta_id', async () => {
    const llamadas = tablas({
      v_reporte_ventas: serie(2500, () => ({ total: '10.00' })),
      v_reporte_caja: serie(1500, () => ({ diferencia: '-1.00' })),
    })
    const { reportsRepository } = await import('../ReportsRepository.supabase')
    const resumen = await reportsRepository.getSummary({ from: '2026-11-01', to: '2026-11-30' })
    expect(resumen.operaciones).toBe(2500)
    expect(resumen.totalVendidoCents).toBe(2500 * 1000)
    expect(resumen.ticketPromedioCents).toBe(1000)
    expect(resumen.diferenciaCajaCents).toBe(-1500 * 100)
    expect(llamadas.v_reporte_ventas.filter((c) => c.metodo === 'range')).toHaveLength(3)
    expect(llamadas.v_reporte_ventas).toContainEqual({ metodo: 'order', args: ['venta_id', { ascending: true }] })
    expect(llamadas.v_reporte_caja.filter((c) => c.metodo === 'range')).toHaveLength(2)
    expect(llamadas.v_reporte_caja).toContainEqual({ metodo: 'order', args: ['sesion_id', { ascending: true }] })
  })
})

describe('CustomerRepository.listAll (customerService.list() sin argumentos)', () => {
  it('trae los 1200 clientes, ordenados por id desc', async () => {
    const llamadas = tablas({ cliente: serie(1200, (id) => ({ id, nombre: `Cliente ${id}`, creado_en: '2026-01-01T00:00:00Z' })) })
    const { customerRepository } = await import('../CustomerRepository.supabase')
    const clientes = await customerRepository.listAll()
    expect(clientes).toHaveLength(1200)
    expect(new Set(clientes.map((c) => c.id)).size).toBe(1200)
    expect(llamadas.cliente).toContainEqual({ metodo: 'order', args: ['id', { ascending: false }] })
  })
})

describe('OrderRepository.listAll (orderService.list())', () => {
  it('trae los 1200 pedidos, ordenados por id desc, sin consultar líneas', async () => {
    const llamadas = tablas({
      pedido: serie(1200, (id) => ({ id, numero: `PED-${id}`, categoria: 'MAYOR', estado: 'ABIERTO', creado_en: '2026-08-01T00:00:00Z', subtotal: 1, descuento_general: 0, total: 1, cliente: null })),
    })
    const { orderRepository } = await import('../OrderRepository.supabase')
    const pedidos = await orderRepository.listAll({ categorias: ['MAYOR'] })
    expect(pedidos).toHaveLength(1200)
    expect(new Set(pedidos.map((p) => p.id)).size).toBe(1200)
    expect(llamadas.pedido).toContainEqual({ metodo: 'order', args: ['id', { ascending: false }] })
    expect(llamadas.pedido).toContainEqual({ metodo: 'in', args: ['categoria', ['MAYOR']] })
    expect(fromMock).not.toHaveBeenCalledWith('pedido_linea')
  })
})

describe('contarVersionesPedidos', () => {
  it('manda lotes de 200 ids y cuenta todas las versiones aunque un lote pase de 1000 filas', async () => {
    // 450 pedidos → 3 lotes (200, 200, 50). El mock devuelve las 1200 versiones al primer
    // lote en dos páginas; los demás lotes reciben 3 filas.
    const ids = serie(450, (n) => n)
    // El lote se vuelve a armar en cada página (un .in() por .range()): se indexa por su primer id.
    const porLote = new Map<number, number>()
    fromMock.mockImplementation(() => {
      const llamadas: Llamada[] = []
      const builder = constructorDe([], llamadas)
      builder.in = (_columna: string, lote: number[]) => {
        porLote.set(lote[0], lote.length)
        const filas = lote[0] === 1 ? serie(1200, () => ({ pedido_id: 1 })) : serie(3, () => ({ pedido_id: lote[0] }))
        return constructorDe(filas, llamadas)
      }
      return builder
    })
    const { contarVersionesPedidos } = await import('../OrderAdmin.supabase')
    const conteo = await contarVersionesPedidos(ids)
    expect([...porLote.entries()]).toEqual([[1, 200], [201, 200], [401, 50]])
    expect(conteo.get(1)).toBe(1200)
    expect(conteo.get(201)).toBe(3)
    expect(conteo.get(401)).toBe(3)
  })
})

describe('listPagosPorVerificar', () => {
  it('lee las 2500 ventas por páginas y manda los pagos en lotes de 200 ventas', async () => {
    const lotesPagos: number[] = []
    const ventas = serie(2500, (id) => ({ id, numero: `VTA-${id}` }))
    fromMock.mockImplementation((tabla: string) => {
      const llamadas: Llamada[] = []
      if (tabla === 'sesion_caja') return constructorDe([{ id: 7 }], llamadas)
      if (tabla === 'venta') return constructorDe(ventas, llamadas)
      if (tabla === 'venta_pago') {
        const builder = constructorDe([], llamadas)
        builder.in = (_columna: string, lote: number[]) => {
          lotesPagos.push(lote.length)
          // un pago PENDIENTE por venta del lote
          return constructorDe(lote.map((ventaId) => ({ id: ventaId, venta_id: ventaId, metodo: 'QR', monto: '1.00', creado_en: `2026-11-09T10:${String(ventaId % 60).padStart(2, '0')}:00Z` })), llamadas)
        }
        return builder
      }
      throw new Error(`tabla inesperada: ${tabla}`)
    })
    const { listPagosPorVerificar } = await import('../TurnoRepository.supabase')
    const pagos = await listPagosPorVerificar()
    expect(pagos).toHaveLength(2500)
    expect(new Set(pagos.map((p) => p.ventaPagoId)).size).toBe(2500)
    expect(lotesPagos).toHaveLength(13)
    expect(Math.max(...lotesPagos)).toBe(200)
    expect(pagos.find((p) => p.ventaId === '2500')?.numero).toBe('VTA-2500')
    // quedan ordenados por creado_en ascendente
    const fechas = pagos.map((p) => p.creadoEn)
    expect([...fechas].sort()).toEqual(fechas)
  })

  it('un error en la lectura de ventas se lanza como Error con el mensaje de la base', async () => {
    fromMock.mockImplementation((tabla: string) => {
      const llamadas: Llamada[] = []
      if (tabla === 'sesion_caja') return constructorDe([{ id: 7 }], llamadas)
      const builder = constructorDe([], llamadas)
      builder.range = () => Promise.resolve({ data: null, error: { message: 'statement timeout', code: '57014' } })
      return builder
    })
    const { listPagosPorVerificar } = await import('../TurnoRepository.supabase')
    const error = await listPagosPorVerificar().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('statement timeout')
  })
})

describe('ComisionRepository.getProductosHuerfanos', () => {
  it('agrega las 2500 líneas aunque pasen de 1000, con orden estable por todas las columnas', async () => {
    const llamadas = tablas({
      v_comision_huerfano_linea: serie(2500, (i) => ({ producto_id: (i % 2) + 1, producto_nombre: `P${(i % 2) + 1}`, marca: null, fecha: '2026-11-01', monto: '2.00' })),
    })
    const { comisionesRepository } = await import('../ComisionRepository.supabase')
    const huerfanos = await comisionesRepository.getProductosHuerfanos({ from: '2026-11-01', to: '2026-11-30' })
    const total = huerfanos.reduce((suma, p) => suma + p.montoVendidoCents, 0)
    expect(total).toBe(2500 * 200)
    expect(huerfanos).toHaveLength(2)
    const orden = llamadas.v_comision_huerfano_linea.filter((c) => c.metodo === 'order').map((c) => c.args[0]).slice(0, 5)
    expect(orden).toEqual(['producto_id', 'fecha', 'monto', 'producto_nombre', 'marca'])
  })
})

describe('Hermes — consultarSaldos / consultarSaldosSimilares en lotes de 200', () => {
  const respuestaPorLote = (lote: number[]) => lote.map((id) => ({ pos_cliente_id: id, saldo_confirmado: '1.50', saldo_provisional: '1.50', situacion: 'DEUDOR' }))

  it('consultarSaldos: 450 ids → 3 llamadas de ≤200 y un solo mapa con los 450', async () => {
    rpcMock.mockImplementation(async (_nombre: string, args: { p_cliente_ids: number[] }) => ({ data: respuestaPorLote(args.p_cliente_ids), error: null }))
    const { consultarSaldos } = await import('../../hermes/client')
    const ids = serie(450, (n) => n)
    const mapa = await consultarSaldos(ids)
    expect(rpcMock.mock.calls.map(([, args]) => (args as { p_cliente_ids: number[] }).p_cliente_ids.length)).toEqual([200, 200, 50])
    expect(mapa?.size).toBe(450)
    expect(mapa?.get(450)?.saldoConfirmado).toBe(1.5)
  })

  it('consultarSaldos: si un lote falla devuelve null, no un mapa parcial', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: respuestaPorLote(serie(200, (n) => n)), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'caído' } })
    const { consultarSaldos } = await import('../../hermes/client')
    expect(await consultarSaldos(serie(450, (n) => n))).toBeNull()
    expect(rpcMock).toHaveBeenCalledTimes(2)
  })

  it('consultarSaldos: exactamente 200 ids es una sola llamada', async () => {
    rpcMock.mockImplementation(async (_n: string, args: { p_cliente_ids: number[] }) => ({ data: respuestaPorLote(args.p_cliente_ids), error: null }))
    const { consultarSaldos } = await import('../../hermes/client')
    const mapa = await consultarSaldos(serie(200, (n) => n))
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(mapa?.size).toBe(200)
  })

  it('consultarSaldosSimilares: 450 ids → 3 llamadas y los 450 en el mapa', async () => {
    rpcMock.mockImplementation(async (_n: string, args: { p_cliente_ids: number[] }) => ({
      data: args.p_cliente_ids.map((id) => ({ pos_cliente_id: id, hermes_cliente_id: id + 1000, saldo_confirmado: '2', monto_en_revision: '0', saldo_provisional: '2', situacion: 'DEUDOR', partidas_abiertas: 1 })),
      error: null,
    }))
    const { consultarSaldosSimilares } = await import('../../hermes/client')
    const mapa = await consultarSaldosSimilares(serie(450, (n) => n))
    expect(rpcMock).toHaveBeenCalledTimes(3)
    expect(mapa?.size).toBe(450)
    expect(mapa?.get(7)?.hermesClienteId).toBe(1007)
  })

  it('consultarSaldosSimilares: un lote caído devuelve null', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'caído' } })
    const { consultarSaldosSimilares } = await import('../../hermes/client')
    expect(await consultarSaldosSimilares(serie(450, (n) => n))).toBeNull()
  })
})
