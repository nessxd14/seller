import { describe, expect, it } from 'vitest'
import { secretoValido } from '../secreto'

describe('secretoValido', () => {
  it('acepta un secreto idéntico', () => { expect(secretoValido('abc123', 'abc123')).toBe(true) })
  it('rechaza un secreto distinto del mismo largo', () => { expect(secretoValido('abc124', 'abc123')).toBe(false) })
  it('rechaza un secreto de otro largo sin lanzar', () => {
    expect(secretoValido('abc', 'abc123')).toBe(false)
    expect(secretoValido('abc1234', 'abc123')).toBe(false)
  })
  it('usa el primer valor si el header llega como array', () => {
    expect(secretoValido(['abc123', 'otro'], 'abc123')).toBe(true)
    expect(secretoValido(['otro', 'abc123'], 'abc123')).toBe(false)
  })
  it('rechaza header vacío, ausente o array vacío', () => {
    expect(secretoValido('', 'abc123')).toBe(false)
    expect(secretoValido(undefined, 'abc123')).toBe(false)
    expect(secretoValido([], 'abc123')).toBe(false)
  })
})
