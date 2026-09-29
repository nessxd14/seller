import { describe, expect, it } from 'vitest'
import { resolveActiveLineId } from '../activeLine'

describe('resolveActiveLineId', () => {
  it('devuelve la línea seleccionada si está en el carrito', () => {
    expect(resolveActiveLineId([1, 2, 3], 2, { fallbackToLast: true })).toBe(2)
    expect(resolveActiveLineId([1, 2, 3], 2, { fallbackToLast: false })).toBe(2)
  })
  it('con selección obsoleta cae a la última si se permite', () => {
    expect(resolveActiveLineId([1, 2, 3], 9, { fallbackToLast: true })).toBe(3)
    expect(resolveActiveLineId([1, 2, 3], 9, { fallbackToLast: false })).toBeNull()
  })
  it('sin selección usa la última solo con fallbackToLast', () => {
    expect(resolveActiveLineId([1, 2, 3], null, { fallbackToLast: true })).toBe(3)
    expect(resolveActiveLineId([1, 2, 3], null, { fallbackToLast: false })).toBeNull()
  })
  it('carrito vacío devuelve null', () => {
    expect(resolveActiveLineId([], null, { fallbackToLast: true })).toBeNull()
    expect(resolveActiveLineId([], 1, { fallbackToLast: true })).toBeNull()
  })
})
