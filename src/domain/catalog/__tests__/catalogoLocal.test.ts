import { describe, expect, it } from 'vitest'
import { buscarEnCatalogo, construirIndice, resolverCodigoLocal, type DatosCatalogo, type FilaIdentificador, type FilaPresentacionCatalogo } from '../catalogoLocal'
import type { ProductoRow } from '../mapeoProducto'

const producto = (id: number, nombre: string, extra: Partial<ProductoRow> = {}): ProductoRow => ({
  id, nombre, sku_interno: `SKU-${id}`, marca: null, unidad_base: 'unidad', precio_base: 10, precio_mayoreo: null,
  precio_institucion: null, precio_corporativo: null, activo: true, imagen_url: null, stock_min: null, punto_reorden: null,
  familia_id: null, familia: null, ...extra,
})
const presentacion = (presentacion_id: number, producto_id: number, extra: Partial<FilaPresentacionCatalogo> = {}): FilaPresentacionCatalogo => ({
  presentacion_id, producto_id, nombre: 'Unidad', factor_unidad_base: 1, es_base: true, activo: true,
  precio_retail: 10, precio_mayoreo: null, precio_institucion: null, precio_corporativo: null, tiene_precio_propio: false,
  vende_tienda: true, vende_almacen: true, ...extra,
})
const ident = (id: number, presentacion_id: number, valor: string, extra: Partial<FilaIdentificador> = {}): FilaIdentificador => ({
  id, presentacion_id, tipo: 'barra', valor, es_principal: false, ...extra,
})

const datos: DatosCatalogo = {
  productos: [
    producto(1, 'PAPEL BOND BRIO CARTA', { marca: 'Brio' }),
    producto(2, 'BOLÍGRAFO AZUL', { marca: 'Faber' }),
    producto(3, 'CUADERNO BOND', { sku_interno: 'CUA-3' }),
    producto(4, 'Goma Eva Azul'),
    producto(5, 'AZUL TINTA'),
  ],
  presentaciones: [
    presentacion(10, 1),
    presentacion(11, 1, { nombre: 'Caja', factor_unidad_base: 12, es_base: false }),
    presentacion(12, 1, { nombre: 'Vieja', factor_unidad_base: 6, es_base: false, activo: false }),
    presentacion(20, 2), presentacion(30, 3), presentacion(40, 4), presentacion(50, 5),
  ],
  identificadores: [
    ident(1, 10, '7790001'), ident(2, 10, '7790002', { es_principal: true }), ident(3, 10, 'FAB-1', { tipo: 'fabrica' }),
    ident(4, 11, '7791234'), ident(5, 12, '7799999'), ident(6, 11, 'EMP-1', { tipo: 'empaque' }),
    ident(7, 20, 'DUP'), ident(8, 30, 'DUP'), ident(9, 40, 'AZUL'),
  ],
}
const indice = construirIndice(datos)
const pagina = { page: 1, pageSize: 50 }

describe('construirIndice', () => {
  it('toma codigoBarra/codigoFabrica de la presentación base, es_principal primero', () => {
    const p = indice.productos.get(1)!
    expect(p.codigoBarra).toBe('7790002')
    expect(p.codigoFabrica).toBe('FAB-1')
    expect(p.sku).toBe('SKU-1')
  })

  it('lista presentaciones activas con la base primero', () => {
    expect(indice.presentaciones.get(1)!.map((p) => p.id)).toEqual([10, 11])
    expect(indice.presentaciones.get(1)![1].factorUnidadBase).toBe(12)
  })

  it('arma los identificadores de línea desde la base y la marca', () => {
    expect(indice.identificadoresLinea.get(1)).toEqual({ barra: '7790002', fabrica: 'FAB-1', marca: 'Brio' })
  })
})

