import { describe, expect, it } from 'vitest'
import { intentoAQuery, queryAIntento } from './intento'

describe('intento de edición (atajos de los avisos)', () => {
  it('ida y vuelta por la URL', () => {
    for (const intento of [
      { tipo: 'precio_propio', itemId: 901, lineaId: 4765 },
      { tipo: 'precio_propio', itemId: 901, lineaId: null },
      { tipo: 'a_compra', itemId: 904 },
      { tipo: 'reemplazar', itemId: 904 },
    ] as const) {
      expect(queryAIntento(intentoAQuery(intento))).toEqual(intento)
    }
  })
  it('ignora lo que no es un atajo válido', () => {
    expect(queryAIntento('')).toBeNull()
    expect(queryAIntento('?intento=raro&item=1')).toBeNull()
    expect(queryAIntento('?intento=a_compra')).toBeNull()
  })
})
