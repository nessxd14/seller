// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthSession } from '../../../application/auth/AuthSessionProvider'

const estado = vi.hoisted(() => ({ activo: {} as Record<string, unknown> }))
vi.mock('../EscanerContinuo', () => ({ EscanerContinuo: () => null, useWakeLock: () => {}, vibrarDesconocido: vi.fn() }))
vi.mock('../usePedidosPiso', () => ({ usePedidosPiso: () => ({ activo: estado.activo, pedidos: [estado.activo], abiertos: 1, errorPedido: {}, agregar: vi.fn(), cambiarPrecio: vi.fn(), activar: vi.fn() }) }))
vi.mock('../../../infrastructure/services', () => ({ listPresentations: vi.fn(), productRepository: {}, pedidoVendedorService: { misCuentaVendedor: vi.fn().mockRejectedValue(new Error('no')) } }))
vi.mock('../../../infrastructure/supabase/SupabaseAuthSessionProvider', () => ({ supabaseAuthSessionProvider: {} }))
vi.mock('../TrasladosPiso', () => ({ TrasladosPiso: () => <p>Traslados</p> }))
vi.mock('../MisVentasPiso', () => ({ MisVentasPiso: () => <p>Pantalla Mis ventas</p> }))
vi.mock('../InicioPiso', () => ({ InicioPiso: () => <p>Pantalla Inicio</p> }))
import { PedidoPisoApp } from '../PedidoPisoApp'

const sesion = (role: AuthSession['user']['role']): AuthSession => ({ user: { id: 'u9', name: 'Lupe', role, active: true }, expiresAt: '2999-01-01' })
const pedido = { clave: 'c', pedidoId: null, codigo: null, numeroDia: null, estado: 'ARMANDO', canal: 'TIENDA', lineas: [], nota: null, revision: 0, guardadoRevision: 0, creadoEn: '', snapshot: null }

beforeEach(() => { estado.activo = pedido; localStorage.setItem('seller:modo-tienda:u9', '1'); window.history.replaceState({}, '', '/piso') })
afterEach(() => { cleanup(); localStorage.clear() })

describe('PedidoPisoApp — Modo tienda', () => {
  it.each(['admin', 'cajero', 'gerente', 'vendedor_mayoreo'] as const)('%s ve la banda, la navegación y el texto de reponedor', (rol) => {
    render(<PedidoPisoApp session={sesion(rol)} modoTienda />)
    expect(screen.getByText(`Modo tienda · Lupe (${rol})`)).toBeTruthy()
    expect(screen.getByText('Pantalla Inicio')).toBeTruthy()
    const nav = screen.getByRole('navigation', { name: 'Secciones' })
    expect(Array.from(nav.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Inicio', 'Armar venta', 'Traslados', 'Mis ventas'])
    fireEvent.click(screen.getByRole('button', { name: 'Armar venta' }))
    expect(screen.getByRole('heading', { name: 'Venta nueva' })).toBeTruthy()
  })

  it.each(['reponedor', 'vendedor'] as const)('%s no ve la banda', (rol) => {
    render(<PedidoPisoApp session={sesion(rol)} modoTienda />)
    expect(screen.queryByText(/Modo tienda ·/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Volver al Seller/ })).toBeNull()
  })

  it('«Volver al Seller» limpia la bandera y sale de /piso', () => {
    render(<PedidoPisoApp session={sesion('gerente')} modoTienda />)
    fireEvent.click(screen.getByRole('button', { name: '‹ Volver al Seller' }))
    expect(localStorage.getItem('seller:modo-tienda:u9')).toBeNull()
    expect(window.location.pathname).toBe('/')
  })

  it('sin modoTienda el cajero conserva su pantalla de piso (sin banda ni navegación)', () => {
    render(<PedidoPisoApp session={sesion('cajero')} />)
    expect(screen.queryByText(/Modo tienda ·/)).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Secciones' })).toBeNull()
  })
})
