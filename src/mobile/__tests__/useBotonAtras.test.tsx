// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CERRAR_CARRITO, useBotonAtras } from '../useBotonAtras'

const esperarObservador = () => act(async () => { await Promise.resolve() })
const atras = (state: unknown) => act(() => { window.dispatchEvent(new PopStateEvent('popstate', { state })) })

afterEach(() => { cleanup(); document.body.innerHTML = '' })

describe('botón Atrás en el celular', () => {
  it('cada módulo deja su entrada y Atrás vuelve al anterior', () => {
    const navegar = vi.fn()
    const { rerender } = renderHook(({ activo }) => useBotonAtras(activo, navegar), { initialProps: { activo: 'Caja' } })
    expect(window.history.state.movilModulo).toBe('Caja')
    const largo = window.history.length
    rerender({ activo: 'Pedidos' })
    expect(window.history.state.movilModulo).toBe('Pedidos')
    expect(window.history.length).toBe(largo + 1)
    atras({ movilModulo: 'Caja' })
    expect(navegar).toHaveBeenCalledWith('Caja')
  })

  it('con una ventana abierta, Atrás la cierra (Escape) en vez de cambiar de módulo', async () => {
    const navegar = vi.fn()
    renderHook(() => useBotonAtras('Venta', navegar))
    const dialogo = document.createElement('section')
    dialogo.setAttribute('role', 'dialog')
    dialogo.setAttribute('aria-modal', 'true')
    document.body.appendChild(dialogo)
    await esperarObservador()
    expect(window.history.state.movilCapa).toBe(1)
    const teclas: string[] = []
    const escuchar = (e: KeyboardEvent) => teclas.push(e.key)
    document.addEventListener('keydown', escuchar)
    atras({ movilModulo: 'Caja' })
    document.removeEventListener('keydown', escuchar)
    expect(teclas).toEqual(['Escape'])
    expect(navegar).not.toHaveBeenCalled()
  })

  it('con el carrito abierto, Atrás pide cerrarlo', async () => {
    renderHook(() => useBotonAtras('Venta', vi.fn()))
    const carrito = document.createElement('section')
    carrito.className = 'movil-carrito abierto'
    document.body.appendChild(carrito)
    await esperarObservador()
    const cerrar = vi.fn()
    window.addEventListener(CERRAR_CARRITO, cerrar)
    atras({ movilModulo: 'Venta' })
    window.removeEventListener(CERRAR_CARRITO, cerrar)
    expect(cerrar).toHaveBeenCalledTimes(1)
  })
})
