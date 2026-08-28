// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { QuoteDraft } from '../../application/shared/models'
import { DraftOrderEditor } from './DraftOrderEditor'

// Evita llamadas reales a Supabase/Hermes durante el test — solo importa que
// runAction no dispare onSave dos veces ante un doble clic.
vi.mock('../../infrastructure/services', () => ({
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

const baseQuote: QuoteDraft = {
  id: '',
  number: '',
  customerId: 'c1',
  customerName: 'Cliente Uno',
  channel: 'mayoreo',
  status: 'draft',
  validUntil: '',
  terms: '',
  notes: '',
  generalDiscountCents: 0,
  createdAt: '',
  lines: [
    { id: 'l1', productId: 'p1', name: 'Producto 1', sku: 'P1', quantity: 1, unitPriceCents: 1000, discountBasisPoints: 0 },
  ],
}

describe('DraftOrderEditor — candado de doble envío', () => {
  it('un doble clic muy rápido en "Guardar como cotización" llama a onSave una sola vez', async () => {
    let resolveSave: () => void = () => {}
    const onSave = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve }))
    render(<DraftOrderEditor quote={baseQuote} onClose={() => {}} onSave={onSave} />)

    const button = await screen.findByText('Guardar como cotización')
    // Ambos clics se disparan dentro del mismo `act()` síncrono, antes de que React
    // repinte `disabled`, para simular el doble clic/toque real que llega en el mismo
    // tick — si solo se probara con dos `fireEvent.click` separados, el primero ya
    // repintaría `disabled=true` antes del segundo y el test no probaría nada.
    act(() => {
      fireEvent.click(button)
      fireEvent.click(button)
    })

    expect(onSave).toHaveBeenCalledTimes(1)
    resolveSave()
  })
})
