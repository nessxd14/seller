import { describe, expect, it } from 'vitest'
import { isLineBlocking, type StockControlInfo } from '../stockCheck'

const stock = (overrides: Partial<StockControlInfo> = {}): StockControlInfo => ({
  tienda: 0,
  almacen: 0,
  tiendaLibre: false,
  almacenLibre: false,
  reservado: 0,
  motivo: null,
  ...overrides,
})

describe('isLineBlocking — "falta stock" y "esto bloquea la venta" son preguntas distintas', () => {
  it('falta stock en Tienda, Tienda en control libre → no bloquea', () => {
    const line = { cantidad: 5, ubicacion: 'Tienda' as const }
    expect(isLineBlocking(line, stock({ tienda: 0, tiendaLibre: true }))).toBe(false)
  })

  it('falta stock en Tienda, Tienda en control estricto (producto ya inventariado) → bloquea', () => {
    const line = { cantidad: 5, ubicacion: 'Tienda' as const }
    expect(isLineBlocking(line, stock({ tienda: 0, tiendaLibre: false }))).toBe(true)
  })

  it('falta stock en Almacén, Almacén en control estricto → bloquea', () => {
    const line = { cantidad: 5, ubicacion: 'Almacén' as const }
    expect(isLineBlocking(line, stock({ almacen: 0, almacenLibre: false }))).toBe(true)
  })

  it('hay stock suficiente → nunca bloquea, sin importar el control de la sucursal', () => {
    const line = { cantidad: 5, ubicacion: 'Tienda' as const }
    expect(isLineBlocking(line, stock({ tienda: 5, tiendaLibre: false }))).toBe(false)
    expect(isLineBlocking(line, stock({ tienda: 5, tiendaLibre: true }))).toBe(false)
  })

  it('factorUnidadBase 24: la cantidad base se calcula antes de decidir (no repetir el bug de S2)', () => {
    // 3 × Caja(24) = 72 uds. base — hay 40 en Tienda: falta stock de verdad, no solo
    // si se comparara contra la cantidad cruda (3).
    const line = { cantidad: 3, ubicacion: 'Tienda' as const, factorUnidadBase: 24 }
    expect(isLineBlocking(line, stock({ tienda: 40, tiendaLibre: false }))).toBe(true)
    expect(isLineBlocking(line, stock({ tienda: 40, tiendaLibre: true }))).toBe(false)
    // Con 72 exactas alcanza — el borde no bloquea.
    expect(isLineBlocking(line, stock({ tienda: 72, tiendaLibre: false }))).toBe(false)
  })

  it('stock ausente → no bloquea (el backend es la autoridad final, no se bloquea por falta de datos)', () => {
    const line = { cantidad: 5, ubicacion: 'Tienda' as const }
    expect(isLineBlocking(line, undefined)).toBe(false)
  })
})

describe('isLineBlocking — brief S10: la reserva gana sobre el control libre', () => {
  it('100 físicas, 80 reservadas: vendible=20, pedís 5 → alcanza, no bloquea', () => {
    const line = { cantidad: 5, ubicacion: 'Tienda' as const }
    expect(isLineBlocking(line, stock({ tienda: 20, tiendaLibre: true, reservado: 80, motivo: 'Cotización #22' }))).toBe(false)
  })

  it('100 físicas, 80 reservadas: vendible=20, pedís 60 → no alcanza, bloquea aunque la sucursal esté LIBRE', () => {
    const line = { cantidad: 60, ubicacion: 'Tienda' as const }
    expect(isLineBlocking(line, stock({ tienda: 20, tiendaLibre: true, reservado: 80, motivo: 'Cotización #22' }))).toBe(true)
  })

  it('sin reserva (reservado=0), sucursal LIBRE, falta stock → sigue sin bloquear (comportamiento S9 intacto)', () => {
    const line = { cantidad: 5, ubicacion: 'Tienda' as const }
    expect(isLineBlocking(line, stock({ tienda: 0, tiendaLibre: true, reservado: 0 }))).toBe(false)
  })
})
