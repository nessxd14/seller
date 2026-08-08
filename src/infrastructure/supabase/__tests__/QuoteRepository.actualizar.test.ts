import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuoteDraft } from '../../../application/shared/models'
import { ConflictError } from '../../../application/errors/AppError'

// Brief S7: la rama de edición de saveInternal usada a hacer tres llamadas HTTP
// separadas (delete de líneas, insert de líneas, update del encabezado) sin ninguna
// transacción que las uniera — si el update fallaba por versión desactualizada, el
// delete YA se había ejecutado y no había forma de deshacerlo desde el cliente. Cinco
// cotizaciones en producción quedaron así: encabezado correcto, cero líneas. El arreglo
// mueve las tres mutaciones a una sola llamada a la RPC actualizar_cotizacion
// (transaccional del lado de la base). Este test mockea el cliente de Supabase para
// verificar, sin tocar la base real, que (1) un error de versión de la RPC se traduce a
// ConflictError y (2) el único punto de mutación es esa llamada a rpc(...) — nunca un
// delete directo sobre cotizacion_linea.
const deleteSpy = vi.fn()
const rpcMock = vi.fn()
const fromMock = vi.fn((table: string) => {
  if (table === 'cotizacion') {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { id: 42, version: 3, estado: 'BORRADOR' }, error: null }),
        }),
      }),
    }
  }
  if (table === 'cotizacion_linea') {
    // Si saveInternal alguna vez vuelve a llamar delete() directamente sobre esta
    // tabla, este spy lo detecta — el test falla explícitamente en vez de dejar
    // pasar en silencio el mismo bug que causó la pérdida de líneas.
    return { delete: deleteSpy.mockReturnValue({ eq: () => Promise.resolve({ error: null }) }) }
  }
  throw new Error(`tabla inesperada en el mock: ${table}`)
})

vi.mock('../supabaseClient', () => ({
  supabase: {
    from: (table: string) => fromMock(table),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}))

const draft: QuoteDraft = {
  id: '42',
  number: 'COT-42',
  customerId: '',
  customerName: '',
  channel: 'mayoreo',
  status: 'draft',
  validUntil: '2026-09-01',
  terms: '',
  notes: '',
  generalDiscountCents: 0,
  createdAt: '2026-08-01T00:00:00Z',
  lines: [
    { id: 'l1', productId: '', name: 'Ítem', sku: '', quantity: 1, unitPriceCents: 1000, discountBasisPoints: 0, isCustomItem: true },
  ],
}

describe('SupabaseQuoteRepository.save (edición) — actualizar_cotizacion es transaccional', () => {
  beforeEach(() => {
    deleteSpy.mockClear()
    rpcMock.mockReset()
  })

  it('un error de versión desde la RPC se traduce a ConflictError, y nunca se llama a delete directo sobre cotizacion_linea', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'La cotización fue modificada por otra sesión' } })
    const { quoteRepository } = await import('../QuoteRepository.supabase')

    await expect(quoteRepository.save(draft, { actorId: 'test' })).rejects.toBeInstanceOf(ConflictError)

    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock.mock.calls[0][0]).toBe('actualizar_cotizacion')
    expect(deleteSpy).not.toHaveBeenCalled()
  })
})
