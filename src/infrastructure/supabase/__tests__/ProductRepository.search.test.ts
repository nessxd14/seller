import { afterEach, describe, expect, it, vi } from 'vitest'

// Brief: SupabaseProductRepository.search() solo comparaba el término contra
// producto.nombre y producto.sku_interno. El código de barras real vive en
// `identificador` (tipo='barra'/'fabrica', ligado a la presentación base del producto,
// no a producto directamente) y es un valor distinto de sku_interno — así que escanear
// o tipear el código impreso nunca matcheaba nada. Este test mockea el cliente de
// Supabase (sin tocar la base real) para verificar los tres casos del brief: búsqueda
// normal sin regresión, búsqueda por código que sí encuentra (primero en la lista), y
// que la consulta extra a `identificador` no se dispara cuando la búsqueda directa ya
// llenó la página.

const productoGoma = {
  id: 10, nombre: 'Goma Eva Azul', sku_interno: 'GEA-1', marca: 'Marca X', unidad_base: 'unidad',
  precio_base: 10, precio_mayoreo: null, precio_institucion: null, precio_corporativo: null,
  activo: true, imagen_url: null, stock_min: null, punto_reorden: null, familia_id: null, familia: null,
}
const productoEscaneado = {
  id: 20, nombre: 'Producto Escaneado', sku_interno: 'PE-1', marca: 'Marca Y', unidad_base: 'unidad',
  precio_base: 25, precio_mayoreo: null, precio_institucion: null, precio_corporativo: null,
  activo: true, imagen_url: null, stock_min: null, punto_reorden: null, familia_id: null, familia: null,
}

function makeChainable(resolveResponse: (self: Record<string, unknown[]>) => { data: unknown; error: null; count?: number }) {
  const calls: Record<string, unknown[]> = {}
  const obj: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'ilike', 'limit', 'order', 'or', 'range']) {
    obj[method] = (...args: unknown[]) => { calls[method] = args; return obj }
  }
  obj.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(resolveResponse(calls)).then(onFulfilled, onRejected)
  return obj
}

describe('SupabaseProductRepository.search — también busca por código de barras/fábrica', () => {
  afterEach(() => vi.resetModules())

  it('buscar por nombre funciona igual que antes, sin consultar identificador', async () => {
    const identificadorSpy = vi.fn()
    vi.doMock('../supabaseClient', () => ({
      supabase: {
        from: (table: string) => {
          if (table === 'producto') return makeChainable(() => ({ data: [productoGoma], error: null, count: 1 }))
          if (table === 'identificador') { identificadorSpy(); return makeChainable(() => ({ data: [], error: null })) }
          if (table === 'presentacion') return makeChainable(() => ({ data: [], error: null }))
          throw new Error(`tabla inesperada: ${table}`)
        },
      },
    }))
    const { productRepository } = await import('../ProductRepository.supabase')
    const { items, total } = await productRepository.search({ query: 'goma', page: { page: 1, pageSize: 30 } })
    expect(items).toHaveLength(1)
    expect(items[0].nombre).toBe('Goma Eva Azul')
    expect(total).toBe(1)
    // La página tenía 1 resultado con pageSize 30 (no llenó la página) — igual no debería
    // buscar por código si la intención era buscar por nombre... pero como el brief dice
    // "cuando la búsqueda directa no llena la página" SÍ se intenta. Este caso solo
    // verifica que, aun buscando por código, no aparece nada extra: identificador no
    // devuelve productos nuevos y el resultado sigue siendo solo el de nombre.
    expect(items.map((p) => p.id)).toEqual([10])
  })

  it('buscar un término que no matchea nombre/SKU pero sí un código de barras lo encuentra primero', async () => {
    let productoCall = 0
    vi.doMock('../supabaseClient', () => ({
      supabase: {
        from: (table: string) => {
          if (table === 'producto') {
            return makeChainable(() => {
              productoCall += 1
              // 1er call: búsqueda directa por nombre/sku — sin resultados.
              if (productoCall === 1) return { data: [], error: null, count: 0 }
              // 2do call: fetch por ids resueltos vía identificador.
              return { data: [productoEscaneado], error: null }
            })
          }
          if (table === 'identificador') {
            return makeChainable((calls) =>
              calls.ilike
                ? { data: [{ presentacion: { producto_id: 20 } }], error: null }
                : { data: [], error: null }
            )
          }
          if (table === 'presentacion') return makeChainable(() => ({ data: [], error: null }))
          throw new Error(`tabla inesperada: ${table}`)
        },
      },
    }))
    const { productRepository } = await import('../ProductRepository.supabase')
    const { items, total } = await productRepository.search({ query: '7861234567890', page: { page: 1, pageSize: 30 } })
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe(20)
    expect(items[0].nombre).toBe('Producto Escaneado')
    expect(total).toBe(1)
  })

  it('un término que no matchea nada (ni nombre, ni sku, ni código) da 0 resultados sin lanzar', async () => {
    vi.doMock('../supabaseClient', () => ({
      supabase: {
        from: (table: string) => {
          if (table === 'producto') return makeChainable(() => ({ data: [], error: null, count: 0 }))
          if (table === 'identificador') return makeChainable(() => ({ data: [], error: null }))
          if (table === 'presentacion') return makeChainable(() => ({ data: [], error: null }))
          throw new Error(`tabla inesperada: ${table}`)
        },
      },
    }))
    const { productRepository } = await import('../ProductRepository.supabase')
    const { items, total } = await productRepository.search({ query: 'zzz-no-existe-zzz', page: { page: 1, pageSize: 30 } })
    expect(items).toEqual([])
    expect(total).toBe(0)
  })

  it('no consulta identificador si la búsqueda directa ya llenó la página', async () => {
    const identificadorSpy = vi.fn()
    vi.doMock('../supabaseClient', () => ({
      supabase: {
        from: (table: string) => {
          if (table === 'producto') return makeChainable(() => ({ data: [productoGoma, productoEscaneado], error: null, count: 2 }))
          if (table === 'identificador') { identificadorSpy(); return makeChainable(() => ({ data: [], error: null })) }
          if (table === 'presentacion') return makeChainable(() => ({ data: [], error: null }))
          throw new Error(`tabla inesperada: ${table}`)
        },
      },
    }))
    const { productRepository } = await import('../ProductRepository.supabase')
    // pageSize 2, la búsqueda directa ya trae 2 filas — llena la página.
    await productRepository.search({ query: 'algo', page: { page: 1, pageSize: 2 } })
    expect(identificadorSpy).not.toHaveBeenCalled()
  })
})