describe('buscarEnCatalogo', () => {
  const nombres = (q: string) => buscarEnCatalogo(indice, q, pagina).items.map((p) => p.nombre)

  it('encuentra por varias palabras en cualquier orden', () => {
    expect(nombres('bond carta')).toEqual(['PAPEL BOND BRIO CARTA'])
    expect(nombres('carta bond')).toEqual(['PAPEL BOND BRIO CARTA'])
  })

  it('ignora acentos y mayúsculas', () => {
    expect(nombres('boligrafo')).toEqual(['BOLÍGRAFO AZUL'])
  })

  it('encuentra por el código de barras de una presentación que no es la base', () => {
    expect(nombres('7791234')).toEqual(['PAPEL BOND BRIO CARTA'])
    expect(nombres('7799999')).toEqual(['PAPEL BOND BRIO CARTA'])
  })

  it('busca también por marca', () => {
    expect(nombres('faber')).toEqual(['BOLÍGRAFO AZUL'])
  })

  it('pone primero el código o SKU exacto', () => {
    // "azul" es código exacto de Goma Eva Azul (identificador 9)
    expect(nombres('AZUL')[0]).toBe('Goma Eva Azul')
    expect(buscarEnCatalogo(indice, 'cua-3', pagina).items[0].id).toBe(3)
  })

  it('pone los nombres que empiezan con la búsqueda antes de los que solo la contienen', () => {
    // 'azul': Goma Eva Azul es código exacto, AZUL TINTA empieza con la búsqueda, BOLÍGRAFO AZUL solo la contiene
    expect(nombres('azul')).toEqual(['Goma Eva Azul', 'AZUL TINTA', 'BOLÍGRAFO AZUL'])
    // sin código exacto: el prefijo va antes aunque alfabéticamente quede después
    expect(nombres('tinta')).toEqual(['AZUL TINTA'])
  })

  it('pagina y devuelve el total completo; la búsqueda vacía lista todo por nombre', () => {
    const p1 = buscarEnCatalogo(indice, '', { page: 1, pageSize: 2 })
    const p3 = buscarEnCatalogo(indice, '', { page: 3, pageSize: 2 })
    expect(p1.total).toBe(5)
    expect(p1.items).toHaveLength(2)
    expect(p3.items).toHaveLength(1)
    expect(buscarEnCatalogo(indice, '', { page: 9, pageSize: 2 }).items).toEqual([])
  })

  it('devuelve copias: modificar un resultado no altera el índice', () => {
    const [primero] = buscarEnCatalogo(indice, 'bond carta', pagina).items
    primero.stockTienda = 99
    expect(indice.productos.get(1)!.stockTienda).toBe(0)
  })
})

describe('resolverCodigoLocal', () => {
  it('resuelve un código de presentación no base con su presentación', () => {
    expect(resolverCodigoLocal(indice, '7791234')).toEqual({ kind: 'found', productId: 1, presentation: { id: 11, nombre: 'Caja', factorUnidadBase: 12, esBase: false } })
  })

  it('una presentación inactiva sale de la lista pero su código sigue resolviendo', () => {
    expect(indice.presentaciones.get(1)!.some((p) => p.id === 12)).toBe(false)
    expect(resolverCodigoLocal(indice, '7799999')).toEqual({ kind: 'found', productId: 1, presentation: { id: 12, nombre: 'Vieja', factorUnidadBase: 6, esBase: false } })
  })

  it('un código en dos productos es ambiguo', () => {
    expect(resolverCodigoLocal(indice, 'DUP')).toEqual({ kind: 'ambiguous', productIds: [2, 3] })
  })

  it('limpia caracteres de control y compara exacto con mayúsculas', () => {
    expect(resolverCodigoLocal(indice, ' 7791234\r')).toMatchObject({ kind: 'found', productId: 1 })
    expect(resolverCodigoLocal(indice, 'fab-1')).toBeNull()
  })

  it('cae al SKU cuando no hay identificador, sin presentación', () => {
    expect(resolverCodigoLocal(indice, 'CUA-3')).toEqual({ kind: 'found', productId: 3 })
  })

  it('un código desconocido o una presentación fuera del mapa devuelve null', () => {
    expect(resolverCodigoLocal(indice, 'NO-EXISTE')).toBeNull()
    expect(resolverCodigoLocal(indice, '')).toBeNull()
    const sinMapa = construirIndice({ ...datos, presentaciones: datos.presentaciones.filter((p) => p.presentacion_id !== 11) })
    expect(resolverCodigoLocal(sinMapa, '7791234')).toBeNull()
  })

  it('el código de empaque también resuelve', () => {
    expect(resolverCodigoLocal(indice, 'EMP-1')).toMatchObject({ kind: 'found', productId: 1 })
  })
})
