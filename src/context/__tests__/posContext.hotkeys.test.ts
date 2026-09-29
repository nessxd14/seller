// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { PosProvider, usePos } from '../PosContext'
import { products } from '../../data/products'

const product = products[0]
const other = products[1]

describe('PosContext.addProduct con cantidad — Brief hotkeys Tarea 3a', () => {
  it('agrega N unidades de una línea nueva', () => {
    const { result } = renderHook(() => usePos(), { wrapper: PosProvider })
    act(() => { result.current.addProduct(product, 12) })
    expect(result.current.cart.find((item) => item.id === product.id)?.cantidad).toBe(12)
  })

  it('mezcla la cantidad con una línea existente (mismo merge que agregar de a 1)', () => {
    const { result } = renderHook(() => usePos(), { wrapper: PosProvider })
    act(() => { result.current.addProduct(product) })
    act(() => { result.current.addProduct(product, 5) })
    expect(result.current.cart.find((item) => item.id === product.id)?.cantidad).toBe(6)
    expect(result.current.cart).toHaveLength(1)
  })

  it('sin segundo argumento sigue agregando de a 1 (compatibilidad)', () => {
    const { result } = renderHook(() => usePos(), { wrapper: PosProvider })
    act(() => { result.current.addProduct(product) })
    expect(result.current.cart.find((item) => item.id === product.id)?.cantidad).toBe(1)
  })
})

describe('PosContext.undoLastAdd — Brief hotkeys Tarea 3c', () => {
  it('agregar → agregar → deshacer → deshacer vacía el carrito en orden inverso', () => {
    const { result } = renderHook(() => usePos(), { wrapper: PosProvider })
    act(() => { result.current.addProduct(product, 3) })
    act(() => { result.current.addProduct(other, 2) })
    expect(result.current.cart).toHaveLength(2)

    let deshecho = ''
    act(() => { deshecho = result.current.undoLastAdd() ?? '' })
    expect(deshecho).toBe(other.nombre)
    expect(result.current.cart.find((item) => item.id === other.id)).toBeUndefined()
    expect(result.current.cart.find((item) => item.id === product.id)?.cantidad).toBe(3)

    act(() => { deshecho = result.current.undoLastAdd() ?? '' })
    expect(deshecho).toBe(product.nombre)
    expect(result.current.cart).toHaveLength(0)
  })

  it('deshacer con la pila vacía no hace nada', () => {
    const { result } = renderHook(() => usePos(), { wrapper: PosProvider })
    let deshecho: string | null = 'no-tocado'
    act(() => { deshecho = result.current.undoLastAdd() })
    expect(deshecho).toBeNull()
    expect(result.current.cart).toHaveLength(0)
  })

  it('deshace solo la última cantidad agregada, no toda la línea', () => {
    const { result } = renderHook(() => usePos(), { wrapper: PosProvider })
    act(() => { result.current.addProduct(product, 3) })
    act(() => { result.current.addProduct(product, 5) })
    expect(result.current.cart.find((item) => item.id === product.id)?.cantidad).toBe(8)

    act(() => { result.current.undoLastAdd() })
    expect(result.current.cart.find((item) => item.id === product.id)?.cantidad).toBe(3)
  })
})
