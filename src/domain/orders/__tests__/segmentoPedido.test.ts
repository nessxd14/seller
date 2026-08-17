import { describe, expect, it } from 'vitest'
import { categoriasDeSegmento, SEGMENTOS_PEDIDO, type CategoriaPedido } from '../segmentoPedido'

const TODAS_LAS_CATEGORIAS: CategoriaPedido[] = ['MAYOR', 'TIENDA', 'INSTITUCIONAL', 'MUNICIPAL']

describe('SEGMENTOS_PEDIDO', () => {
  it('retail es exactamente TIENDA', () => {
    expect(SEGMENTOS_PEDIDO.retail).toEqual(['TIENDA'])
  })

  it('wholesale es exactamente MAYOR, INSTITUCIONAL, MUNICIPAL', () => {
    expect(SEGMENTOS_PEDIDO.wholesale).toEqual(['MAYOR', 'INSTITUCIONAL', 'MUNICIPAL'])
  })

  it('retail y wholesale no se solapan y suman las cuatro categorías', () => {
    const union = [...SEGMENTOS_PEDIDO.retail, ...SEGMENTOS_PEDIDO.wholesale]
    expect(new Set(union).size).toBe(union.length) // sin duplicados entre segmentos
    expect(union.sort()).toEqual([...TODAS_LAS_CATEGORIAS].sort())
  })
})

describe('categoriasDeSegmento', () => {
  it('retail -> TIENDA', () => {
    expect(categoriasDeSegmento('retail')).toEqual(['TIENDA'])
  })

  it('wholesale -> MAYOR/INSTITUCIONAL/MUNICIPAL', () => {
    expect(categoriasDeSegmento('wholesale')).toEqual(['MAYOR', 'INSTITUCIONAL', 'MUNICIPAL'])
  })

  it('todos -> undefined (sin filtro)', () => {
    expect(categoriasDeSegmento('todos')).toBeUndefined()
  })
})
