import { describe, expect, it } from 'vitest'
import { excedenteReparto, sumaAplicaciones, validarReparto } from '../repartoPago'

const fila = (partidaId: number, referencia: string, pendiente: number, aplica: number) => ({ partidaId, referencia, pendiente, aplica })

describe('sumaAplicaciones', () => {
  it('suma el aplica de todas las filas', () => {
    expect(sumaAplicaciones([fila(1, 'PED-1', 100, 40), fila(2, 'PED-2', 200, 60)])).toBe(100)
  })
  it('vacío es cero', () => {
    expect(sumaAplicaciones([])).toBe(0)
  })
})

describe('excedenteReparto', () => {
  it('monto menos la suma aplicada, nunca negativo', () => {
    expect(excedenteReparto(150, [fila(1, 'PED-1', 100, 100)])).toBe(50)
    expect(excedenteReparto(80, [fila(1, 'PED-1', 100, 100)])).toBe(0)
  })
})

describe('validarReparto', () => {
  it('reparto válido: sin error', () => {
    expect(validarReparto(100, [fila(1, 'PED-1', 100, 60), fila(2, 'PED-2', 100, 40)])).toBeNull()
  })

  it('una fila supera su pendiente: error legible con la referencia', () => {
    const error = validarReparto(100, [fila(1, 'PED-2026-00219', 50, 60)])
    expect(error).toContain('PED-2026-00219')
    expect(error).toContain('50.00')
  })

  it('la suma supera el monto del pago: error legible', () => {
    const error = validarReparto(100, [fila(1, 'PED-1', 200, 60), fila(2, 'PED-2', 200, 60)])
    expect(error).toContain('120.00')
    expect(error).toContain('100.00')
  })

  it('excedente (suma menor al monto) es válido, no es un error', () => {
    expect(validarReparto(100, [fila(1, 'PED-1', 50, 30)])).toBeNull()
  })

  it('monto negativo en una fila: error', () => {
    expect(validarReparto(100, [fila(1, 'PED-1', 50, -10)])).toContain('PED-1')
  })

  it('tolera diferencias de punto flotante por debajo del centavo', () => {
    expect(validarReparto(0.3, [fila(1, 'PED-1', 1, 0.1 + 0.2)])).toBeNull()
  })
})
