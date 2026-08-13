import { describe, expect, it } from 'vitest'
import { matchesNumero } from '../matchesNumero'

describe('matchesNumero — búsqueda por número en las grillas', () => {
  it('encuentra por número completo', () => {
    expect(matchesNumero('PED-2026-00275', 'PED-2026-00275')).toBe(true)
  })

  it('encuentra por sufijo suelto sin ceros a la izquierda', () => {
    expect(matchesNumero('PED-2026-00275', '275')).toBe(true)
  })

  it('encuentra por sufijo suelto con ceros a la izquierda', () => {
    expect(matchesNumero('PED-2026-00275', '00275')).toBe(true)
  })

  it('no distingue mayúsculas para el número completo', () => {
    expect(matchesNumero('COT-2026-00040', 'cot-2026-00040')).toBe(true)
  })

  it('no matchea un sufijo numérico distinto', () => {
    expect(matchesNumero('PED-2026-00275', '276')).toBe(false)
  })

  it('término vacío matchea todo', () => {
    expect(matchesNumero('PED-2026-00275', '')).toBe(true)
    expect(matchesNumero('PED-2026-00275', '   ')).toBe(true)
  })

  it('término no numérico sin match no encuentra', () => {
    expect(matchesNumero('PED-2026-00275', 'TRA')).toBe(false)
  })
})
