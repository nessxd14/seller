import { describe, expect, it, vi } from 'vitest'

// Brief (dos rondas): Supabase aplica un tope propio de 1.000 filas (db-max-rows) a
// nivel de proyecto que ningún .range() del cliente puede levantar. Con 147+
// cotizaciones reales y ~1.120 líneas combinadas, list() nunca puede traer todas las
// líneas de una sola vez pidiéndolas en bloque vía .in('cotizacion_id', ids) — y de
// todos modos no las necesita: el total de la lista viene de header.total/subtotal
// (ronda anterior). Esta ronda elimina ese segundo pedido por completo: list() arma
// cada item con `lines: []` y nunca consulta cotizacion_linea. Quien necesite las
// líneas reales de una cotización puntual las trae fresco por su propio id
// (getById/fetchQuoteById, nunca sujeto a este límite — ver QuotationsPage.tsx).
const headers = [
  { id: 148, numero: 'COT-2026-00148', cliente_id: null, categoria: 'MAYOR', referencia: null, estado: 'BORRADOR', subtotal: 900, descuento_general: 0, total: 900, notas: null, vigencia_hasta: null, version: 1, creado_por: null, creado_en: '2026-08-01T00:00:00Z', actualizado_en: null, cliente: null, asunto: null, condicion_pago: null, medio_pago: null, fecha: null, solicitante_id: null, solicitado_por: null },
  { id: 150, numero: 'COT-2026-00150', cliente_id: null, categoria: 'MAYOR', referencia: null, estado: 'BORRADOR', subtotal: 1218, descuento_general: 0, total: 1218, notas: null, vigencia_hasta: null, version: 1, creado_por: null, creado_en: '2026-08-02T00:00:00Z', actualizado_en: null, cliente: null, asunto: null, condicion_pago: null, medio_pago: null, fecha: null, solicitante_id: null, solicitado_por: null },
]

const headerBuilder = {
  select: () => headerBuilder,
  eq: () => headerBuilder,
  gte: () => headerBuilder,
  lte: () => headerBuilder,
  ilike: () => headerBuilder,
  order: () => headerBuilder,
  range: () => Promise.resolve({ data: headers, error: null, count: headers.length }),
}

const fromSpy = vi.fn((table: string) => {
  if (table === 'cotizacion') return headerBuilder
  throw new Error(`tabla inesperada en el mock: ${table} — list() no debería consultarla`)
})

vi.mock('../supabaseClient', () => ({
  supabase: { from: (table: string) => fromSpy(table) },
}))

describe('SupabaseQuoteRepository.list — ya no trae líneas', () => {
  it('nunca consulta cotizacion_linea', async () => {
    const { quoteRepository } = await import('../QuoteRepository.supabase')
    await quoteRepository.list({ page: { page: 1, pageSize: 50 } })
    expect(fromSpy).not.toHaveBeenCalledWith('cotizacion_linea')
  })

  it('cada item se arma con lines: [] y totalCents/subtotalCents del header', async () => {
    const { quoteRepository } = await import('../QuoteRepository.supabase')
    const { items } = await quoteRepository.list({ page: { page: 1, pageSize: 50 } })

    const cot148 = items.find((q) => q.number === 'COT-2026-00148')
    const cot150 = items.find((q) => q.number === 'COT-2026-00150')
    expect(cot148?.lines).toEqual([])
    expect(cot148?.totalCents).toBe(90000)
    expect(cot148?.subtotalCents).toBe(90000)
    expect(cot150?.lines).toEqual([])
    expect(cot150?.totalCents).toBe(121800)
    expect(cot150?.subtotalCents).toBe(121800)
  })
})
