// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { QuoteDraft } from '../../application/shared/models'
import { QuotationsPage } from './QuotationsPage'

// Brief: list() ya no trae líneas (tope propio de 1.000 filas de Supabase a nivel de
// proyecto, que ningún .range() del cliente puede levantar), así que abrir una
// cotización puntual por URL (recarga directa en /cotizaciones/:id, o el botón
// "Editar"/"Ver" de la fila) ya no puede reusar el objeto que trajo list() — siempre
// tendría lines: []. Este test simula justo ese escenario: quoteService.list()
// devuelve la cabecera con lines: [] (como en producción tras el brief anterior) y
// quoteService.getById() devuelve las líneas reales — el editor debe mostrar las de
// getById, nunca las de list().
const { quoteHeaderOnly, quoteWithLines, getByIdMock, duplicateMock, saveMock, orderSaveMock } = vi.hoisted(() => {
  const header: QuoteDraft = {
    id: '218', number: 'COT-2026-00218', customerId: 'c1', customerName: 'Cliente Uno', channel: 'mayoreo',
    status: 'draft', conditionPago: 'CONTADO', version: 3, validUntil: '2026-09-01', terms: '', notes: '', generalDiscountCents: 0,
    createdAt: '2026-08-20T00:00:00Z', lines: [], totalCents: 90000, subtotalCents: 90000,
  }
  const withLines: QuoteDraft = {
    ...header,
    lines: [{ id: 'l1', productId: 'p1', name: 'Producto Fresco', sku: 'P1', quantity: 1, unitPriceCents: 90000, discountBasisPoints: 0 }],
  }
  return { quoteHeaderOnly: header, quoteWithLines: withLines, getByIdMock: vi.fn(), duplicateMock: vi.fn(), saveMock: vi.fn(), orderSaveMock: vi.fn() }
})

