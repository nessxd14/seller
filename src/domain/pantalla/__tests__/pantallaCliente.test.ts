// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { PosProvider, usePos } from '../../../context/PosContext'
import { products } from '../../../data/products'
import { aceptarEstado, construirEstado, construirLineas, detectarCambio, esPantallaEstado, type PantallaEstado } from '../pantallaCliente'

const base = (over: Partial<PantallaEstado> = {}): PantallaEstado => ({
  v: 1, seq: 1, emisorId: 'a', cajaId: 1, ts: '2026-11-26T10:00:00.000Z', fase: 'venta', lineas: [], ultimaKey: null, ultimoCambio: null,
  unidades: 0, subtotal: 0, descuento: 0, total: 0, ...over,
})

describe('construirEstado — los totales son los de Caja', () => {
  it('con descuento de línea, descuento general y presentación coincide con usePos()', () => {
    const { result } = renderHook(() => usePos(), { wrapper: PosProvider })
    act(() => {
      result.current.addProduct(products[0], 3)
      result.current.addProduct(products[1], 2)
      result.current.addProduct(products[2], 1)
    })
    const [a, b, c] = result.current.cart
    act(() => {
      // Descuento de línea que no da centavos redondos y una línea en presentación «Caja».
      result.current.updateItem(a.id, { descuento: 7 })
      result.current.updateItem(b.id, { presentacionId: 9, presentacionNombre: 'Caja', precioAplicado: 33.33, cantidad: 4 })
      result.current.updateItem(c.id, { descuento: 12.5 })
    })
    act(() => { result.current.setDiscount(5.55) })

    const { cart, subtotal, total } = result.current
    const estado = construirEstado({ cajaId: 1, seq: 1, emisorId: 'x', fase: 'venta', carrito: cart, subtotal, total })

    expect(estado.subtotal).toBe(subtotal)
    expect(estado.total).toBe(total)
    expect(estado.descuento).toBeGreaterThan(0)
    expect(Math.round((estado.subtotal - estado.descuento) * 100)).toBe(Math.round(total * 100))
    // Cada línea cobra lo mismo que Caja y la suma de líneas es el subtotal.
    expect(Math.round(estado.lineas.reduce((suma, linea) => suma + linea.subtotal * 100, 0))).toBe(Math.round(subtotal * 100))
    expect(estado.lineas.find((linea) => linea.key === String(b.id))).toMatchObject({ presentacion: 'Caja', cantidad: 4, precioUnitario: 33.33 })
    expect(estado.unidades).toBe(3 + 4 + 1)
  })

  it('sin descuento general el descuento es 0 y una línea sin foto manda imagenUrl null', () => {
    const lineas = construirLineas([{ id: 1, nombre: 'Cuaderno', cantidad: 2, precioAplicado: 10, descuento: 0 }])
    expect(lineas[0]).toMatchObject({ key: '1', presentacion: 'Unidad', precioUnitario: 10, subtotal: 20, imagenUrl: null })
    const estado = construirEstado({ cajaId: 1, seq: 1, emisorId: 'x', fase: 'venta', carrito: [{ id: 1, nombre: 'Cuaderno', cantidad: 2, precioAplicado: 10, descuento: 0 }], subtotal: 20, total: 20 })
    expect(estado.descuento).toBe(0)
  })
})

describe('detectarCambio', () => {
  const l = (key: string, cantidad: number) => ({ key, nombre: key, presentacion: 'Unidad', cantidad, precioUnitario: 1, subtotal: cantidad, imagenUrl: null })
  it('línea agregada', () => expect(detectarCambio([l('1', 1)], [l('1', 1), l('2', 1)])).toEqual({ ultimaKey: '2', ultimoCambio: 'agregado' }))
  it('cambio de cantidad', () => expect(detectarCambio([l('1', 1), l('2', 1)], [l('1', 3), l('2', 1)])).toEqual({ ultimaKey: '1', ultimoCambio: 'cantidad' }))
  it('línea quitada', () => expect(detectarCambio([l('1', 1), l('2', 1)], [l('1', 1)])).toEqual({ ultimaKey: '2', ultimoCambio: 'quitado' }))
  it('sin cambios', () => expect(detectarCambio([l('1', 1)], [l('1', 1)])).toBeNull())
})

describe('contrato recibido por la red', () => {
  it('rechaza lo que no cumple el contrato o es de otra caja', () => {
    expect(esPantallaEstado(base(), 1)).toBe(true)
    expect(esPantallaEstado(base(), 2)).toBe(false)
    expect(esPantallaEstado({ ...base(), v: 2 }, 1)).toBe(false)
    expect(esPantallaEstado({ ...base(), fase: 'otra' }, 1)).toBe(false)
    expect(esPantallaEstado(null, 1)).toBe(false)
  })
  it('aceptarEstado: seq menor del mismo emisor se ignora; emisor nuevo se acepta', () => {
    const actual = base({ seq: 5, emisorId: 'a' })
    expect(aceptarEstado(actual, base({ seq: 4, emisorId: 'a' }))).toBe(false)
    expect(aceptarEstado(actual, base({ seq: 5, emisorId: 'a' }))).toBe(false)
    expect(aceptarEstado(actual, base({ seq: 6, emisorId: 'a' }))).toBe(true)
    expect(aceptarEstado(actual, base({ seq: 1, emisorId: 'b' }))).toBe(true)
    expect(aceptarEstado(null, base())).toBe(true)
  })
})
