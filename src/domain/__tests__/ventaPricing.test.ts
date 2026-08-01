import { describe, expect, it } from 'vitest'
import { netUnitPriceCents, ventaLineTotalCents } from '../sales/ventaPricing'

describe('ventaPricing — espejo de registrar_venta', () => {
  // round(v_unit * v_cant_pres, 2) con v_unit = netUnitPriceCents/100
  const backend = (precio: number, cantidad: number, descuento: number) =>
    Math.round((netUnitPriceCents({ precioAplicado: precio, cantidad, descuento }) / 100) * cantidad * 100)

  it('coincide con el backend en los casos que hoy rompen', () => {
    expect(ventaLineTotalCents({ precioAplicado: 0.5, cantidad: 24, descuento: 5 })).toBe(1152)
    expect(ventaLineTotalCents({ precioAplicado: 1.99, cantidad: 7, descuento: 15 })).toBe(1183)
  })

  it('coincide con el backend en una barrida amplia', () => {
    for (let c = 1; c <= 3000; c += 7) {
      const precio = c / 100
      for (const descuento of [0, 5, 7, 12, 15, 17.5, 25, 33, 50, 100]) {
        for (const cantidad of [1, 3, 7, 12, 24, 999]) {
          expect(ventaLineTotalCents({ precioAplicado: precio, cantidad, descuento }))
            .toBe(backend(precio, cantidad, descuento))
        }
      }
    }
  })
})
