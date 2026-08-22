import { describe, expect, it } from 'vitest'
import { money } from '../common/money'
import { resolveMockChannelPrice, resolvePrice } from '../pricing/priceResolver'
import { calculateCartTotals } from '../sales/cartCalculator'
import { isLineUnderstocked } from '../sales/stockCheck'

describe('precios y carrito', () => {
  it('cambia precio por canal', () => {
    const prices = { retailCents: 1850, wholesaleCents: 1620, institutionalCents: 1580, corporativoCents: 1580 }
    expect(resolveMockChannelPrice('retail', prices).cents).toBe(1850)
    expect(resolveMockChannelPrice('mayoreo', prices).cents).toBe(1620)
    expect(resolveMockChannelPrice('institucional', prices).cents).toBe(1580)
  })
  it('prioriza precio especial del cliente', () => {
    const result = resolvePrice({ productId: 'p1', channel: 'mayoreo', customerId: 'c1', at: '2026-07-22T12:00:00Z', quantity: 10 }, [{ id: 'l1', name: 'Mayoreo', channel: 'mayoreo', validFrom: '2026-01-01', active: true }], [{ id: 'pp1', priceListId: 'l1', productId: 'p1', price: money(1600) }], [{ id: 'sp1', customerId: 'c1', productId: 'p1', price: money(1500), validFrom: '2026-01-01' }])
    expect(result.suggestedPrice.cents).toBe(1500)
    expect(result.source).toBe('customer_special')
  })
  it('calcula descuentos y totales a dos decimales', () => {
    const totals = calculateCartTotals([{ unitPrice: 18.5, quantity: 3, discountPercent: 10 }], 2.5)
    expect(totals.subtotal.cents).toBe(4995)
    expect(totals.total.cents).toBe(4745)
  })
  it('rechaza cantidades inválidas', () => expect(() => calculateCartTotals([{ unitPrice: 10, quantity: 0, discountPercent: 0 }], 0)).toThrow())
})

describe('isLineUnderstocked — multiplica por factorUnidadBase antes de comparar', () => {
  const stock = { tienda: 40, almacen: 100 }
  it('factorUnidadBase 1 (sin presentación): compara cantidad cruda', () => {
    expect(isLineUnderstocked({ cantidad: 40, ubicacion: 'Tienda' }, stock)).toBe(false)
    expect(isLineUnderstocked({ cantidad: 41, ubicacion: 'Tienda' }, stock)).toBe(true)
  })
  it('factorUnidadBase 12 en Tienda: 3 × Caja(12) = 36 uds. base, hay 40 → alcanza', () => {
    expect(isLineUnderstocked({ cantidad: 3, ubicacion: 'Tienda', factorUnidadBase: 12 }, stock)).toBe(false)
  })
  it('factorUnidadBase 24 en Tienda: 3 × Caja(24) = 72 uds. base, hay 40 → no alcanza', () => {
    expect(isLineUnderstocked({ cantidad: 3, ubicacion: 'Tienda', factorUnidadBase: 24 }, stock)).toBe(true)
  })
  it('factorUnidadBase 24 en Almacén: 3 × Caja(24) = 72 uds. base, hay 100 → alcanza', () => {
    expect(isLineUnderstocked({ cantidad: 3, ubicacion: 'Almacén', factorUnidadBase: 24 }, stock)).toBe(false)
  })
  it('borde exacto: disponible === cantidadBase no está understocked', () => {
    expect(isLineUnderstocked({ cantidad: 2, ubicacion: 'Tienda', factorUnidadBase: 20 }, stock)).toBe(false)
  })
  it('sin stock cargado para el producto (originStock undefined): nunca bloquea', () => {
    expect(isLineUnderstocked({ cantidad: 999, ubicacion: 'Tienda', factorUnidadBase: 24 }, undefined)).toBe(false)
  })
})

