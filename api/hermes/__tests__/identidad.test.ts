import { describe, expect, it } from 'vitest'
import { usuarioAuditoria } from '../_identidad'

const sesion = { email: 'caja@cation.test', userId: 'uid-1' }

describe('usuarioAuditoria', () => {
  it('usa la sesión cuando no hay usuarioPos', () => {
    expect(usuarioAuditoria(sesion, undefined)).toBe('caja@cation.test')
    expect(usuarioAuditoria(sesion, '   ')).toBe('caja@cation.test')
    expect(usuarioAuditoria(sesion, { x: 1 })).toBe('caja@cation.test')
  })
  it('cae al userId si la sesión no tiene email', () => {
    expect(usuarioAuditoria({ email: null, userId: 'uid-1' }, undefined)).toBe('uid-1')
  })
  it('no duplica si usuarioPos coincide con la sesión', () => {
    expect(usuarioAuditoria(sesion, ' caja@cation.test ')).toBe('caja@cation.test')
  })
  it('compone sesión + origen cuando difieren', () => {
    expect(usuarioAuditoria(sesion, ' ana@cation.test ')).toBe('caja@cation.test (origen: ana@cation.test)')
  })
  it('limita el origen a 120 caracteres', () => {
    const out = usuarioAuditoria(sesion, 'x'.repeat(500))
    expect(out).toBe(`caja@cation.test (origen: ${'x'.repeat(120)})`)
  })
})
