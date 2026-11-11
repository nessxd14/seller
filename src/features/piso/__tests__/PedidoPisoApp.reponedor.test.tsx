// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const estado = vi.hoisted(() => ({ activo: {} as Record<string, unknown> }))
vi.mock('../EscanerContinuo', () => ({ EscanerContinuo: () => null, useWakeLock: () => {}, vibrarDesconocido: vi.fn() }))
vi.mock('../usePedidosPiso', () => ({ usePedidosPiso: () => ({ activo: estado.activo, pedidos: [estado.activo], abiertos: 1, errorPedido: {}, agregar: vi.fn(), cambiarPrecio: vi.fn(), activar: vi.fn() }) }))
vi.mock('../../../infrastructure/services', () => ({ listPresentations: vi.fn(), productRepository: {}, pedidoVendedorService: { misCuentaVendedor: vi.fn().mockRejectedValue(new Error('no')) } }))
vi.mock('../../../infrastructure/supabase/SupabaseAuthSessionProvider', () => ({ supabaseAuthSessionProvider: {} }))
vi.mock('../../transfers/TransfersPage', () => ({ TransfersPage: () => <p>Traslados</p> }))
vi.mock('../MisVentasPiso', () => ({ MisVentasPiso: () => <p>Pantalla Mis ventas</p> }))
import { PedidoPisoApp } from '../PedidoPisoApp'

const sesion = (role: 'reponedor' | 'vendedor') => ({ user: { id: 'u', name: 'QA', role, active: true }, expiresAt: '2999-01-01' })
const linea = { localId: 'l1', productoId: 1, nombre: 'Resma', sku: 'R', presentacionId: null, presentacionNombre: null, esBase: true, factor: 1, esPersonalizado: false, unidadMedida: null, cantidad: 1, precioRetail: 100, precioLista: 100, precioMinimo: 90, precioUnitario: 100, precioGuardado: 100 }
const pedido = (over: Record<string, unknown>) => ({ clave: 'c', pedidoId: '9', codigo: 'PDV-9', numeroDia: 14, estado: 'ENVIADO', lineas: [linea], nota: null, revision: 1, guardadoRevision: 1, creadoEn: '', snapshot: { total: 100, lineas: [], tomadoPor: null, ventaNumero: null, anuladoMotivo: null }, ...over })

beforeEach(() => { estado.activo = pedido({}) })
afterEach(cleanup)

describe('PedidoPisoApp — reponedor', () => {
  it('enviada: no ve "Anular pedido", ve el aviso y puede retirar de caja', () => {
    render(<PedidoPisoApp session={sesion('reponedor')} />)
    expect(screen.queryByRole('button', { name: 'Anular pedido' })).toBeNull()
    expect(screen.getByText(/Tú no cobras ni anulas/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retirar de caja para corregir' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Venta nueva' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Venta 14' })).toBeTruthy()
  })

  it('el vendedor sí ve "Anular pedido"', () => {
    render(<PedidoPisoApp session={sesion('vendedor')} />)
    expect(screen.getByRole('button', { name: 'Anular pedido' })).toBeTruthy()
  })

  it('barra inferior: Vender, Traslados y Mis ventas', () => {
    estado.activo = pedido({ estado: 'ARMANDO' })
    render(<PedidoPisoApp session={sesion('reponedor')} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mis ventas' }))
    expect(screen.getByText('Pantalla Mis ventas')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Traslados' }))
    expect(screen.getByText('Traslados', { selector: 'p' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Vender' }))
    expect(screen.getByRole('button', { name: 'Enviar a caja' })).toBeTruthy()
  })

  it('cobrada: muestra "Tu parte" con el precio final de caja', () => {
    estado.activo = pedido({ estado: 'COBRADO', snapshot: { total: 100, tomadoPor: null, ventaNumero: 'VTA-1', anuladoMotivo: null, lineas: [{ orden: 1, nombre: 'Resma', cantidad: 2, subtotal: 200, resultado: 'COBRADA', cantidadFinal: 2, precioFinal: 45 }] } })
    render(<PedidoPisoApp session={sesion('reponedor')} />)
    expect(screen.getByText('Tu parte: Bs 90,00 de Bs 100,00')).toBeTruthy()
  })

  it('HojaPrecio bloquea bajar del mínimo para el reponedor', () => {
    estado.activo = pedido({ estado: 'ARMANDO', snapshot: null })
    render(<PedidoPisoApp session={sesion('reponedor')} />)
    fireEvent.click(screen.getByRole('button', { name: 'Precio de Resma' }))
    fireEvent.change(screen.getByLabelText('Precio unitario (Bs)'), { target: { value: '80' } })
    expect(screen.getByRole('alert').textContent).toMatch(/El mínimo para este producto es Bs 90,00/)
    expect((screen.getByRole('button', { name: 'Listo' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Precio unitario (Bs)'), { target: { value: '92' } })
    expect((screen.getByRole('button', { name: 'Listo' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
