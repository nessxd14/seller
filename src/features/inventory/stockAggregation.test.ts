import { describe, expect, it } from 'vitest'
import { aggregateStockBySucursal } from './stockAggregation'

describe('aggregateStockBySucursal', () => {
  it('falls back to a single total when no row carries a sucursalId (mock mode)', () => {
    const result = aggregateStockBySucursal([
      { ubicacionId: 2, cantidadBase: 5 },
      { ubicacionId: 1, cantidadBase: 10 },
    ])
    expect(result.hasSucursalSplit).toBe(false)
    expect(result.total).toBe(15)
  })

  it('splits Tienda (sucursalId 2) and Almacén (sucursalId 1) when sucursalId is present (supabase mode)', () => {
    const result = aggregateStockBySucursal([
      { ubicacionId: 12, sucursalId: 2, cantidadBase: 4 },
      { ubicacionId: 13, sucursalId: 2, cantidadBase: 3 },
      { ubicacionId: 20, sucursalId: 1, cantidadBase: 7 },
    ])
    expect(result.hasSucursalSplit).toBe(true)
    expect(result.tienda).toBe(7)
    expect(result.almacen).toBe(7)
    expect(result.total).toBe(14)
  })

  it('excludes virtual locations (excluyeDisponible) from the almacen/tienda split but keeps them in total', () => {
    const result = aggregateStockBySucursal([
      { ubicacionId: 22, sucursalId: 1, cantidadBase: 5016 },
      { ubicacionId: 27, sucursalId: 2, cantidadBase: 40 },
      { ubicacionId: 31, sucursalId: 1, cantidadBase: -110, excluyeDisponible: true },
    ])
    expect(result.almacen).toBe(5016)
    expect(result.tienda).toBe(40)
    expect(result.total).toBe(4946)
  })

  it('returns zeroed totals for an empty onHand list', () => {
    const result = aggregateStockBySucursal([])
    expect(result).toEqual({ hasSucursalSplit: false, tienda: 0, almacen: 0, total: 0 })
  })
})
