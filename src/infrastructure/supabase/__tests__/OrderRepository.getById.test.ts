import { describe, expect, it, vi } from 'vitest'

// Brief: el select('*') de pedido_evento no filtra por `accion` — además de
// ANULADO/RESTAURADO también trae LINEA_RECHAZADA/LINEA_CAMBIADA/LINEA_RETIRADA/
// LINEAS_AGREGADAS (eventos que Almacén dispara). El ternario viejo
// (accion === 'ANULADO' ? 'anulado' : 'restaurado') etiquetaba cualquiera de esos
// eventos de línea como "Pedido restaurado" — dato falso en el historial. Este test
// mockea el cliente de Supabase (sin tocar la base real) para verificar que
// fetchOrderById (vía getById) etiqueta cada `accion` correctamente, y que una línea
// CAMBIADA trae el resumen de a qué se cambió (reemplazada_por_id resuelto anidado).
const header = {
  id: 501, numero: 'PED-2026-00501', categoria: 'MAYOR', referencia: null, estado: 'ABIERTO',
  creado_por: null, creado_en: '2026-08-01T00:00:00Z', cliente_id: null, subtotal: 900,
  descuento_general: 0, total: 900, cliente: null, solicitante_id: null, solicitado_por: null,
  condicion_pago: null, medio_pago: null, alerta_lineas_en: null, alerta_lineas_vista_en: null,
}

const lines = [
  {
    id: 1, pedido_id: 501, producto_id: 10, cantidad_base: 2, estado: 'CAMBIADA', cantidad_despachada: null,
    sucursal_origen_id: null, es_personalizado: false, descripcion: null, nota: null, precio_lista: null,
    precio_unitario: 450, descuento_pct: 0, precio_modificado: false, modificado_por: null, modificado_en: null,
    subtotal: 900, producto: { nombre: 'Producto Viejo', sku_interno: 'P-VIEJO' }, presentacion_id: null,
    cantidad_presentacion: null, presentacion: null,
    reemplazada_por: { id: 2, cantidad_base: 3, cantidad_presentacion: null, es_personalizado: false, descripcion: null, producto: { nombre: 'Producto Nuevo' } },
  },
]

const eventos = [
  { id: 1, accion: 'LINEA_RECHAZADA', motivo: 'Sin stock', estado_previo: null, usuario: 'almacen@cation', creado_en: '2026-08-05T00:00:00Z' },
  { id: 2, accion: 'ANULADO', motivo: 'Cliente canceló', estado_previo: 'ABIERTO', usuario: 'vendedor@cation', creado_en: '2026-08-06T00:00:00Z' },
]

const pedidoBuilder = { select: () => pedidoBuilder, eq: () => pedidoBuilder, maybeSingle: () => Promise.resolve({ data: header, error: null }) }
const lineaBuilder = { select: () => lineaBuilder, eq: () => Promise.resolve({ data: lines, error: null }) }
const eventoBuilder = { select: () => eventoBuilder, eq: () => eventoBuilder, order: () => Promise.resolve({ data: eventos, error: null }) }

vi.mock('../supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'pedido') return pedidoBuilder
      if (table === 'pedido_linea') return lineaBuilder
      if (table === 'pedido_evento') return eventoBuilder
      throw new Error(`tabla inesperada en el mock: ${table}`)
    },
  },
}))

describe('SupabaseOrderRepository.getById — historial y reemplazo de línea', () => {
  it('etiqueta LINEA_RECHAZADA como "Línea rechazada", nunca "Pedido restaurado"', async () => {
    const { orderRepository } = await import('../OrderRepository.supabase')
    const order = await orderRepository.getById('501')
    const rechazo = order?.events.find((e) => e.detail.includes('Sin stock'))
    expect(rechazo?.label).toBe('Línea rechazada')
    expect(rechazo?.label).not.toBe('Pedido restaurado')
  })

  it('sigue etiquetando ANULADO/RESTAURADO con el detalle de estado_previo de siempre', async () => {
    const { orderRepository } = await import('../OrderRepository.supabase')
    const order = await orderRepository.getById('501')
    const anulado = order?.events.find((e) => e.label === 'Pedido anulado')
    expect(anulado?.detail).toBe('vendedor@cation · Cliente canceló · antes: Abierto')
  })

  it('una línea CAMBIADA trae el nombre y la cantidad de su reemplazo', async () => {
    const { orderRepository } = await import('../OrderRepository.supabase')
    const order = await orderRepository.getById('501')
    const linea = order?.lines[0]
    expect(linea?.lineStatus).toBe('CAMBIADA')
    expect(linea?.replacedByName).toBe('Producto Nuevo')
    expect(linea?.replacedByQuantity).toBe(3)
  })
})
