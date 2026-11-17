// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ search: vi.fn(), agregar: vi.fn(), activo: {} as Record<string, unknown> }))
// El visor falso expone lo que PedidoPisoApp le pasa: si está plegado y los controles que lleva dentro.
vi.mock('../EscanerContinuo', () => ({
  useWakeLock: () => {},
  vibrarDesconocido: vi.fn(),
  EscanerContinuo: ({ plegado, onCerrar, onLinterna }: { plegado: boolean; onCerrar?: () => void; onLinterna?: (v: boolean) => void }) => plegado
    ? null
    : <div data-testid="camara"><button type="button" onClick={() => onLinterna?.(true)}>linterna</button><button type="button" onClick={onCerrar}>cerrar</button></div>,
}))
vi.mock('../usePedidosPiso', () => ({ usePedidosPiso: () => ({ activo: mocks.activo, pedidos: [mocks.activo], abiertos: 1, errorPedido: {}, agregar: mocks.agregar }) }))
vi.mock('../../../infrastructure/services', () => ({
  listPresentations: vi.fn(),
  getStockBySucursalBatch: vi.fn().mockResolvedValue(new Map()),
  productRepository: { search: mocks.search, resolveScannedCode: vi.fn() },
  pedidoVendedorService: { misCuentaVendedor: vi.fn().mockRejectedValue(new Error('no')) },
}))
vi.mock('../../../lib/presentacionAlAgregar', () => ({ presentacionAlAgregar: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('../../../infrastructure/supabase/SupabaseAuthSessionProvider', () => ({ supabaseAuthSessionProvider: {} }))
import { PedidoPisoApp } from '../PedidoPisoApp'

const sesion = { user: { id: 'u', name: 'QA', role: 'cajero', active: true }, expiresAt: '2999-01-01' }
const armar = () => render(<PedidoPisoApp session={sesion as never} />)
const buscador = () => screen.getByLabelText('Buscar producto')

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  mocks.activo = { clave: 'c', pedidoId: null, codigo: null, numeroDia: null, estado: 'ARMANDO', canal: 'TIENDA', lineas: [], nota: null, revision: 0, guardadoRevision: 0, creadoEn: '', snapshot: null }
  mocks.search.mockResolvedValue({ items: [{ id: 5, nombre: 'Pegamento UHU', sku: 'U-5', precioRetail: 12 }] })
})
afterEach(cleanup)

describe('Armar venta — cámara y buscador', () => {
  it('la cámara arranca abierta y lleva dentro la linterna y el cierre', () => {
    armar()
    const camara = screen.getByTestId('camara')
    expect(camara.textContent).toContain('linterna')
    expect(camara.textContent).toContain('cerrar')
    expect(screen.queryByRole('button', { name: /Ocultar cámara|Abrir cámara/ })).toBeNull()
  })

  it('enfocar el buscador oculta la cámara y salir con el texto vacío la restaura', () => {
    armar()
    fireEvent.focus(buscador())
    expect(screen.queryByTestId('camara')).toBeNull()
    fireEvent.blur(buscador())
    expect(screen.getByTestId('camara')).toBeTruthy()
  })

  it('con texto la cámara sigue oculta aunque se pierda el foco; al elegir un resultado se agrega, se limpia y vuelve', async () => {
    armar()
    fireEvent.focus(buscador())
    fireEvent.change(buscador(), { target: { value: 'uhu' } })
    fireEvent.blur(buscador())
    expect(screen.queryByTestId('camara')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: /Pegamento UHU/ }))
    await waitFor(() => expect(mocks.agregar).toHaveBeenCalledTimes(1))
    expect((buscador() as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.getByTestId('camara')).toBeTruthy()
  })

  it('borrar el texto restaura la cámara', () => {
    armar()
    fireEvent.change(buscador(), { target: { value: 'uhu' } })
    expect(screen.queryByTestId('camara')).toBeNull()
    fireEvent.change(buscador(), { target: { value: '' } })
    expect(screen.getByTestId('camara')).toBeTruthy()
  })

  it('cerrar la cámara se recuerda en piso:camara y deja un botón azul para reabrirla', () => {
    const primera = armar()
    fireEvent.click(screen.getByRole('button', { name: 'cerrar' }))
    expect(window.localStorage.getItem('piso:camara')).toBe('cerrada')
    expect(screen.queryByTestId('camara')).toBeNull()
    primera.unmount()

    armar()
    expect(screen.queryByTestId('camara')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir cámara' }))
    expect(screen.getByTestId('camara')).toBeTruthy()
    expect(window.localStorage.getItem('piso:camara')).toBe('abierta')
    expect(screen.queryByRole('button', { name: 'Abrir cámara' })).toBeNull()
  })

  it('sin localStorage la cámara arranca abierta y no falla al cerrar', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new Error('bloqueado') } })
    try {
      armar()
      expect(screen.getByTestId('camara')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'cerrar' }))
      expect(screen.queryByTestId('camara')).toBeNull()
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original)
    }
  })
})
