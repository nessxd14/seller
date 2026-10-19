// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { CartPanel } from '../CartPanel'
import { PosProvider, usePos } from '../../context/PosContext'
import { CashSessionProvider } from '../../context/CashSessionContext'

const listPresentations = vi.fn()
const listPorCobrar = vi.fn().mockResolvedValue([])
const cobrarVtd = vi.fn()

vi.mock('../../infrastructure/services', () => ({
  authSessionProvider: { getSession: vi.fn().mockResolvedValue({ user: { id: 'u1', role: 'cajero', active: true }, expiresAt: '2099-01-01' }) },
  turnoService: { getSesionAbierta: vi.fn().mockResolvedValue({ id: '1', cajeroId: 'u1' }) },
  cashService: { getOpenSession: vi.fn().mockResolvedValue({ id: '1', register: 'Caja Tienda', openedAt: new Date().toISOString(), openingCents: 0, status: 'open', movements: [] }) },
  transferService: { create: vi.fn() },
  ventaDirectaService: {
    getUbicacionVentasDirectas: vi.fn().mockResolvedValue(1),
    listAbiertas: vi.fn().mockResolvedValue([]),
    listPorCobrar: (...args: unknown[]) => listPorCobrar(...args),
    cobrarVtd: (...args: unknown[]) => cobrarVtd(...args),
    getById: vi.fn().mockResolvedValue(null),
  },
  borradorOperacionService: { save: vi.fn() },
  getStockBySucursalBatch: vi.fn().mockResolvedValue(new Map([[999, { tienda: 100, almacen: 100, tiendaLibre: false, almacenLibre: false, tiendaVendible: 100, almacenVendible: 100, tiendaReservado: 0, almacenReservado: 0, tiendaMotivo: null, almacenMotivo: null }]])),
  configService: { listSucursales: vi.fn().mockResolvedValue([]) },
  listPresentations: (...args: unknown[]) => listPresentations(...args),
}))

beforeEach(() => { sessionStorage.clear(); localStorage.clear() })
afterEach(cleanup)

const precios = (retail: number) => ({ retail, mayoreo: retail, institucional: retail, corporativo: retail })

function Seed() {
  const { addProduct } = usePos()
  useEffect(() => {
    addProduct({
      id: 999, sku: 'SKU-999', codigoBarra: '', codigoFabrica: '', nombre: 'Tuki', descripcion: '',
      categoria: '', imagen: '', color: '', precioRetail: 0.2, precioMayoreo: 0.2, precioInstitucional: 0.2, precioCorporativo: 0.2,
      stockTienda: 100, stockAlmacen: 100,
    } as never)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

const renderPos = () => render(<PosProvider><CashSessionProvider><Seed /><CartPanel notify={() => {}} onOpenDraftOrder={() => {}} onGoToCash={() => {}} /></CashSessionProvider></PosProvider>)

describe('CartItem — presentaciones habilitadas en tienda', () => {
  it('con la base deshabilitada en tienda arranca en la primera habilitada y no ofrece la base', async () => {
    listPresentations.mockResolvedValue([
      { id: 1, nombre: 'Hoja', factorUnidadBase: 1, esBase: true, precios: precios(0.2), tienePrecioPropio: false, vendeTienda: false, vendeAlmacen: true },
      { id: 7, nombre: 'PAQUETE', factorUnidadBase: 10, esBase: false, precios: precios(2.5), tienePrecioPropio: true, vendeTienda: true, vendeAlmacen: true },
      { id: 8, nombre: 'CAJA MASTER', factorUnidadBase: 240, esBase: false, precios: precios(50), tienePrecioPropio: true, vendeTienda: false, vendeAlmacen: true },
    ])
    renderPos()
    const select = await screen.findByRole('combobox', { name: 'Presentación Tuki' }) as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('7'))
    expect([...select.options].map((o) => o.textContent)).toEqual(['PAQUETE'])
    expect(screen.getByText(/Bs 2,50 c\/u/)).toBeTruthy()
  })

  it('con la base habilitada se queda en la base y oculta solo las deshabilitadas', async () => {
    listPresentations.mockResolvedValue([
      { id: 1, nombre: 'Hoja', factorUnidadBase: 1, esBase: true, precios: precios(0.2), tienePrecioPropio: false },
      { id: 7, nombre: 'PAQUETE', factorUnidadBase: 10, esBase: false, precios: precios(2.5), tienePrecioPropio: true },
      { id: 8, nombre: 'CAJA MASTER', factorUnidadBase: 240, esBase: false, precios: precios(50), tienePrecioPropio: true, vendeTienda: false },
    ])
    renderPos()
    const select = await screen.findByRole('combobox', { name: 'Presentación Tuki' }) as HTMLSelectElement
    await waitFor(() => expect([...select.options].map((o) => o.textContent)).toEqual(['Hoja', 'PAQUETE']))
    expect(select.value).toBe('1')
  })
})
