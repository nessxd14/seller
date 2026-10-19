import { describe, expect, it } from 'vitest'
import { esPrecioBajo, nombreUnidadBase, precioSugerido, textoEquivalencia, textoPrecioBajo, type PresentacionConPrecio } from './precioPresentacion'

const paquete = (precios?: PresentacionConPrecio['precios']): PresentacionConPrecio => ({ nombre: 'PAQUETE', esBase: false, factorUnidadBase: 500, precios })
const todos = (retail: number | null) => ({ retail, mayoreo: retail, institucional: retail, corporativo: retail })

describe('precioSugerido', () => {
  it('usa el precio propio/resuelto de la presentación para el canal', () => {
    expect(precioSugerido(paquete({ ...todos(36), mayoreo: 30 }), 'mayoreo', 0.072)).toBe(30)
  })

  it('cae a precio base × factor solo si el resuelto es null', () => {
    expect(precioSugerido(paquete(todos(null)), 'retail', 0.072)).toBe(36)
    expect(precioSugerido(paquete(undefined), 'retail', 0.072)).toBe(36)
  })

  it('un resuelto de 0 es un precio resuelto, no un hueco', () => {
    expect(precioSugerido(paquete(todos(0)), 'retail', 0.072)).toBe(0)
  })

  it('devuelve null sin precio resuelto ni precio base', () => {
    expect(precioSugerido(paquete(todos(null)), 'retail', null)).toBeNull()
    expect(precioSugerido(paquete(undefined), 'retail', undefined)).toBeNull()
  })

  it('sin presentación (unidad base) devuelve el precio base', () => {
    expect(precioSugerido(undefined, 'retail', 5)).toBe(5)
  })

  it('redondea a 2 decimales', () => {
    expect(precioSugerido(paquete(todos(32.456)), 'retail', null)).toBe(32.46)
  })
})

describe('esPrecioBajo', () => {
  it('es bajo solo por debajo del 50 % del sugerido', () => {
    expect(esPrecioBajo(5, 36)).toBe(true)
    expect(esPrecioBajo(17.99, 36)).toBe(true)
    expect(esPrecioBajo(18, 36)).toBe(false)
    expect(esPrecioBajo(36, 36)).toBe(false)
  })

  it('no avisa sin sugerido', () => {
    expect(esPrecioBajo(1, null)).toBe(false)
    expect(esPrecioBajo(1, undefined)).toBe(false)
    expect(esPrecioBajo(1, 0)).toBe(false)
  })
})

describe('textos con el nombre de la unidad base', () => {
  it('nombreUnidadBase usa la presentación base y cae a "u"', () => {
    expect(nombreUnidadBase([{ nombre: 'Pieza', esBase: true }, { nombre: 'PAQUETE (50)', esBase: false }])).toBe('Pieza')
    expect(nombreUnidadBase([])).toBe('u')
    expect(nombreUnidadBase(undefined)).toBe('u')
  })

  it('equivalencia: 15 PAQUETE (50) = 750 Pieza', () => {
    expect(textoEquivalencia(15, 'PAQUETE (50)', 50, 'Pieza')).toBe('15 PAQUETE (50) = 750 Pieza')
    expect(textoEquivalencia(2, undefined, 12, 'u')).toBe('2 = 24 u')
  })

  it('aviso de precio bajo', () => {
    expect(textoPrecioBajo('PAQUETE', 500, 'Hoja', 32)).toBe('Precio muy bajo para 1 PAQUETE (500 Hoja): sugerido Bs 32,00')
    expect(textoPrecioBajo('PAQUETE (50)', 50, 'Pieza', 10)).toBe('Precio muy bajo para 1 PAQUETE (50): sugerido Bs 10,00')
    expect(textoPrecioBajo(undefined, 1, 'Hoja', 0.5)).toBe('Precio muy bajo para 1 Hoja: sugerido Bs 0,50')
  })
})