vi.mock('../../infrastructure/services', () => ({
  quoteService: { list: vi.fn().mockResolvedValue([quoteHeaderOnly]), getById: (id: string) => getByIdMock(id), save: (quote: QuoteDraft) => saveMock(quote), duplicate: (id: string) => duplicateMock(id), markConverted: vi.fn() },
  orderService: { save: (...args: unknown[]) => orderSaveMock(...args) },
  sensitiveOperations: { execute: (_kind: string, _id: string, action: () => unknown) => action() },
  customerService: { list: vi.fn().mockResolvedValue([{ id: 'c2', name: 'Cliente Dos', type: 'wholesale', document: '', phone: '', email: '', address: '', usualChannel: 'mayoreo', paymentTerms: '' }]) },
  productRepository: { search: vi.fn().mockResolvedValue({ items: [], total: 0 }), getById: vi.fn().mockResolvedValue(null) },
  getStockByProduct: vi.fn().mockResolvedValue({}),
  listPresentations: vi.fn().mockResolvedValue([]),
  listLineIdentifiers: vi.fn().mockResolvedValue({}),
  authSessionProvider: { getSession: vi.fn().mockResolvedValue(null) },
}))
vi.mock('../../infrastructure/supabase/ContactoCliente.supabase', () => ({
  evaluarTope: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../infrastructure/hermes/client', () => ({
  evaluarCredito: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../config/featureFlags', () => ({ featureFlags: { supabase: true } }))
vi.mock('../../components/SaldoBadge', () => ({ SaldoBadge: () => null }))
vi.mock('../../infrastructure/supabase/PreciosRepository.supabase', () => ({ precioSugerido: vi.fn().mockResolvedValue(null) }))

beforeEach(() => {
  getByIdMock.mockReset().mockResolvedValue(quoteWithLines)
  duplicateMock.mockReset()
  saveMock.mockReset().mockImplementation(async (quote: QuoteDraft) => quote)
  orderSaveMock.mockReset().mockResolvedValue({})
  window.history.pushState({}, '', '/')
  localStorage.clear()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); window.history.pushState({}, '', '/') })

describe('QuotationsPage — duplicar y convertir la edición actual', () => {
  it('un doble clic crea una sola copia y abre el ID de la copia para editarla', async () => {
    const copy = {...quoteWithLines,id:'219',number:'COT-219',version:0}
    let resolveCopy!: (quote:QuoteDraft) => void
    duplicateMock.mockImplementation(() => new Promise<QuoteDraft>(resolve => {resolveCopy=resolve}))
    getByIdMock.mockResolvedValue(copy)
    render(<QuotationsPage notify={vi.fn()} onOrderCreated={vi.fn()} />)
    const button = await screen.findByTitle('Duplicar')
    act(() => { fireEvent.click(button); fireEvent.click(button) })
    expect(duplicateMock).toHaveBeenCalledTimes(1)
    await act(async () => { resolveCopy(copy) })
    await waitFor(() => expect(getByIdMock).toHaveBeenCalledWith('219'))
    expect(await screen.findByRole('dialog',{name:'Cotización COT-219'})).toBeTruthy()
  })
  it('muestra el error real al duplicar y permite reintentar', async () => {
    duplicateMock.mockRejectedValue({message:'No se pudo acceder a los contactos'})
    const notify = vi.fn()
    render(<QuotationsPage notify={notify} onOrderCreated={vi.fn()} />)
    fireEvent.click(await screen.findByTitle('Duplicar'))
    await waitFor(() => expect(notify).toHaveBeenCalledWith('No se pudo acceder a los contactos'))
    expect((screen.getByTitle('Duplicar') as HTMLButtonElement).disabled).toBe(false)
  })
  it('guarda el cliente cambiado antes de convertir el borrador en pedido', async () => {
    window.history.pushState({}, '', '/cotizaciones/218')
    vi.spyOn(window,'confirm').mockReturnValue(true)
    render(<QuotationsPage notify={vi.fn()} onOrderCreated={vi.fn()} />)
    const input = await screen.findByRole('textbox',{name:/Cliente/})
    fireEvent.focus(input)
    fireEvent.change(input,{target:{value:'Dos'}})
    fireEvent.click(await screen.findByRole('button',{name:/Cliente Dos/}))
    fireEvent.click(screen.getByRole('button',{name:'Convertir a pedido'}))
    await waitFor(() => expect(orderSaveMock).toHaveBeenCalledTimes(1))
    expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({id:'218',version:3,customerId:'c2',customerName:'Cliente Dos'}))
    expect(orderSaveMock).toHaveBeenCalledWith(expect.objectContaining({sourceQuoteId:'218',customerName:'Cliente Dos'}))
    expect(saveMock.mock.invocationCallOrder[0]).toBeLessThan(orderSaveMock.mock.invocationCallOrder[0])
  })
})

describe('QuotationsPage — abrir por URL trae la cotización fresca', () => {
  it('/cotizaciones/218 muestra las líneas de getById, no las (vacías) de list()', async () => {
    window.history.pushState({}, '', '/cotizaciones/218')
    render(<QuotationsPage notify={() => {}} onOrderCreated={() => {}} />)

    await waitFor(() => expect(getByIdMock).toHaveBeenCalledWith('218'))
    expect((await screen.findAllByText('Producto Fresco')).length).toBeGreaterThan(0)

    window.history.pushState({}, '', '/')
  })
})

// Brief: el botón del ojito ("Vista previa / exportar") pasaba la fila de la tabla tal
// cual a DocumentoExportable — con list() sin líneas, la vista previa/impresión
// siempre mostraba 0 ítems. Debe traer la cotización fresca por su propio id primero.
describe('QuotationsPage — vista previa trae la cotización fresca', () => {
  it('el botón del ojito muestra las líneas de getById, no las (vacías) de la fila de la lista', async () => {
    getByIdMock.mockClear()
    render(<QuotationsPage notify={() => {}} onOrderCreated={() => {}} />)

    const previewButton = await screen.findByTitle('Vista previa / exportar')
    fireEvent.click(previewButton)

    await waitFor(() => expect(getByIdMock).toHaveBeenCalledWith('218'))
    expect((await screen.findAllByText('Producto Fresco')).length).toBeGreaterThan(0)
  })
})
