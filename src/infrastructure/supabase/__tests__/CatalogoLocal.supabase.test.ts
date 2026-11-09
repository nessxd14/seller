import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// El cargador del catálogo en memoria contra un cliente simulado que, como PostgREST, nunca
// devuelve más de 1000 filas por request.

const TOPE = 1000

const { fromMock, rpcMock, getSessionMock } = vi.hoisted(() => ({ fromMock: vi.fn(), rpcMock: vi.fn(), getSessionMock: vi.fn() }))
vi.mock('../supabaseClient', () => ({ supabase: { from: fromMock, rpc: rpcMock, auth: { getSession: getSessionMock } } }))

type Datos = Record<string, unknown[]>

const constructor = (filas: unknown[]) => {
  const builder: Record<string, unknown> = {}
  for (const metodo of ['select', 'eq', 'order']) builder[metodo] = () => builder
  builder.range = (desde: number, hasta: number) => Promise.resolve({ data: filas.slice(desde, Math.min(hasta + 1, desde + TOPE)), error: null })
  return builder
}

const producto = (id: number) => ({
  id, nombre: `Producto ${id}`, sku_interno: `S${id}`, marca: null, unidad_base: 'unidad', precio_base: 1, precio_mayoreo: null,
  precio_institucion: null, precio_corporativo: null, activo: true, imagen_url: null, stock_min: null, punto_reorden: null, familia_id: null, familia: null,
})
const presentacion = (id: number) => ({
  presentacion_id: id, producto_id: id, nombre: 'Unidad', factor_unidad_base: 1, es_base: true, activo: true, precio_retail: 1,
  precio_mayoreo: null, precio_institucion: null, precio_corporativo: null, tiene_precio_propio: false, vende_tienda: true, vende_almacen: true,
})
const serie = <T>(n: number, fila: (i: number) => T) => Array.from({ length: n }, (_, i) => fila(i + 1))

const catalogoChico = (): Datos => ({ producto: serie(3, producto), v_presentacion_precio: serie(3, presentacion), identificador: [] })

const cargarModulo = async (datos: Datos, version: number | { code: string } = 1) => {
  vi.resetModules()
  fromMock.mockReset().mockImplementation((tabla: string) => constructor(datos[tabla] ?? []))
  rpcMock.mockReset().mockImplementation(async () => (typeof version === 'number' ? { data: version, error: null } : { data: null, error: version }))
  getSessionMock.mockReset().mockResolvedValue({ data: { session: { access_token: 't' } } })
  return (await import('../CatalogoLocal.supabase')).catalogoLocal
}

const cargasDeProducto = () => fromMock.mock.calls.filter(([tabla]) => tabla === 'producto').length

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-09T12:00:00Z')) })
afterEach(() => { vi.useRealTimers() })

