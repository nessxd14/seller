import { describe, expect, it, vi } from 'vitest'

// Brief: mismo bug de fondo que en Cotizaciones (ver QuoteRepository.supabase.ts
// list()). Supabase aplica un tope propio de 1.000 filas (db-max-rows) a nivel de
// proyecto que ningún .range() del cliente puede levantar. Con 397+ pedidos reales y
// 1.422+ líneas combinadas, un .in('pedido_id', ids) sin paginar ya lo supera. list()
// deja de traer líneas por completo: cada item se arma con `lines: []` y el total sigue
// viniendo de header.total/subtotal (rowToOrderView ya lo hacía). Quien necesite las
// líneas reales de un pedido puntual las trae fresco por su propio id
// (getById/fetchOrderById — ver OrdersPage.tsx).
const headers = [
  { id: 501, numero: 'PED-2026-00501', categoria: 'MAYOR', referencia: null, estado: 'ABIERTO', creado_por: null, creado_en: '2026-08-01T00:00:00Z', cliente_id: null, subtotal: 900, descuento_general: 0, total: 900, cliente: null, solicitante_id: null, solicitado_por: null, condicion_pago: null, medio_pago: null, alerta_lineas_en: null, alerta_lineas_vista_en: null },
  { id: 503, numero: 'PED-2026-00503', categoria: 'MAYOR', referencia: null, estado: 'ABIERTO', creado_por: null, creado_en: '2026-08-02T00:00:00Z', cliente_id: null, subtotal: 1218, descuento_general: 0, total: 1218, cliente: null, solicitante_id: null, solicitado_por: null, condicion_pago: null, medio_pago: null, alerta_lineas_en: '2026-08-10T00:00:00Z', alerta_lineas_vista_en: null },
  // Alertado pero ya visto DESPUÉS de la última alerta — needsAttention debe ser false.
  { id: 505, numero: 'PED-2026-00505', categoria: 'MAYOR', referencia: null, estado: 'ABIERTO', creado_por: null, creado_en: '2026-08-03T00:00:00Z', cliente_id: null, subtotal: 500, descuento_general: 0, total: 500, cliente: null, solicitante_id: null, solicitado_por: null, condicion_pago: null, medio_pago: null, alerta_lineas_en: '2026-08-10T00:00:00Z', alerta_lineas_vista_en: '2026-08-11T00:00:00Z' },
]

const headerBuilder = {
  select: () => headerBuilder,
  eq: () => headerBuilder,
  in: () => headerBuilder,
  gte: () => headerBuilder,
  lte: () => headerBuilder,
  order: () => headerBuilder,
  range: () => Promise.resolve({ data: headers, error: null, count: headers.length }),
}

const fromSpy = vi.fn((table: string) => {
  if (table === 'pedido') return headerBuilder
  throw new Error(`tabla inesperada en el mock: ${table} — list() no debería consultarla`)
})

vi.mock('../supabaseClient', () => ({
  supabase: { from: (table: string) => fromSpy(table) },
}))

describe('SupabaseOrderRepository.list — ya no trae líneas', () => {
  it('nunca consulta pedido_linea', async () => {
    const { orderRepository } = await import('../OrderRepository.supabase')
    await orderRepository.list({ page: { page: 1, pageSize: 50 } })
    expect(fromSpy).not.toHaveBeenCalledWith('pedido_linea')
  })

  it('cada item se arma con lines: [] y totalCents/subtotalCents del header', async () => {
    const { orderRepository } = await import('../OrderRepository.supabase')
    const { items } = await orderRepository.list({ page: { page: 1, pageSize: 50 } })

    const ped501 = items.find((o) => o.number === 'PED-2026-00501')
    const ped503 = items.find((o) => o.number === 'PED-2026-00503')
    expect(ped501?.lines).toEqual([])
    expect(ped501?.totalCents).toBe(90000)
    expect(ped501?.subtotalCents).toBe(90000)
    expect(ped503?.lines).toEqual([])
    expect(ped503?.totalCents).toBe(121800)
    expect(ped503?.subtotalCents).toBe(121800)
  })

  it('needsAttention compara alerta_lineas_en contra alerta_lineas_vista_en', async () => {
    const { orderRepository } = await import('../OrderRepository.supabase')
    const { items } = await orderRepository.list({ page: { page: 1, pageSize: 50 } })

    expect(items.find((o) => o.number === 'PED-2026-00501')?.needsAttention).toBe(false)
    expect(items.find((o) => o.number === 'PED-2026-00503')?.needsAttention).toBe(true)
    expect(items.find((o) => o.number === 'PED-2026-00505')?.needsAttention).toBe(false)
  })
})
