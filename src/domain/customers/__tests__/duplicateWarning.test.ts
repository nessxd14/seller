import { describe, expect, it } from 'vitest'
import { requiereConfirmacion, UMBRAL_CONFIRMACION } from '../duplicateWarning'

describe('requiereConfirmacion — umbral de similitud para pedir confirmación explícita', () => {
  it('sin candidatos: no requiere confirmación', () => {
    expect(requiereConfirmacion([])).toBe(false)
  })

  it('candidatos todos por debajo del umbral: no requiere confirmación', () => {
    expect(requiereConfirmacion([{ similitud: 0.35 }, { similitud: 0.59 }])).toBe(false)
  })

  it('un candidato en el umbral exacto: sí requiere confirmación', () => {
    expect(requiereConfirmacion([{ similitud: UMBRAL_CONFIRMACION }])).toBe(true)
  })

  it('un candidato por encima del umbral entre varios: sí requiere confirmación', () => {
    expect(requiereConfirmacion([{ similitud: 0.2 }, { similitud: 0.85 }])).toBe(true)
  })

  it('coincidencia por DOCUMENTO (similitud 1, certeza): sí requiere confirmación', () => {
    expect(requiereConfirmacion([{ similitud: 1 }])).toBe(true)
  })
})
