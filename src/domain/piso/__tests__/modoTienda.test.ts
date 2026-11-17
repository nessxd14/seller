// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { activarModoTienda, claveModoTienda, desactivarModoTienda, leerModoTienda, veBandaModoTienda } from '../modoTienda'

afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

describe('bandera de modo tienda', () => {
  it('se activa y se limpia por usuario', () => {
    expect(leerModoTienda('u1')).toBe(false)
    activarModoTienda('u1')
    expect(localStorage.getItem('seller:modo-tienda:u1')).toBe('1')
    expect(claveModoTienda('u1')).toBe('seller:modo-tienda:u1')
    expect(leerModoTienda('u1')).toBe(true)
    expect(leerModoTienda('u2')).toBe(false)
    desactivarModoTienda('u1')
    expect(leerModoTienda('u1')).toBe(false)
  })

  it('sin almacenamiento no revienta', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('bloqueado') })
    expect(leerModoTienda('u1')).toBe(false)
    expect(() => activarModoTienda('u1')).not.toThrow()
    expect(() => desactivarModoTienda('u1')).not.toThrow()
  })

  it('la banda es para todos menos reponedor y vendedor', () => {
    for (const rol of ['admin', 'gerente', 'cajero', 'vendedor_mayoreo'] as const) expect(veBandaModoTienda(rol)).toBe(true)
    for (const rol of ['reponedor', 'vendedor'] as const) expect(veBandaModoTienda(rol)).toBe(false)
  })
})
