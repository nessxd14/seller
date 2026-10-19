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
    expect(r.a).toEqual({ baseQty: 5, disponibleParaLinea: 10, faltante: 0, faltantePresentacion: 0, despachablePresentacion: 5 })
  })

  it('faltante parcial', () => {
    const r = calcularFaltantes([line('a', '1', 10)], { '1': disp(6) })
    expect(r.a).toEqual({ baseQty: 10, disponibleParaLinea: 6, faltante: 4, faltantePresentacion: 4, despachablePresentacion: 6 })
  })

  it('línea totalmente sin stock', () => {
    const r = calcularFaltantes([line('a', '1', 3)], { '1': disp(0) })
    expect(r.a.faltante).toBe(3)
    expect(r.a.disponibleParaLinea).toBe(0)
  })

  it('dos líneas del mismo producto comparten el saldo', () => {
    const r = calcularFaltantes([line('a', '1', 7), line('b', '1', 7)], { '1': disp(10) })
    expect(r.a.faltante).toBe(0)
    expect(r.b).toEqual({ baseQty: 7, disponibleParaLinea: 3, faltante: 4, faltantePresentacion: 4, despachablePresentacion: 3 })
  })

  it('aplica el factor de presentación', () => {
    const r = calcularFaltantes([line('a', '1', 2, { factorUnidadBase: 12 })], { '1': disp(20) })
    // 4 u. de faltante sube a 1 presentación entera (12 u.)
    expect(r.a).toEqual({ baseQty: 24, disponibleParaLinea: 20, faltante: 12, faltantePresentacion: 1, despachablePresentacion: 1 })
  })

  describe('presentación entera (PAQUETE (50))', () => {
    const paq = (qty: number) => line('a', '1', qty, { factorUnidadBase: 50, presentacionNombre: 'PAQUETE (50)' })

    it('15 paquetes con 312 u. disponibles: se compran 9 paquetes', () => {
      const r = calcularFaltantes([paq(15)], { '1': disp(312) })
      expect(r.a).toMatchObject({ baseQty: 750, disponibleParaLinea: 312, faltante: 450, faltantePresentacion: 9, despachablePresentacion: 6 })
    })
    it('sin disponible: toda la línea', () => {
      expect(calcularFaltantes([paq(15)], { '1': disp(0) }).a.faltante).toBe(750)
    })
    it('disponible completo o mayor: sin faltante', () => {
      expect(calcularFaltantes([paq(15)], { '1': disp(750) }).a.faltante).toBe(0)
      expect(calcularFaltantes([paq(15)], { '1': disp(900) }).a.faltante).toBe(0)
    })
    it('el saldo corrido sigue consumiendo baseQty entre líneas del mismo producto', () => {
      const lines = [paq(2), { ...paq(2), id: 'b' }]
      const r = calcularFaltantes(lines, { '1': disp(130) })
      expect(r.a.faltante).toBe(0)
      expect(r.b).toMatchObject({ disponibleParaLinea: 30, faltante: 100, faltantePresentacion: 2, despachablePresentacion: 0 })
    })
    it('resumenPorComprar lleva factor y presentación', () => {
      const lines = [{ ...paq(15), comprarFaltante: true }]
      const f = calcularFaltantes(lines, { '1': disp(312) })
      expect(resumenPorComprar(lines, f)[0]).toMatchObject({ faltante: 450, factorUnidadBase: 50, presentacionNombre: 'PAQUETE (50)', faltantePresentacion: 9, cantidad: 15 })
    })
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
