// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CartPanel } from '../CartPanel'
import { PosProvider, usePos } from '../../context/PosContext'
import { CashSessionProvider } from '../../context/CashSessionContext'
import type { Product } from '../../types'
import { getStockBySucursalBatch, ventaDirectaService } from '../../infrastructure/services'

vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,qr') } }))

const { celular, almacenMock } = vi.hoisted(() => ({
  celular: { value: false },
  almacenMock: { createRequest: vi.fn() },
}))
vi.mock('../../mobile/useEsCelular', () => ({ useEsCelular: () => celular.value }))
vi.mock('../../context/CajaAlmacenContext', () => ({
  useCajaAlmacen: () => ({
    managed: true, record: null, error: '', busy: false, link: async () => true, createRequest: almacenMock.createRequest,
    refresh: async () => {}, flush: async () => {}, resolve: async () => false, park: async () => false, resume: async () => false, enEspera: 0,
  }),
}))

const venta = {
  id: '13', numero: 'VTD-2026-0013', creadoEn: '2026-11-09T12:00:00Z', modo: 'POSTCOBRADO', lines: [], subtotalCents: 1000, discountCents: 0, totalCents: 1000, estado: 'ABIERTA',
}

vi.mock('../../infrastructure/services', () => ({
  authSessionProvider: { getSession: vi.fn().mockResolvedValue({ user: { id: 'u1', role: 'cajero', active: true }, expiresAt: '2099-01-01' }) },
  turnoService: { getSesionAbierta: vi.fn().mockResolvedValue({ id: '1', cajeroId: 'u1' }) },
  cashService: { getOpenSession: vi.fn().mockResolvedValue(null) },
  transferService: { create: vi.fn() },
  ventaDirectaService: { getUbicacionVentasDirectas: vi.fn().mockResolvedValue(31), listAbiertas: vi.fn().mockResolvedValue([]), listPorCobrar: vi.fn().mockResolvedValue([]), cobrarVtd: vi.fn(), getById: vi.fn() },
  borradorOperacionService: { save: vi.fn() },
  getStockBySucursalBatch: vi.fn().mockResolvedValue(new Map()),
  configService: { listSucursales: vi.fn().mockResolvedValue([]) },
  listPresentations: vi.fn().mockResolvedValue([]),
}))

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); celular.value = false; almacenMock.createRequest.mockReset(); vi.mocked(ventaDirectaService.getById).mockReset(); Element.prototype.scrollIntoView = vi.fn(); vi.mocked(getStockBySucursalBatch).mockResolvedValue(new Map([[998, stockAlmacen(5, 0)]])) })
afterEach(cleanup)

const product = (id: number, nombre: string, stockAlmacen = 5): Product => ({
  id, sku: `SKU-${id}`, codigoBarra: '', codigoFabrica: '', nombre, descripcion: '', categoria: '', imagen: '', color: '',
  precioRetail: 10, precioMayoreo: 10, precioInstitucional: 10, precioCorporativo: 10, stockTienda: 100, stockAlmacen,
} as Product)

const stockAlmacen = (vendible: number, reservado: number) => ({ tienda: 100, almacen: vendible + reservado, tiendaLibre: false, almacenLibre: false, tiendaVendible: 100, almacenVendible: vendible, tiendaReservado: 0, almacenReservado: reservado, tiendaMotivo: null, almacenMotivo: null })
const holder: { current: ReturnType<typeof usePos> | null } = { current: null }
const pos = () => holder.current!
function Probe() { const value = usePos(); useEffect(() => { holder.current = value }); return null }
const notify = vi.fn()
const onOpenDraftOrder = vi.fn()
const renderPanel = () => render(<PosProvider><CashSessionProvider><Probe /><CartPanel notify={notify} onOpenDraftOrder={onOpenDraftOrder} onGoToCash={() => {}} /></CashSessionProvider></PosProvider>)
beforeEach(() => { notify.mockReset(); onOpenDraftOrder.mockReset() })

describe('CartPanel — selector de modo visible', () => {
  it('en escritorio los tres modos están a la vista sin abrir ningún menú y Venta directa cambia el modo', async () => {
    const { container } = renderPanel()
    await waitFor(() => expect(holder.current).toBeTruthy())
    expect(container.querySelector('.cart-operation-menu')).toBeNull()
    expect(container.querySelector('[data-pos-action="mode-venta"]')).toBeTruthy()
    expect(container.querySelector('[data-pos-action="mode-traslado"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Venta directa de almacén' }).getAttribute('title')).toBe('Venta directa (Alt+R)')
    fireEvent.click(screen.getByRole('button', { name: 'Venta directa de almacén' }))
    expect(pos().mode).toBe('ventaDirecta')
  })

  it('en celular se conserva el menú «⋯» y no hay control visible', async () => {
    celular.value = true
    const { container } = renderPanel()
    await waitFor(() => expect(holder.current).toBeTruthy())
    expect(screen.getByLabelText('Cambiar modo de operación')).toBeTruthy()
    expect(container.querySelector('.modo-group-visible')).toBeNull()
    expect(container.querySelectorAll('.cart-operation-menu [data-pos-action^="mode-"]')).toHaveLength(3)
  })
})

