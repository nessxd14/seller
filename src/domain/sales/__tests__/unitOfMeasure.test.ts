import { describe, expect, it } from 'vitest'
import { formatQtyWithUnit, normalizeUnit } from '../unitOfMeasure'

describe('normalizeUnit', () => {
  it('recorta y pasa a mayúsculas', () => { expect(normalizeUnit(' metro ')).toBe('METRO') })
  it('colapsa espacios internos', () => { expect(normalizeUnit('caja   x  12')).toBe('CAJA X 12') })
  it('vacío o indefinido → UNIDAD', () => { expect(normalizeUnit('')).toBe('UNIDAD'); expect(normalizeUnit('   ')).toBe('UNIDAD'); expect(normalizeUnit(undefined)).toBe('UNIDAD') })
  it('trunca a 30 caracteres', () => { expect(normalizeUnit('a'.repeat(40))).toBe('A'.repeat(30)) })
})

describe('formatQtyWithUnit', () => {
  it('cantidad con unidad', () => { expect(formatQtyWithUnit(3, 'METRO')).toBe('3 METRO') })
  it('sin unidad (fila histórica) muestra solo la cantidad', () => {
    expect(formatQtyWithUnit(3, null)).toBe('3'); expect(formatQtyWithUnit(3, undefined)).toBe('3'); expect(formatQtyWithUnit(3, '  ')).toBe('3')
  })
})
