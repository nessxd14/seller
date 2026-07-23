import { describe, expect, it } from 'vitest'
import type { StockBalance } from '../inventory/entities'
import { releaseStock, reserveStock, stockDisponible, validateAllocations } from '../inventory/stockService'

const balance = (locationId: string, physical: number): StockBalance => ({ productId: 'p1', locationId, stockFisico: physical, stockReservado: 0, stockEnTransito: 0, stockDanado: 0, updatedAt: '2026-07-22T00:00:00Z' })

describe('inventario', () => {
  it('deriva disponible, reserva y libera', () => {
    const reserved = reserveStock(balance('almacen', 20), 8)
    expect(stockDisponible(reserved)).toBe(12)
    expect(releaseStock(reserved, 3).stockReservado).toBe(5)
  })
  it('asigna una línea desde dos ubicaciones', () => {
    const result = validateAllocations(30, [{ id: 'a1', documentItemId: 'i1', locationId: 'almacen', quantity: 20 }, { id: 'a2', documentItemId: 'i1', locationId: 'tienda', quantity: 10 }], [balance('almacen', 20), balance('tienda', 10)])
    expect(result).toEqual({ allocated: 30, pending: 0, complete: true })
  })
  it('rechaza stock insuficiente y sobreasignación', () => {
    expect(() => reserveStock(balance('tienda', 2), 3)).toThrow('Stock insuficiente')
    expect(() => validateAllocations(5, [{ id: 'a1', documentItemId: 'i1', locationId: 'tienda', quantity: 6 }], [balance('tienda', 10)])).toThrow('exceden')
  })
})

