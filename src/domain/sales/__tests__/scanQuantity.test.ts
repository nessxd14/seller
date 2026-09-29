import { describe, expect, it } from 'vitest'
import { parseQuantityScan } from '../scanQuantity'

describe('parseQuantityScan — atajo N*código del buscador', () => {
  it('sin "*" agrega 1 unidad del texto tal cual', () => {
    expect(parseQuantityScan('7791234567890')).toEqual({ quantity: 1, code: '7791234567890' })
  })

  it('"N*código" válido extrae la cantidad y el código', () => {
    expect(parseQuantityScan('12*7791234567890')).toEqual({ quantity: 12, code: '7791234567890' })
  })

  it('"0*código" es inválido — la cantidad debe ser >= 1', () => {
    expect(parseQuantityScan('0*7791234567890')).toBeNull()
  })

  it('sin código después de "*" es inválido', () => {
    expect(parseQuantityScan('12*')).toBeNull()
  })

  it('prefijo no numérico es inválido', () => {
    expect(parseQuantityScan('ab*7791234567890')).toBeNull()
  })
})
