import { describe, expect, it } from 'vitest'
import { buildLineasJsonb } from '../QuoteRepository.supabase'
import type { WorkflowLine } from '../../../application/shared/models'

const baseLine = (overrides: Partial<WorkflowLine> = {}): WorkflowLine => ({
  id: '1',
  productId: '42',
  name: 'Producto de catálogo',
  sku: 'SKU-1',
  quantity: 3,
  unitPriceCents: 10000,
  discountBasisPoints: 0,
  ...overrides,
})

describe('buildLineasJsonb — serialización carrito/cotización → payload de crear_cotizacion', () => {
  it('ítem personalizado: sin producto_id, con es_personalizado y descripción libre', () => {
    const lines: WorkflowLine[] = [
      baseLine({
        productId: '',
        name: 'Servicio de instalación',
        quantity: 1,
        unitPriceCents: 25000,
        discountBasisPoints: 500,
        isCustomItem: true,
        note: 'Cotizado a pedido del cliente',
      }),
    ]
    const payload = buildLineasJsonb(lines, 'mayoreo', 'cristian')
    expect(payload).toEqual([
      {
        es_personalizado: true,
        descripcion: 'Servicio de instalación',
        cantidad_base: 1,
        precio_unitario: 250,
        descuento_pct: 5,
        nota: 'Cotizado a pedido del cliente',
      },
    ])
  })

  it('línea de catálogo real: lleva producto_id y sucursal de origen', () => {
    const lines: WorkflowLine[] = [baseLine({ productId: '42', sourceLocation: 'Tienda' })]
    const payload = buildLineasJsonb(lines, 'mayoreo', 'cristian')
    expect(payload).toHaveLength(1)
    const linea = payload[0] as Record<string, unknown>
    expect(linea.producto_id).toBe(42)
    expect(linea.cantidad_base).toBe(3)
    expect(linea.precio_unitario).toBe(100)
    expect(linea.es_personalizado).toBeUndefined()
  })

  it('carrito con ítem personalizado y línea de catálogo mezclados: cada uno serializa a su propio shape', () => {
    const lines: WorkflowLine[] = [
      baseLine({ productId: '42' }),
      baseLine({ id: '2', productId: '', name: 'Flete especial', isCustomItem: true, quantity: 1, unitPriceCents: 5000 }),
    ]
    const payload = buildLineasJsonb(lines, 'institucional', 'cristian') as Record<string, unknown>[]
    expect(payload).toHaveLength(2)
    expect(payload[0].producto_id).toBe(42)
    expect(payload[1].es_personalizado).toBe(true)
    expect(payload[1].producto_id).toBeUndefined()
  })
})
