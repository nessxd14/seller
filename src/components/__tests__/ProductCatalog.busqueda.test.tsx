// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { PosProvider } from '../../context/PosContext'
import { ProductCatalog } from '../ProductCatalog'
import { getStockBySucursalBatch, productRepository } from '../../infrastructure/services'
import type { Product } from '../../types'

vi.mock('../../config/featureFlags', () => ({ featureFlags: { supabase: true } }))
vi.mock('../../infrastructure/services', () => ({
  productRepository: { search: vi.fn() },
  listBrands: vi.fn().mockResolvedValue({ marcas: [], sinMarca: 0 }),
  listFrecuentes: vi.fn().mockResolvedValue([]),
  listPresentations: vi.fn().mockResolvedValue([]),
  getStockBySucursalBatch: vi.fn(),
}))

afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks() })

const product = (id: number, nombre: string): Product => ({
  id, sku: `SKU-${id}`, codigoBarra: '', codigoFabrica: '', nombre, descripcion: '', categoria: '', imagen: '', color: '',
  precioRetail: 10, precioMayoreo: 10, precioInstitucional: 10, precioCorporativo: 10, stockTienda: 0, stockAlmacen: 0,
} as Product)
const pagina = (items: Product[]) => ({ items, page: 1, pageSize: 60, total: items.length })
const stockDe = (tienda: number) => ({ tienda, almacen: 0, tiendaLibre: false, almacenLibre: false, tiendaVendible: tienda, almacenVendible: 0, tiendaReservado: 0, almacenReservado: 0, tiendaMotivo: null, almacenMotivo: null })

const montar = (search: string) => <PosProvider><ProductCatalog search={search} category="Todos" setCategory={() => {}} /></PosProvider>

describe('ProductCatalog — búsqueda sin parpadeo', () => {
  it('una segunda búsqueda pendiente no quita los productos que ya están en pantalla', async () => {
    let resolverSegunda: (value: ReturnType<typeof pagina>) => void = () => {}
    vi.mocked(productRepository.search)
      .mockResolvedValueOnce(pagina([product(1, 'Papel Bond')]))
      .mockImplementationOnce(() => new Promise((resolve) => { resolverSegunda = resolve }))
    vi.mocked(getStockBySucursalBatch).mockResolvedValue(new Map([[1, stockDe(4)]]))

    const { rerender, container } = render(montar('pap'))
    expect(await screen.findByText('Papel Bond')).toBeTruthy()

    rerender(montar('papel'))
    await waitFor(() => expect(productRepository.search).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Papel Bond')).toBeTruthy()
    expect(screen.queryByText('Buscando productos…')).toBeNull()
    expect(container.querySelector('.product-grid')?.getAttribute('aria-busy')).toBe('true')

    await act(async () => { resolverSegunda(pagina([product(2, 'Papel Carta')])) })
    expect(await screen.findByText('Papel Carta')).toBeTruthy()
    expect(container.querySelector('.product-grid')?.getAttribute('aria-busy')).toBe('false')
  })

  it('muestra el indicador solo cuando todavía no hay nada que mostrar', async () => {
    vi.mocked(productRepository.search).mockImplementation(() => new Promise(() => {}))
    render(montar(''))
    expect(await screen.findByText('Buscando productos…')).toBeTruthy()
  })

  it('el stock se pide una vez por producto: cambiar la búsqueda no repite lo ya leído', async () => {
    vi.mocked(productRepository.search)
      .mockResolvedValueOnce(pagina([product(1, 'Papel Bond')]))
      .mockResolvedValueOnce(pagina([product(1, 'Papel Bond'), product(2, 'Papel Carta')]))
    vi.mocked(getStockBySucursalBatch).mockImplementation(async (ids: number[]) => new Map(ids.map((id) => [id, stockDe(id * 10)])))

    const { rerender } = render(montar('pap'))
    await waitFor(() => expect(getStockBySucursalBatch).toHaveBeenCalledTimes(1), { timeout: 2000 })
    expect(vi.mocked(getStockBySucursalBatch).mock.calls[0][0]).toEqual([1])
    expect(await screen.findByText(/10 en tienda/)).toBeTruthy()

    rerender(montar('papel'))
    await waitFor(() => expect(getStockBySucursalBatch).toHaveBeenCalledTimes(2), { timeout: 2000 })
    expect(vi.mocked(getStockBySucursalBatch).mock.calls[1][0]).toEqual([2])
    expect(await screen.findByText(/20 en tienda/)).toBeTruthy()
    expect(screen.getByText(/10 en tienda/)).toBeTruthy()
  })
})
