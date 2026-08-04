import { describe, expect, it } from 'vitest'
import { checkoutFingerprint, type CheckoutFingerprintInput } from '../checkoutFingerprint'

const baseInput: CheckoutFingerprintInput = {
  lines: [
    { productId: '1', quantity: 2, unitPriceCents: 1000 },
    { productId: '2', quantity: 1, unitPriceCents: 500, presentacionId: 7, sourceLocation: 'Tienda' },
  ],
  discountCents: 100,
  customerId: 'c1',
  cashSessionId: 's1',
}

describe('checkoutFingerprint', () => {
  it('es determinística para la misma entrada', () => {
    expect(checkoutFingerprint(baseInput)).toBe(checkoutFingerprint({ ...baseInput, lines: [...baseInput.lines] }))
  })

  it('no cambia si se reordenan las líneas', () => {
    const reordered = { ...baseInput, lines: [...baseInput.lines].reverse() }
    expect(checkoutFingerprint(reordered)).toBe(checkoutFingerprint(baseInput))
  })

  it('cambia si cambia la cantidad de una línea', () => {
    const changed: CheckoutFingerprintInput = { ...baseInput, lines: [{ ...baseInput.lines[0], quantity: 3 }, baseInput.lines[1]] }
    expect(checkoutFingerprint(changed)).not.toBe(checkoutFingerprint(baseInput))
  })

  it('cambia si cambia unitPriceCents', () => {
    const changed: CheckoutFingerprintInput = { ...baseInput, lines: [{ ...baseInput.lines[0], unitPriceCents: 1200 }, baseInput.lines[1]] }
    expect(checkoutFingerprint(changed)).not.toBe(checkoutFingerprint(baseInput))
  })

  it('cambia si cambia presentacionId', () => {
    const changed: CheckoutFingerprintInput = { ...baseInput, lines: [baseInput.lines[0], { ...baseInput.lines[1], presentacionId: 9 }] }
    expect(checkoutFingerprint(changed)).not.toBe(checkoutFingerprint(baseInput))
  })

  it('cambia si cambia discountCents', () => {
    expect(checkoutFingerprint({ ...baseInput, discountCents: 200 })).not.toBe(checkoutFingerprint(baseInput))
  })

  it('cambia si cambia customerId', () => {
    expect(checkoutFingerprint({ ...baseInput, customerId: 'c2' })).not.toBe(checkoutFingerprint(baseInput))
  })

  it('cambia si cambia cashSessionId', () => {
    expect(checkoutFingerprint({ ...baseInput, cashSessionId: 's2' })).not.toBe(checkoutFingerprint(baseInput))
  })

  it('cambia si se agrega una línea', () => {
    const changed: CheckoutFingerprintInput = { ...baseInput, lines: [...baseInput.lines, { productId: '3', quantity: 1, unitPriceCents: 300 }] }
    expect(checkoutFingerprint(changed)).not.toBe(checkoutFingerprint(baseInput))
  })
})
