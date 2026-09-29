import { describe, expect, it } from 'vitest'
import { buildLineasJsonb } from '../OrderRepository.supabase'
import type { WorkflowLine } from '../../../application/shared/models'

const baseLine = (overrides: Partial<WorkflowLine> = {}): WorkflowLine => ({
  id: '1', productId: '42', name: 'Producto', sku: 'SKU-1', quantity: 3, unitPriceCents: 10000, discountBasisPoints: 0, ...overrides,
})

describe('buildLineasJsonb (pedido) — unidad de medida de ítems personalizados', () => {
  it('la línea personalizada lleva unidad_medida y no lleva producto_id', () => {
    const [linea] = buildLineasJsonb([baseLine({ productId: '', name: 'Cinta', isCustomItem: true, unitOfMeasure: 'ROLLO' })], 'mayoreo') as Record<string, unknown>[]
    expect(linea).toMatchObject({ es_personalizado: true, descripcion: 'Cinta', unidad_medida: 'ROLLO', cantidad_base: 3 })
    expect(linea.producto_id).toBeUndefined()
  })
  it('sin unidad → null; una línea de catálogo no lleva unidad_medida', () => {
    const [custom, catalogo] = buildLineasJsonb([baseLine({ productId: '', isCustomItem: true }), baseLine()], 'mayoreo') as Record<string, unknown>[]
    expect(custom.unidad_medida).toBeNull()
    expect('unidad_medida' in catalogo).toBe(false)
  })
})
