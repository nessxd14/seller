import { describe, expect, it } from 'vitest'
import { buildVentaLineas } from '../SaleRepository.supabase'

describe('buildVentaLineas — p_lineas de registrar_venta', () => {
  it('línea personalizada: es_personalizado/descripcion/unidad_medida/cantidad_base, sin producto ni origen', () => {
    const [linea] = buildVentaLineas([{ productId: '', isCustomItem: true, description: 'SELLO AUTOMATICO', unitOfMeasure: 'JUEGO', quantity: 2, unitPriceCents: 1500, listPriceCents: 1500, sourceLocation: 'Tienda', presentacionId: 7 }])
    expect(linea).toEqual({ es_personalizado: true, descripcion: 'SELLO AUTOMATICO', unidad_medida: 'JUEGO', cantidad_base: 2, precio_unitario: 15, precio_lista: 15 })
    expect('producto_id' in linea).toBe(false)
    expect('presentacion_id' in linea).toBe(false)
    expect('sucursal_origen_id' in linea).toBe(false)
  })
  it('línea de catálogo: sin cambios (producto_id, origen)', () => {
    const [linea] = buildVentaLineas([{ productId: '42', quantity: 3, unitPriceCents: 1000, sourceLocation: 'Tienda' }]) as Record<string, unknown>[]
    expect(linea.producto_id).toBe(42)
    expect(linea.cantidad_base).toBe(3)
    expect(linea.sucursal_origen_id).toBeDefined()
    expect(linea.es_personalizado).toBeUndefined()
  })
})