describe('CartPanel — disponibilidad de Almacén en venta directa', () => {
  const entrarEnVtd = async () => {
    renderPanel()
    await waitFor(() => expect(holder.current).toBeTruthy())
    act(() => { pos().setMode('ventaDirecta'); pos().setVtdUbicacionId(31); pos().addProduct(product(998, 'Cuaderno', 5)) })
    await screen.findByText('Cuaderno')
  }
  const fila = () => screen.getByText('Cuaderno').closest('article') as HTMLElement

  it('una línea que cabe muestra «Almacén: N disp.» y el botón sigue habilitado', async () => {
    await entrarEnVtd()
    expect(await screen.findByText('Almacén: 5 disp.')).toBeTruthy()
    expect(fila().className).not.toContain('cart-item-error')
    expect((screen.getByRole('button', { name: /Solicitar a Almacén/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('una línea que excede muestra el aviso ámbar con las reservas, sin estado de error, y el botón sigue habilitado', async () => {
    vi.mocked(getStockBySucursalBatch).mockResolvedValue(new Map([[998, stockAlmacen(5, 2)]]))
    await entrarEnVtd()
    await screen.findByText('Almacén: 5 disp.')
    for (let i = 0; i < 5; i++) fireEvent.click(within(fila()).getByRole('button', { name: 'Aumentar cantidad' }))
    expect(await screen.findByText('Almacén registra 5. Puede faltar. (2 reservadas para pedidos)')).toBeTruthy()
    expect(fila().className).not.toContain('cart-item-error')
    expect(fila().querySelector('.cart-almacen-disp-aviso')).toBeTruthy()
    expect((screen.getByRole('button', { name: /Solicitar a Almacén/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('mientras no llega el stock no muestra nada, y en modo venta tampoco', async () => {
    vi.mocked(getStockBySucursalBatch).mockReturnValue(new Promise(() => {}))
    await entrarEnVtd()
    expect(fila().textContent).not.toContain('Almacén')
    act(() => { pos().setMode('venta') })
    expect(fila().textContent).not.toContain('Almacén')
  })
})

describe('CartPanel — QR tras solicitar a Almacén', () => {
  const solicitar = async () => {
    renderPanel()
    await waitFor(() => expect(holder.current).toBeTruthy())
    act(() => { pos().setMode('ventaDirecta'); pos().setVtdUbicacionId(31); pos().addProduct(product(998, 'Cuaderno')) })
    await screen.findByText('Cuaderno')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Solicitar a Almacén/ })) })
  }

  it('abre el ticket de la VTD creada', async () => {
    almacenMock.createRequest.mockResolvedValue([13])
    vi.mocked(ventaDirectaService.getById).mockResolvedValue(venta as never)
    await solicitar()
    expect(ventaDirectaService.getById).toHaveBeenCalledWith('13')
    expect(await screen.findByRole('dialog', { name: 'Ticket de venta directa' })).toBeTruthy()
  })

  it('si no se puede leer la VTD no muestra error: avisa que abra Ver QR y la operación sigue', async () => {
    almacenMock.createRequest.mockImplementation(async () => { act(() => { pos().setMode('venta') }); return [13] })
    vi.mocked(ventaDirectaService.getById).mockRejectedValue(new Error('sin red'))
    await solicitar()
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Solicitud creada. Abre Ver QR para imprimir.'))
    expect(screen.queryByRole('dialog', { name: 'Ticket de venta directa' })).toBeNull()
    expect(screen.queryAllByRole('alert').filter((el) => /VTD|QR|solicitud/i.test(el.textContent ?? ''))).toEqual([])
    expect(pos().mode).toBe('venta')
  })

  it('si la solicitud falla no busca la VTD ni abre nada', async () => {
    almacenMock.createRequest.mockResolvedValue([])
    await solicitar()
    expect(ventaDirectaService.getById).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Ticket de venta directa' })).toBeNull()
  })
})

describe('CartPanel — un solo botón de cotización fuera de retail', () => {
  it('en mayoreo hay un único botón «Crear cotización» y abre el borrador', async () => {
    renderPanel()
    await waitFor(() => expect(holder.current).toBeTruthy())
    act(() => { pos().setChannel('mayoreo'); pos().addProduct(product(998, 'Cuaderno')) })
    await screen.findByText('Cuaderno')
    expect(screen.getAllByRole('button', { name: 'Crear cotización' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Cotización' })).toBeNull()
    // El botón «Guardar» del pie (otro modal) no se toca.
    expect(screen.getByRole('button', { name: 'Guardar borrador' }).textContent).toBe('Guardar')
    expect(document.querySelectorAll('.draft-button')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Crear cotización' }))
    expect(onOpenDraftOrder).toHaveBeenCalledTimes(1)
  })
})