describe('catalogoLocal.asegurarCarga', () => {
  it('llamadas concurrentes cargan una sola vez', async () => {
    const catalogo = await cargarModulo(catalogoChico())
    await Promise.all([catalogo.asegurarCarga(), catalogo.asegurarCarga(), catalogo.asegurarCarga()])
    expect(cargasDeProducto()).toBe(1)
    expect(catalogo.listo()).toBe(true)
    await catalogo.asegurarCarga()
    expect(cargasDeProducto()).toBe(1)
  })

  it('lee completo lo que pasa de 1.000 filas', async () => {
    const catalogo = await cargarModulo({ producto: serie(2500, producto), v_presentacion_precio: serie(2500, presentacion), identificador: [] })
    await catalogo.asegurarCarga()
    expect(catalogo.indice()?.productos.size).toBe(2500)
    expect(catalogo.indice()?.presentaciones.get(2500)).toHaveLength(1)
  })

  it('no carga sin sesión, y eso no cuenta como fallo', async () => {
    const catalogo = await cargarModulo(catalogoChico())
    getSessionMock.mockResolvedValue({ data: { session: null } })
    await catalogo.asegurarCarga()
    expect(catalogo.listo()).toBe(false)
    expect(fromMock).not.toHaveBeenCalled()
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 't' } } })
    await catalogo.asegurarCarga()
    expect(catalogo.listo()).toBe(true)
  })

  it('una carga fallida deja el índice en null y reintenta como mucho una vez por minuto', async () => {
    const catalogo = await cargarModulo(catalogoChico())
    fromMock.mockImplementation(() => { throw new Error('red caída') })
    await expect(catalogo.asegurarCarga()).resolves.toBeUndefined()
    expect(catalogo.listo()).toBe(false)
    expect(catalogo.indice()).toBeNull()
    const intentos = fromMock.mock.calls.length
    await catalogo.asegurarCarga()
    expect(fromMock.mock.calls.length).toBe(intentos)
    vi.setSystemTime(Date.now() + 61_000)
    fromMock.mockImplementation((tabla: string) => constructor(catalogoChico()[tabla]))
    await catalogo.asegurarCarga()
    expect(catalogo.listo()).toBe(true)
  })

  it('invalidar suelta el índice y una carga en vuelo no lo reinstala', async () => {
    const catalogo = await cargarModulo(catalogoChico())
    const enVuelo = catalogo.asegurarCarga()
    catalogo.invalidar()
    await enVuelo
    expect(catalogo.listo()).toBe(false)
    await catalogo.asegurarCarga()
    expect(catalogo.listo()).toBe(true)
    catalogo.invalidar()
    expect(catalogo.indice()).toBeNull()
  })
})

describe('catalogoLocal.refrescarSiCambio', () => {
  it('recarga cuando cambia la versión y no hace nada con la misma', async () => {
    const catalogo = await cargarModulo(catalogoChico(), 1)
    await catalogo.asegurarCarga()
    expect(cargasDeProducto()).toBe(1)
    vi.setSystemTime(Date.now() + 31_000)
    await catalogo.refrescarSiCambio()
    expect(cargasDeProducto()).toBe(1)
    rpcMock.mockResolvedValue({ data: 2, error: null })
    vi.setSystemTime(Date.now() + 31_000)
    await catalogo.refrescarSiCambio()
    expect(cargasDeProducto()).toBe(2)
    vi.setSystemTime(Date.now() + 31_000)
    await catalogo.refrescarSiCambio()
    expect(cargasDeProducto()).toBe(2)
  })

  it('respeta la ventana de 30 segundos', async () => {
    const catalogo = await cargarModulo(catalogoChico(), 1)
    await catalogo.asegurarCarga()
    const llamadasInicial = rpcMock.mock.calls.length
    await catalogo.refrescarSiCambio()
    expect(rpcMock.mock.calls.length).toBe(llamadasInicial + 1)
    vi.setSystemTime(Date.now() + 10_000)
    await catalogo.refrescarSiCambio()
    expect(rpcMock.mock.calls.length).toBe(llamadasInicial + 1)
    vi.setSystemTime(Date.now() + 21_000)
    await catalogo.refrescarSiCambio()
    expect(rpcMock.mock.calls.length).toBe(llamadasInicial + 2)
  })

  it('sin la función (PGRST202) recarga solo si el índice tiene más de 15 minutos', async () => {
    const catalogo = await cargarModulo(catalogoChico(), { code: 'PGRST202' })
    await catalogo.asegurarCarga()
    expect(cargasDeProducto()).toBe(1)
    vi.setSystemTime(Date.now() + 14 * 60_000)
    await catalogo.refrescarSiCambio()
    expect(cargasDeProducto()).toBe(1)
    vi.setSystemTime(Date.now() + 2 * 60_000)
    await catalogo.refrescarSiCambio()
    expect(cargasDeProducto()).toBe(2)
  })

  it('otro error conserva el índice y no recarga', async () => {
    const catalogo = await cargarModulo(catalogoChico(), 1)
    await catalogo.asegurarCarga()
    rpcMock.mockResolvedValue({ data: null, error: { code: '500', message: 'boom' } })
    vi.setSystemTime(Date.now() + 31_000)
    await catalogo.refrescarSiCambio()
    expect(catalogo.listo()).toBe(true)
    expect(cargasDeProducto()).toBe(1)
  })
})
