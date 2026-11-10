// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { QuoteDraft } from '../../application/shared/models'
import type { Product } from '../../types'
import type { PrecioSugerido } from '../../infrastructure/supabase/PreciosRepository.supabase'
import { getStockByProduct, getStockByProductsBatch } from '../../infrastructure/services'
import { precioSugerido, precioSugeridoLote } from '../../infrastructure/supabase/PreciosRepository.supabase'
import { DraftOrderEditor } from './DraftOrderEditor'

// Modo Supabase: abrir un documento pide el stock y el precio sugerido UNA vez, sin importar
// cuántas líneas tenga; agregar un producto pide solo lo de la línea nueva.

const producto4 = {
  id: 4, sku: 'P4', codigoBarra: '', codigoFabrica: '', nombre: 'Producto 4', descripcion: '', categoria: '', imagen: '', color: '',
  precioRetail: 10, precioMayoreo: 10, precioInstitucional: 10, precioCorporativo: 10, stockTienda: 0, stockAlmacen: 0,
} as Product

vi.mock('../../config/featureFlags', () => ({ featureFlags: { supabase: true } }))
vi.mock('../../infrastructure/services', () => ({
  customerService: { list: vi.fn().mockResolvedValue([]) },
  productRepository: { search: vi.fn(async () => ({ items: [producto4], total: 1 })), getById: vi.fn().mockResolvedValue(null) },
  getStockByProduct: vi.fn(),
  getStockByProductsBatch: vi.fn(),
  getDisponibilidadPedido: vi.fn().mockResolvedValue({}),
  listPresentations: vi.fn().mockResolvedValue([]),
  listLineIdentifiers: vi.fn().mockResolvedValue({}),
  authSessionProvider: { getSession: vi.fn().mockResolvedValue(null) },
}))
vi.mock('../../infrastructure/supabase/CatalogoLocal.supabase', () => ({
  catalogoLocal: { listo: () => false, asegurarCarga: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('../../infrastructure/supabase/PreciosRepository.supabase', () => ({ precioSugerido: vi.fn(), precioSugeridoLote: vi.fn() }))
vi.mock('../../infrastructure/supabase/ContactoCliente.supabase', () => ({ evaluarTope: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../infrastructure/hermes/client', () => ({ evaluarCredito: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../components/SaldoBadge', () => ({ SaldoBadge: () => null }))

const sugerido = (precio: number): PrecioSugerido => ({
  factor: 1,
  ultimoCliente: { precio, fecha: '2026-11-01', numero: 'V-1', fuente: 'VENTA' as never },
  categoria: null,
})

const line = (id: string, productId: string) => ({ id, productId, name: `Producto ${productId}`, sku: `P${productId}`, quantity: 1, unitPriceCents: 1000, discountBasisPoints: 0 })
const quote: QuoteDraft = {
  id: 'q1', number: 'COT-1', customerId: '5', customerName: 'Cliente', channel: 'mayoreo', status: 'draft', conditionPago: 'CONTADO',
  validUntil: '', terms: '', notes: '', generalDiscountCents: 0, createdAt: '',
  lines: [line('a', '1'), line('b', '2'), line('c', '3')],
}
const abrir = () => render(<DraftOrderEditor quote={quote} isExistingQuote onClose={() => {}} onSave={vi.fn()} />)

beforeEach(() => {
  vi.mocked(getStockByProductsBatch).mockReset().mockImplementation(async (ids: number[]) => new Map(ids.map((id) => [id, []])))
  vi.mocked(precioSugeridoLote).mockReset().mockImplementation(async (lineas) => lineas.map(() => sugerido(111.11)))
})
afterEach(cleanup)

describe('DraftOrderEditor — lotes (modo Supabase)', () => {
  it('abrir una cotización con tres líneas hace una sola lectura de stock y un solo precio sugerido', async () => {
    abrir()
    await waitFor(() => expect(precioSugeridoLote).toHaveBeenCalledTimes(1))
    expect(precioSugeridoLote).toHaveBeenCalledWith(
      [{ productId: 1, presentacionId: undefined }, { productId: 2, presentacionId: undefined }, { productId: 3, presentacionId: undefined }],
      { clienteId: 5, categoria: expect.any(String) },
    )
    expect(getStockByProductsBatch).toHaveBeenCalledTimes(1)
    expect(getStockByProductsBatch).toHaveBeenCalledWith([1, 2, 3])
    expect(getStockByProduct).not.toHaveBeenCalled()
    expect(precioSugerido).not.toHaveBeenCalled()
  })

  it('agregar un cuarto producto pide el precio sugerido solo de la línea nueva', async () => {
    abrir()
    await waitFor(() => expect(precioSugeridoLote).toHaveBeenCalledTimes(1))
    const buscador = screen.getByLabelText('Buscar producto para agregar')
    fireEvent.change(buscador, { target: { value: 'producto 4' } })
    await waitFor(() => expect(screen.getAllByText('Producto 4').length).toBeGreaterThan(0))
    fireEvent.keyDown(buscador, { key: 'Enter' })
    await waitFor(() => expect(precioSugeridoLote).toHaveBeenCalledTimes(2))
    expect(vi.mocked(precioSugeridoLote).mock.calls[1][0]).toEqual([{ productId: 4, presentacionId: undefined }])
    expect(getStockByProductsBatch).toHaveBeenLastCalledWith([4])
    expect(getStockByProduct).not.toHaveBeenCalled()
  })

  it('una respuesta tardía de un canal anterior no se muestra', async () => {
    let liberarVieja: (r: PrecioSugerido[]) => void = () => {}
    vi.mocked(precioSugeridoLote)
      .mockImplementationOnce(() => new Promise<PrecioSugerido[]>((resolve) => { liberarVieja = resolve }))
      .mockImplementation(async (lineas) => lineas.map(() => sugerido(222.22)))
    abrir()
    await waitFor(() => expect(precioSugeridoLote).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: /Institucional/ }))
    await waitFor(() => expect(precioSugeridoLote).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getAllByText(/222[.,]22/).length).toBeGreaterThan(0))
    liberarVieja([sugerido(111.11), sugerido(111.11), sugerido(111.11)])
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryAllByText(/111[.,]11/)).toHaveLength(0)
    expect(screen.getAllByText(/222[.,]22/).length).toBeGreaterThan(0)
  })
})
