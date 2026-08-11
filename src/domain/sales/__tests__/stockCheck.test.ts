import { describe, expect, it } from 'vitest'
import { isLineBlocking, type StockControlInfo } from '../stockCheck'

// Por default vendible = físico y reservado = 0 (sin reserva de por medio), para que los
// tests de S9 (control por sucursal, sin reserva) sigan expresando exactamente lo mismo
// que antes de S10 — que compara contra vendible en vez de físico.
const stock = (overrides: Partial<StockControlInfo> = {}): StockControlInfo => {
  const tienda = overrides.tienda ?? 0
  const almacen = overrides.almacen ?? 0
  return {
    tienda,
    almacen,
    tiendaLibre: false,
    almacenLibre: false,
    tiendaVendible: tienda,
    almacenVendible: almacen,
    tiendaReservado: 0,
    almacenReservado: 0,
    tiendaMotivo: null,
    almacenMotivo: null,
    ...overrides,
  }
}

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

describe('isLineBlocking — S10: la reserva gana sobre el control libre de W3', () => {
  it('100 físicas, 80 reservadas → vendible 20; pedir más de 20 bloquea', () => {
    const line = { cantidad: 30, ubicacion: 'Tienda' as const }
    const s = stock({ tienda: 100, tiendaVendible: 20, tiendaReservado: 80, tiendaMotivo: 'Cotización #22', tiendaLibre: true })
    expect(isLineBlocking(line, s)).toBe(true)
  })

  it('pedir hasta lo vendible (20) no bloquea', () => {
    const line = { cantidad: 20, ubicacion: 'Tienda' as const }
    const s = stock({ tienda: 100, tiendaVendible: 20, tiendaReservado: 80, tiendaMotivo: 'Cotización #22', tiendaLibre: true })
    expect(isLineBlocking(line, s)).toBe(false)
  })

  it('en Tienda LIBRE, un producto CON reserva no se puede vender por encima de lo vendible, aunque el control libre lo permitiría', () => {
    const line = { cantidad: 5, ubicacion: 'Tienda' as const }
    const s = stock({ tienda: 3, tiendaVendible: 0, tiendaReservado: 3, tiendaMotivo: 'Pedido #10', tiendaLibre: true })
    expect(isLineBlocking(line, s)).toBe(true)
  })

  it('sin ninguna reserva de por medio (reservado 0), el control libre sigue salvando el faltante', () => {
    const line = { cantidad: 5, ubicacion: 'Tienda' as const }
    const s = stock({ tienda: 0, tiendaVendible: 0, tiendaReservado: 0, tiendaLibre: true })
    expect(isLineBlocking(line, s)).toBe(false)
  })
})
