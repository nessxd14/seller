import { describe, expect, it, vi } from 'vitest'

// Brief: list() traía hasta 200 cabeceras de cotizacion y despues, en un solo pedido sin
// paginar, TODAS las lineas de esas cabeceras via .in('cotizacion_id', ids). Sin
// .range() explicito, PostgREST recorta en silencio a 1.000 filas — con 145+
// cotizaciones reales la suma de sus lineas ya supera eso, y las que caen del lado
// cortado llegan a React con `lines: []`. Este test verifica, mockeando el cliente de
// Supabase (sin tocar la base real), que (1) totalCents/subtotalCents salen de
// header.total/header.subtotal — no de sumar `lines` — asi que una cabecera con lineas
// "perdidas" en el recorte sigue mostrando su total real, y (2) el fetch de lineas pide
// explicitamente un .range() que levanta el tope default de 1.000.
const headers = [
  { id: 148, numero: 'COT-2026-00148', cliente_id: null, categoria: 'MAYOR', referencia: null, estado: 'BORRADOR', subtotal: 900, descuento_general: 0, total: 900, notas: null, vigencia_hasta: null, version: 1, creado_por: null, creado_en: '2026-08-01T00:00:00Z', actualizado_en: null, cliente: null, asunto: null, condicion_pago: null, medio_pago: null, fecha: null, solicitante_id: null, solicitado_por: null },
  { id: 150, numero: 'COT-2026-00150', cliente_id: null, categoria: 'MAYOR', referencia: null, estado: 'BORRADOR', subtotal: 1218, descuento_general: 0, total: 1218, notas: null, vigencia_hasta: null, version: 1, creado_por: null, creado_en: '2026-08-02T00:00:00Z', actualizado_en: null, cliente: null, asunto: null, condicion_pago: null, medio_pago: null, fecha: null, solicitante_id: null, solicitado_por: null },
]

const rangeSpy = vi.fn()

const headerBuilder = {
  select: () => headerBuilder,
  eq: () => headerBuilder,
  gte: () => headerBuilder,
  lte: () => headerBuilder,
  ilike: () => headerBuilder,
  order: () => headerBuilder,
  range: () => Promise.resolve({ data: headers, error: null, count: headers.length }),
}

const lineaBuilder = {
  select: () => lineaBuilder,
  in: () => lineaBuilder,
  // Lineas simuladas como si el tope de 1.000 filas de PostgREST ya hubiera cortado
  // TODAS las lineas de ambas cotizaciones (el caso real confirmado en producción) —
  // el total de la lista no debe depender de esto.
  range: (...args: unknown[]) => { rangeSpy(...args); return Promise.resolve({ data: [], error: null }) },
}

vi.mock('../supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'cotizacion') return headerBuilder
      if (table === 'cotizacion_linea') return lineaBuilder
      throw new Error(`tabla inesperada en el mock: ${table}`)
    },
  },
}))

describe('SupabaseQuoteRepository.list — total de la lista no depende de `lines`', () => {
  it('totalCents/subtotalCents vienen del header aunque las lineas hayan quedado recortadas', async () => {
    const { quoteRepository } = await import('../QuoteRepository.supabase')
    const { items } = await quoteRepository.list({ page: { page: 1, pageSize: 50 } })

    const cot148 = items.find((q) => q.number === 'COT-2026-00148')
    const cot150 = items.find((q) => q.number === 'COT-2026-00150')
    expect(cot148?.lines).toEqual([])
    expect(cot148?.totalCents).toBe(90000)
    expect(cot148?.subtotalCents).toBe(90000)
    expect(cot150?.totalCents).toBe(121800)
    expect(cot150?.subtotalCents).toBe(121800)
  })

  it('pide un .range() explicito al traer las lineas, para levantar el tope default de 1.000 filas', async () => {
    const { quoteRepository } = await import('../QuoteRepository.supabase')
    rangeSpy.mockClear()
    await quoteRepository.list({ page: { page: 1, pageSize: 50 } })
    expect(rangeSpy).toHaveBeenCalledWith(0, 9999)
  })
})
