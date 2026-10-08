import { describe, expect, it } from 'vitest'
import type { WorkflowLine } from '../../../application/shared/models'
import { calcularFaltantes, resumenPorComprar } from '../faltantes'

const line = (id: string, productId: string, quantity: number, extra: Partial<WorkflowLine> = {}): WorkflowLine => ({
  id, productId, name: `Producto ${productId}`, sku: `SKU-${productId}`, quantity, unitPriceCents: 100, discountBasisPoints: 0, ...extra,
})
const disp = (n: number) => ({ stockFisico: n, reservado: 0, disponible: n })

describe('calcularFaltantes', () => {
  it('sin faltante cuando alcanza', () => {
    const r = calcularFaltantes([line('a', '1', 5)], { '1': disp(10) })
    expect(r.a).toEqual({ baseQty: 5, disponibleParaLinea: 10, faltante: 0 })
  })

  it('faltante parcial', () => {
    const r = calcularFaltantes([line('a', '1', 10)], { '1': disp(6) })
    expect(r.a).toEqual({ baseQty: 10, disponibleParaLinea: 6, faltante: 4 })
  })

  it('línea totalmente sin stock', () => {
    const r = calcularFaltantes([line('a', '1', 3)], { '1': disp(0) })
    expect(r.a.faltante).toBe(3)
    expect(r.a.disponibleParaLinea).toBe(0)
  })

  it('dos líneas del mismo producto comparten el saldo', () => {
    const r = calcularFaltantes([line('a', '1', 7), line('b', '1', 7)], { '1': disp(10) })
    expect(r.a.faltante).toBe(0)
    expect(r.b).toEqual({ baseQty: 7, disponibleParaLinea: 3, faltante: 4 })
  })

  it('aplica el factor de presentación', () => {
    const r = calcularFaltantes([line('a', '1', 2, { factorUnidadBase: 12 })], { '1': disp(20) })
    expect(r.a).toEqual({ baseQty: 24, disponibleParaLinea: 20, faltante: 4 })
  })

  it('ignora ítems personalizados', () => {
    const r = calcularFaltantes([line('c', 'custom-1', 5, { isCustomItem: true })], {})
    expect(r).toEqual({})
  })

  it('producto desconocido no reporta faltante', () => {
    const r = calcularFaltantes([line('a', '9', 5)], { '1': disp(0) })
    expect(r.a).toBeUndefined()
  })
})

describe('resumenPorComprar', () => {
  it('incluye líneas decididas con faltante y todos los personalizados', () => {
    const lines = [
      line('a', '1', 10, { comprarFaltante: true }),
      line('b', '2', 10),
      line('c', 'custom-1', 2, { isCustomItem: true }),
      line('d', '3', 1, { comprarFaltante: true }),
    ]
    const faltantes = calcularFaltantes(lines, { '1': disp(6), '2': disp(1), '3': disp(5) })
    const r = resumenPorComprar(lines, faltantes)
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ lineId: 'a', faltante: 4, baseQty: 10, sku: 'SKU-1' })
    expect(r[1]).toEqual({ lineId: 'c', name: 'Producto custom-1', cantidad: 2, esPersonalizado: true })
  })
})
