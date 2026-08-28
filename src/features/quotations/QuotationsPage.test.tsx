// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
const { quoteHeaderOnly, getByIdMock } = vi.hoisted(() => {
  const header: QuoteDraft = {
    id: '218', number: 'COT-2026-00218', customerId: 'c1', customerName: 'Cliente Uno', channel: 'mayoreo',
    status: 'draft', validUntil: '2026-09-01', terms: '', notes: '', generalDiscountCents: 0,
    createdAt: '2026-08-20T00:00:00Z', lines: [], totalCents: 90000, subtotalCents: 90000,
  }
  const withLines: QuoteDraft = {
    ...header,
    lines: [{ id: 'l1', productId: 'p1', name: 'Producto Fresco', sku: 'P1', quantity: 1, unitPriceCents: 90000, discountBasisPoints: 0 }],
  }
  return { quoteHeaderOnly: header, quoteWithLines: withLines, getByIdMock: vi.fn().mockResolvedValue(withLines) }
})

vi.mock('../../infrastructure/services', () => ({
  quoteService: { list: vi.fn().mockResolvedValue([quoteHeaderOnly]), getById: (id: string) => getByIdMock(id), save: vi.fn(), duplicate: vi.fn(), markConverted: vi.fn() },
  orderService: { save: vi.fn() },
  sensitiveOperations: { execute: vi.fn() },
  customerService: { list: vi.fn().mockResolvedValue([]) },
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

afterEach(cleanup)

describe('QuotationsPage — abrir por URL trae la cotización fresca', () => {
  it('/cotizaciones/218 muestra las líneas de getById, no las (vacías) de list()', async () => {
    window.history.pushState({}, '', '/cotizaciones/218')
    render(<QuotationsPage notify={() => {}} onOrderCreated={() => {}} />)

    await waitFor(() => expect(getByIdMock).toHaveBeenCalledWith('218'))
    expect((await screen.findAllByText('Producto Fresco')).length).toBeGreaterThan(0)

    window.history.pushState({}, '', '/')
  })
})
