// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activo: {} as Record<string, unknown>,
  setCanal: vi.fn(() => true), mover: vi.fn(() => true), setNota: vi.fn(), stock: vi.fn(),
}))
vi.mock('../EscanerContinuo', () => ({ EscanerContinuo: () => null, useWakeLock: () => {}, vibrarDesconocido: vi.fn() }))
vi.mock('../usePedidosPiso', () => ({
  usePedidosPiso: () => ({ activo: mocks.activo, pedidos: [mocks.activo], abiertos: 1, errorPedido: {}, agregar: vi.fn(), setCanal: mocks.setCanal, mover: mocks.mover, setNota: mocks.setNota }),
}))
vi.mock('../../../infrastructure/services', () => ({
  listPresentations: vi.fn(), productRepository: {}, getStockBySucursalBatch: mocks.stock,
  pedidoVendedorService: { misCuentaVendedor: vi.fn().mockRejectedValue(new Error('no')) },
}))
vi.mock('../../../infrastructure/supabase/SupabaseAuthSessionProvider', () => ({ supabaseAuthSessionProvider: {} }))
vi.mock('../TrasladosPiso', () => ({ TrasladosPiso: () => <p>Traslados</p> }))
vi.mock('../MisVentasPiso', () => ({ MisVentasPiso: () => <p>Pantalla Mis ventas</p> }))
vi.mock('../InicioPiso', () => ({ InicioPiso: () => <p>Pantalla Inicio</p> }))
import { PedidoPisoApp } from '../PedidoPisoApp'

const linea = { localId: 'l1', productoId: 1, nombre: 'Resma', sku: 'R', presentacionId: null, presentacionNombre: null, esBase: true, factor: 1, esPersonalizado: false, unidadMedida: null, cantidad: 1, precioRetail: 100, precioLista: 100, precioMinimo: 90, precioUnitario: 100, precioGuardado: 100 }
const pedido = (over: Record<string, unknown>) => ({
  clave: 'c', pedidoId: '9', codigo: 'PDV-9', numeroDia: 14, estado: 'ARMANDO', canal: 'TIENDA', lineas: [linea], nota: null, revision: 1, guardadoRevision: 1, creadoEn: '',
  snapshot: { total: 100, lineas: [], tomadoPor: null, ventaNumero: null, anuladoMotivo: null }, ...over,
})
const abrir = () => {
  render(<PedidoPisoApp session={{ user: { id: 'u', name: 'QA', role: 'reponedor', active: true }, expiresAt: '2999-01-01' }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Armar venta' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.setCanal.mockReturnValue(true); mocks.mover.mockReturnValue(true)
  mocks.stock.mockResolvedValue(new Map([[1, { tiendaVendible: 0, almacenVendible: 40 }]]))
  mocks.activo = pedido({})
})
afterEach(cleanup)

describe('Armar venta — canal de almacén', () => {
  it('el toggle De almacén (VTD) cambia el canal del pedido', () => {
    abrir()
    expect(screen.getByRole('button', { name: 'De tienda' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'De almacén (VTD)' }))
    expect(mocks.setCanal).toHaveBeenCalledWith('ALMACEN')
  })

  it('en almacén pide el cliente, muestra el stock de almacén y no deja enviar sin cliente', async () => {
    mocks.activo = pedido({ canal: 'ALMACEN' })
    abrir()
    expect(screen.getByLabelText('Cliente (para que almacén lo reconozca)')).toBeTruthy()
    expect(await screen.findByText('En almacén: 40')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Producto fuera de catálogo/ })).toBeNull()
    expect((screen.getByRole('button', { name: 'Enviar a caja' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Cliente (para que almacén lo reconozca)'), { target: { value: 'Doña Rosa' } })
    expect(mocks.setNota).toHaveBeenCalledWith('Doña Rosa')
  })

  it('con cliente escrito se puede enviar', () => {
    mocks.activo = pedido({ canal: 'ALMACEN', nota: 'Doña Rosa' })
    abrir()
    expect((screen.getByRole('button', { name: 'Enviar a caja' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('en tienda, línea sin stock en tienda pero con stock en almacén ofrece Mover', async () => {
    abrir()
    expect(await screen.findByText(/En tienda no hay, en almacén sí/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mover' }))
    expect(mocks.mover).toHaveBeenCalledWith('l1')
    expect(screen.getByText(/se pueden cobrar las dos juntas/)).toBeTruthy()
  })

  it('con stock en tienda no ofrece Mover', async () => {
    mocks.stock.mockResolvedValue(new Map([[1, { tiendaVendible: 3, almacenVendible: 40 }]]))
    abrir()
    expect(await screen.findByText('En tienda: 3')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Mover' })).toBeNull()
  })
})

describe('Venta de almacén enviada', () => {
  const enviada = (estado: string, snapshot: Record<string, unknown> = {}) => pedido({
    canal: 'ALMACEN', estado, snapshot: { total: 100, lineas: [{ orden: 1, nombre: 'Resma', cantidad: 1, subtotal: 100, resultado: 'COBRADA', precioFinal: 100, cantidadFinal: 1 }], ventaNumero: null, ...snapshot },
  })

  it('esperando: tres pasos con «Caja cobra» pendiente y QR PDV', () => {
    mocks.activo = enviada('ENVIADO')
    abrir()
    const pasos = screen.getByRole('list', { name: 'Avance de la venta de almacén' })
    expect(Array.from(pasos.querySelectorAll('li')).map((li) => li.textContent)).toEqual(['Enviada a caja', 'Caja cobra', 'Almacén entrega'])
    expect(pasos.querySelector('[aria-current="step"]')?.textContent).toBe('Caja cobra')
    expect(screen.getByText('PDV-9')).toBeTruthy()
  })

  it('cobrada: muestra el ticket VTD y que almacén entrega con él', () => {
    mocks.activo = enviada('COBRADO', { ventaNumero: 'VTD-2026-00012', entregado: false })
    abrir()
    expect(screen.getByText('Ticket de caja VTD-2026-00012')).toBeTruthy()
    expect(screen.getByText('El cliente ya pagó. Almacén le entrega con este ticket.')).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Avance de la venta de almacén' }).querySelector('[aria-current="step"]')?.textContent).toBe('Almacén entrega')
    expect(screen.getByText(/Tu parte: Bs 100,00/)).toBeTruthy()
  })

  it('entregada: dice a qué hora entregó almacén', async () => {
    mocks.activo = enviada('COBRADO', { ventaNumero: 'VTD-2026-00012', entregado: true, entregadoEn: '2026-11-16T15:30:00Z' })
    abrir()
    await waitFor(() => expect(screen.getByText(/^Almacén entregó \d{2}:\d{2}/)).toBeTruthy())
    expect(screen.queryByText('El cliente ya pagó. Almacén le entrega con este ticket.')).toBeNull()
  })

  it('no ofrece cancelar a un reponedor', () => {
    mocks.activo = enviada('ENVIADO')
    abrir()
    expect(screen.queryByRole('button', { name: 'Anular pedido' })).toBeNull()
  })
})
