import { afterEach, describe, expect, it, vi } from 'vitest'

const { fromMock, rpcMock, getSessionMock } = vi.hoisted(() => ({ fromMock: vi.fn(), rpcMock: vi.fn(), getSessionMock: vi.fn() }))
vi.mock('../supabaseClient', () => ({ supabase: { from: fromMock, rpc: rpcMock, auth: { getSession: getSessionMock } } }))

const producto = (id: number, nombre: string, extra: Record<string, unknown> = {}) => ({
  id, nombre, sku_interno: `S${id}`, marca: 'Marca', unidad_base: 'unidad', precio_base: 5, precio_mayoreo: null,
  precio_institucion: null, precio_corporativo: null, activo: true, imagen_url: null, stock_min: null, punto_reorden: null, familia_id: null, familia: null, ...extra,
})
const presentacion = (id: number, producto_id: number, extra: Record<string, unknown> = {}) => ({
  presentacion_id: id, producto_id, nombre: 'Unidad', factor_unidad_base: 1, es_base: true, activo: true, precio_retail: 5,
  precio_mayoreo: null, precio_institucion: null, precio_corporativo: null, tiene_precio_propio: false, vende_tienda: true, vende_almacen: true, ...extra,
})

const datos: Record<string, unknown[]> = {
  producto: [producto(1, 'Papel Bond Carta'), producto(2, 'Bolígrafo Azul')],
  v_presentacion_precio: [presentacion(10, 1), presentacion(11, 1, { nombre: 'Caja', factor_unidad_base: 12, es_base: false }), presentacion(20, 2)],
  identificador: [
    { id: 1, presentacion_id: 10, tipo: 'barra', valor: '779001', es_principal: true },
    { id: 2, presentacion_id: 11, tipo: 'barra', valor: '779111', es_principal: false },
    { id: 3, presentacion_id: 20, tipo: 'fabrica', valor: 'FAB-2', es_principal: false },
  ],
}

const constructor = (filas: unknown[]) => {
  const builder: Record<string, unknown> = {}
  for (const metodo of ['select', 'eq', 'order', 'in', 'gte']) builder[metodo] = () => builder
  builder.range = (desde: number, hasta: number) => Promise.resolve({ data: filas.slice(desde, hasta + 1), error: null })
  return builder
}

const cargar = async () => {
  vi.resetModules()
  fromMock.mockReset().mockImplementation((tabla: string) => constructor(datos[tabla] ?? []))
  rpcMock.mockReset().mockResolvedValue({ data: 1, error: null })
  getSessionMock.mockReset().mockResolvedValue({ data: { session: { access_token: 't' } } })
  const catalogo = (await import('../CatalogoLocal.supabase')).catalogoLocal
  const repo = await import('../ProductRepository.supabase')
  return { catalogo, repo }
}

const sinLlamadas = () => { fromMock.mockClear(); rpcMock.mockClear() }

afterEach(() => vi.useRealTimers())

