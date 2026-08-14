import { describe, expect, it } from 'vitest'
import { requiereCotizacionOrigen } from '../requiereCotizacionOrigen'

describe('requiereCotizacionOrigen', () => {
  it('wholesale, institutional y corporate la requieren', () => {
    expect(requiereCotizacionOrigen('wholesale')).toBe(true)
    expect(requiereCotizacionOrigen('institutional')).toBe(true)
    expect(requiereCotizacionOrigen('corporate')).toBe(true)
  })

  it('retail no la requiere', () => {
    expect(requiereCotizacionOrigen('retail')).toBe(false)
  })

  it('sin cliente (pedido interno) no la requiere', () => {
    expect(requiereCotizacionOrigen(undefined)).toBe(false)
  })
})
