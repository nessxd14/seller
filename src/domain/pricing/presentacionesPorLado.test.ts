import { describe, expect, it } from 'vitest'
import { etiquetaDondeSeVende, presentacionesDelLado, presentacionInicial } from './presentacionesPorLado'

const p = (id: number, factorUnidadBase: number, extra: { vendeTienda?: boolean; vendeAlmacen?: boolean } = {}) => ({ id, esBase: factorUnidadBase === 1, factorUnidadBase, ...extra })

describe('presentacionesPorLado', () => {
  const hoja = p(1, 1), paquete = p(2, 10), caja = p(3, 240)

  it('sin banderas (undefined) todo se vende en ambos lados', () => {
    expect(presentacionesDelLado([hoja, paquete, caja], 'tienda')).toHaveLength(3)
    expect(presentacionesDelLado([hoja, paquete, caja], 'almacen')).toHaveLength(3)
  })

  it('filtra por lado', () => {
    const list = [hoja, p(2, 10, { vendeTienda: false }), p(3, 240, { vendeAlmacen: false })]
    expect(presentacionesDelLado(list, 'tienda').map((x) => x.id)).toEqual([1, 3])
    expect(presentacionesDelLado(list, 'almacen').map((x) => x.id)).toEqual([1, 2])
  })

  it('inicial: la base si está habilitada', () => {
    expect(presentacionInicial([caja, paquete, hoja], 'tienda')?.id).toBe(1)
  })

  it('inicial: base deshabilitada → la habilitada de menor factor', () => {
    expect(presentacionInicial([p(1, 1, { vendeTienda: false }), caja, paquete], 'tienda')?.id).toBe(2)
    expect(presentacionInicial([p(1, 1, { vendeTienda: false }), caja, paquete], 'almacen')?.id).toBe(1)
  })

  it('inicial: ninguna habilitada → undefined', () => {
    expect(presentacionInicial([p(1, 1, { vendeTienda: false }), p(2, 10, { vendeTienda: false })], 'tienda')).toBeUndefined()
    expect(presentacionInicial([], 'almacen')).toBeUndefined()
  })

  it('etiqueta', () => {
    expect(etiquetaDondeSeVende(hoja)).toBeNull()
    expect(etiquetaDondeSeVende(p(2, 10, { vendeAlmacen: false }))).toBe('Solo tienda')
    expect(etiquetaDondeSeVende(p(2, 10, { vendeTienda: false }))).toBe('Solo almacén')
    expect(etiquetaDondeSeVende(p(2, 10, { vendeTienda: false, vendeAlmacen: false }))).toBe('No se vende')
  })
})
