import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown> & { id: number }
const state = vi.hoisted(() => ({ headers: [] as Row[], lines: [] as Row[], cap: 1000, failAfter: Infinity }))
const rpc = vi.hoisted(() => vi.fn())

vi.mock('../supabaseClient', () => ({
  supabase: {
    rpc,
    from: (table: string) => {
      let rows = table === 'solicitud_traslado' ? state.headers : state.lines
      let after = 0
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { rows = rows.filter((r) => r[key] === value); return query },
        in: (key: string, values: unknown[]) => { rows = rows.filter((r) => values.includes(r[key])); return query },
        gt: (_key: string, value: number) => { after = value; rows = rows.filter((r) => r.id > value); return query },
        lt: (_key: string, value: number) => { rows = rows.filter((r) => r.id < value); return query },
        order: (_key: string, { ascending }: { ascending: boolean }) => { rows = [...rows].sort((a, b) => ascending ? a.id - b.id : b.id - a.id); return query },
        limit: async (size: number) => after >= state.failAfter
          ? { data: null, error: new Error('No se pudo leer la siguiente página') }
          : { data: rows.slice(0, Math.min(size, state.cap)), error: null },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      }
      return query
    },
  },
}))

import { transferRepository } from '../TransferRepository.supabase'

const header = (id: number) => ({ id, numero: `TRA-${id}`, estado: id % 2 ? 'SOLICITADO' : 'RECIBIDO' })
const line = (id: number, solicitudId: number) => ({ id, solicitud_id: solicitudId, producto_id: id, cantidad_base: id, producto: { nombre: `Producto ${id}`, sku_interno: `SKU${id}` } })

beforeEach(() => {
  state.headers = [header(1), header(2)]
  state.lines = Array.from({ length: 1100 }, (_, i) => line(i + 1, i < 1060 ? 1 : 2))
  state.cap = 1000
  state.failAfter = Infinity
  rpc.mockReset()
})

describe('traslados: lectura completa pese al límite del servidor', () => {
  it('con 1100 líneas conserva los 40 productos del último traslado en la bandeja', async () => {
    const records = await transferRepository.list()
    expect(records.map((r) => r.id)).toEqual(['2', '1'])
    expect(records[0].lines).toHaveLength(40)
    expect(records[0].lines.at(-1)?.name).toBe('Producto 1100')
    expect(records[1].lines).toHaveLength(1060)
    expect(new Set(records.flatMap((r) => r.lines.map((l) => l.id))).size).toBe(1100)
  })

  it('pagina también el detalle individual usado para imprimir', async () => {
    const record = await transferRepository.getById('1')
    expect(record?.lines).toHaveLength(1060)
    expect(record?.lines.at(-1)?.cantidadBase).toBe(1060)
  })

  it('recorre cabeceras y lotes de ids incluso con un tope menor al solicitado', async () => {
    state.cap = 17
    state.headers = Array.from({ length: 121 }, (_, i) => header(i + 1))
    state.lines = state.headers.map((h) => line(h.id, h.id))
    const records = await transferRepository.list()
    expect(records).toHaveLength(121)
    expect(records.every((r) => r.lines.length === 1)).toBe(true)
    const requested = await transferRepository.list({ estado: 'SOLICITADO' })
    expect(requested).toHaveLength(61)
    expect(requested.every((r) => r.estado === 'SOLICITADO')).toBe(true)
  })

  it('un fallo en una página no devuelve un traslado incompleto como si estuviera listo', async () => {
    state.failAfter = 500
    await expect(transferRepository.getById('1')).rejects.toThrow('siguiente página')
    await expect(transferRepository.list()).rejects.toThrow('siguiente página')
  })

  it('envía todas las líneas en una sola operación y relee el documento completo', async () => {
    rpc.mockResolvedValue({ data: 1, error: null })
    const lines = Array.from({ length: 1060 }, (_, i) => ({ productId: String(i + 1), presentacionId: 8, cantidadPresentacion: i + 1 }))
    const created = await transferRepository.create({ motivo: 'REPOSICION', lines }, 'encargado')
    const payload = rpc.mock.calls[0][1].p_lineas
    expect(rpc).toHaveBeenCalledOnce()
    expect(payload).toHaveLength(1060)
    expect(payload.at(-1)).toEqual({ producto_id: 1060, presentacion_id: 8, cantidad_presentacion: 1060 })
    expect(created.lines).toHaveLength(1060)
  })

  it('acepta una bandeja vacía y un id inexistente', async () => {
    state.headers = []
    expect(await transferRepository.list()).toEqual([])
    expect(await transferRepository.getById('99')).toBeNull()
  })

  it('conserva el resultado del despacho, el estado de línea y los enlaces entre tandas', async () => {
    state.headers = [{ ...header(1), tanda_de_id: 8, numero_tanda: 3 }]
    state.lines = [{ ...line(11, 1), estado: 'CAMBIADA', reemplazada_por_id: 15 }]
    const result = { estado: 'CANCELADO', cantidad_despachada: 0, bloqueadas_por_stock: [{ linea_id: 11, pedido: 5, disponible: 0 }], tanda_faltante_id: 2 }
    rpc.mockResolvedValue({ data: result, error: null })
    const dispatched = await transferRepository.dispatch('1', 'QA', [{ lineaId: '11', accion: 'DESPACHAR', cantidadBase: 5 }])
    expect(dispatched.resultadoDespacho).toEqual(result)
    expect(dispatched.tandaDeId).toBe('8')
    expect(dispatched.lines[0]).toMatchObject({ estado: 'CAMBIADA', reemplazadaPorId: '15' })
    expect(rpc).toHaveBeenCalledWith('despachar_traslado', { p_solicitud_id: 1, p_usuario: 'QA', p_lineas: [{ linea_id: 11, accion: 'DESPACHAR', cantidad_base: 5 }] })
  })
})