describe('ProductRepository con el catálogo cargado', () => {
  it('responde datos conocidos sin tocar Supabase', async () => {
    const { catalogo, repo } = await cargar()
    await catalogo.asegurarCarga()
    sinLlamadas()

    const busqueda = await repo.productRepository.search({ query: 'boligrafo', active: true, page: { page: 1, pageSize: 10 } })
    expect(busqueda.items.map((p) => p.id)).toEqual([2])
    expect(busqueda.total).toBe(1)
    expect(busqueda.items[0].codigoFabrica).toBe('FAB-2')

    expect((await repo.productRepository.getById('1'))?.nombre).toBe('Papel Bond Carta')
    expect((await repo.productRepository.findBySku('S2'))?.id).toBe(2)
    expect((await repo.listPresentations(1)).map((p) => p.nombre)).toEqual(['Unidad', 'Caja'])
    expect(await repo.listIdentifiersForProducts(['1', '2'])).toEqual({
      '1': { barra: '779001', fabrica: undefined, marca: 'Marca' },
      '2': { barra: undefined, fabrica: 'FAB-2', marca: 'Marca' },
    })
    const escaneado = await repo.productRepository.resolveScannedCode('779111')
    expect(escaneado).toMatchObject({ kind: 'found', product: { id: 1 }, presentation: { id: 11, esBase: false } })

    expect(fromMock).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('un producto fuera del índice (inactivo) y una búsqueda sin active se resuelven por la red', async () => {
    const { catalogo, repo } = await cargar()
    await catalogo.asegurarCarga()
    sinLlamadas()
    fromMock.mockImplementation(() => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }))
    expect(await repo.productRepository.getById('99')).toBeNull()
    expect(fromMock).toHaveBeenCalledWith('producto')
    await expect(repo.listIdentifiersForProducts(['1', '99'])).rejects.toBeDefined()
  })

  it('resolveScannedCode usa la RPC para un código que el índice no conoce', async () => {
    const { catalogo, repo } = await cargar()
    await catalogo.asegurarCarga()
    sinLlamadas()
    rpcMock.mockResolvedValue({ data: [], error: null })
    fromMock.mockImplementation(() => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }))
    expect(await repo.productRepository.resolveScannedCode('NUEVO-123')).toEqual({ kind: 'not_found' })
    expect(rpcMock).toHaveBeenCalledWith('resolver_identificador', { p_codigo: 'NUEVO-123' })
  })

  it('un código ambiguo se informa sin red', async () => {
    const { catalogo, repo } = await cargar()
    datos.identificador.push({ id: 9, presentacion_id: 20, tipo: 'barra', valor: '779001', es_principal: false })
    try {
      await catalogo.asegurarCarga()
      sinLlamadas()
      expect(await repo.productRepository.resolveScannedCode('779001')).toEqual({ kind: 'ambiguous', productIds: [1, 2] })
      expect(rpcMock).not.toHaveBeenCalled()
    } finally { datos.identificador.pop() }
  })
})

describe('ProductRepository sin catálogo cargado', () => {
  it('search usa la red, dispara la carga sin esperarla y listPresentations consulta la vista', async () => {
    const { catalogo, repo } = await cargar()
    const llamadas: string[] = []
    fromMock.mockImplementation((tabla: string) => {
      llamadas.push(tabla)
      const builder: Record<string, unknown> = {}
      for (const metodo of ['select', 'eq', 'in', 'or', 'order', 'ilike', 'limit']) builder[metodo] = () => builder
      builder.range = () => Promise.resolve({ data: [], error: null, count: 0 })
      builder.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok)
      return builder
    })
    expect(catalogo.listo()).toBe(false)
    const pagina = await repo.productRepository.search({ query: 'x', active: true, page: { page: 1, pageSize: 10 } })
    expect(pagina.total).toBe(0)
    expect(llamadas[0]).toBe('producto')
    await repo.listPresentations(1)
    expect(llamadas).toContain('v_presentacion_precio')
  })
})

describe('listFrecuentes', () => {
  const montarFrecuentes = async () => {
    const { repo } = await cargar()
    fromMock.mockReset().mockImplementation((tabla: string) => {
      const builder: Record<string, unknown> = {}
      for (const metodo of ['select', 'eq', 'in', 'gte', 'order']) builder[metodo] = () => builder
      builder.range = () => Promise.resolve({ data: tabla === 'v_reporte_productos_vendidos' ? [{ producto_id: 1, cantidad_base: 2 }] : [], error: null })
      builder.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: tabla === 'producto' ? [producto(1, 'Papel')] : [], error: null }).then(ok)
      return builder
    })
    return repo
  }

  it('la segunda llamada dentro de 30 minutos no hace pedidos', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-09T12:00:00Z'))
    const repo = await montarFrecuentes()
    const primera = await repo.listFrecuentes(12)
    expect(primera.map((p) => p.id)).toEqual([1])
    fromMock.mockClear()
    expect((await repo.listFrecuentes(12)).map((p) => p.id)).toEqual([1])
    expect(fromMock).not.toHaveBeenCalled()
    vi.setSystemTime(Date.now() + 31 * 60_000)
    await repo.listFrecuentes(12)
    expect(fromMock).toHaveBeenCalled()
  })

  it('una llamada fallida no se guarda', async () => {
    const repo = await montarFrecuentes()
    fromMock.mockImplementationOnce(() => { throw new Error('sin red') })
    await expect(repo.listFrecuentes(7)).rejects.toThrow('sin red')
    fromMock.mockClear()
    await repo.listFrecuentes(7)
    expect(fromMock).toHaveBeenCalled()
  })
})
