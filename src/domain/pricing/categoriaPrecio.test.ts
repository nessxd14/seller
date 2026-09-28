import { describe, expect, it } from 'vitest'
import { categoriaColor, categoriaLabel, categoriaToListaKey } from './categoriaPrecio'

describe('categoriaToListaKey', () => {
  it('mapea cada categoría de pedido/cotización a su lista', () => {
    expect(categoriaToListaKey('MAYOR')).toBe('mayoreo')
    expect(categoriaToListaKey('INSTITUCIONAL')).toBe('institucional')
    expect(categoriaToListaKey('CORPORATIVO')).toBe('corporativo')
    expect(categoriaToListaKey('MUNICIPAL')).toBe('municipal')
  })
  it('mapea las categorías de mostrador/venta a la lista retail', () => {
    expect(categoriaToListaKey('TIENDA')).toBe('retail')
    expect(categoriaToListaKey('MOSTRADOR')).toBe('retail')
    expect(categoriaToListaKey('VTD')).toBe('retail')
  })
  it('devuelve null para una categoría desconocida', () => {
    expect(categoriaToListaKey('OTRA')).toBeNull()
  })
})

describe('categoriaColor / categoriaLabel', () => {
  it('cada categoría conocida tiene un color y una etiqueta propios', () => {
    const categorias = ['MAYOR', 'TIENDA', 'INSTITUCIONAL', 'MUNICIPAL', 'CORPORATIVO', 'MOSTRADOR', 'VTD']
    const colors = new Set(categorias.map(categoriaColor))
    expect(colors.size).toBe(categorias.length - 1) // TIENDA y MOSTRADOR comparten color (mismo bucket retail)
    categorias.forEach((c) => expect(categoriaLabel(c)).not.toBe(c === 'MAYOR' ? '' : undefined))
  })
  it('cae a un color/etiqueta neutro para una categoría desconocida', () => {
    expect(categoriaColor('OTRA')).toBe('#64748b')
    expect(categoriaLabel('OTRA')).toBe('OTRA')
  })
})
