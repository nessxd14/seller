import { describe, expect, it } from 'vitest'
import { denominacionesTotal } from '../DenominationCount'

describe('denominacionesTotal — Brief Caja-1 A5', () => {
  it('suma billetes y monedas, incluida la moneda de 0.5', () => {
    expect(denominacionesTotal({ '200': 1, '100': 2, '0.5': 3 })).toBeCloseTo(200 + 200 + 1.5, 5)
  })

  it('ignora denominaciones ausentes (tratadas como 0)', () => {
    expect(denominacionesTotal({})).toBe(0)
  })

  it('cada denominación válida se multiplica por su cantidad', () => {
    const denominaciones = { '200': 3, '100': 5, '50': 0, '20': 1, '10': 2, '5': 4, '2': 0, '1': 6, '0.5': 4 }
    expect(denominacionesTotal(denominaciones)).toBeCloseTo(600 + 500 + 0 + 20 + 20 + 20 + 0 + 6 + 2, 5)
  })
})
