import { beforeEach, describe, expect, it, vi } from 'vitest'
import { consultarCobrosPedidos, consultarDetalleCobroPedido } from '../CobroPedido.supabase'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../supabaseClient', () => ({ supabase: { rpc } }))
const row = { pedido_id: 1, estado: 'pagado', partidas: 2, total: '100.00', aplicado: '100.00', en_revision: '0', pendiente: '0', por_cobrar: '0' }
beforeEach(() => { rpc.mockReset() })

describe('consulta de cobro por pedido', () => {
  it('consulta por lotes sin usar el saldo global del cliente', async () => {
    rpc.mockResolvedValue({ data: [row], error: null })
    const result = await consultarCobrosPedidos(['1', '1', '2'])
    expect(rpc).toHaveBeenCalledWith('consultar_cobros_pedidos', { p_pedido_ids: [1, 2] })
    expect(result.get('1')).toMatchObject({ estado: 'pagado', totalCents: 10000, aplicadoCents: 10000, partidas: 2 })
    expect(result.get('2')?.estado).toBe('no_disponible')
  })
  it('una caída en un lote no oculta los cobros de otro', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Sin conexión' } }).mockResolvedValueOnce({ data: [{ ...row, pedido_id: 201 }], error: null })
    const result = await consultarCobrosPedidos(Array.from({ length: 201 }, (_, i) => String(i + 1)))
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(result.get('1')?.estado).toBe('no_disponible')
    expect(result.get('201')?.estado).toBe('pagado')
  })
  it.each([
    { ...row, total: null }, { ...row, pendiente: 'NaN' }, { ...row, aplicado: '' },
    { ...row, aplicado: '99' }, { ...row, en_revision: '10' }, { ...row, partidas: 0 },
    { ...row, pendiente: '10' }, { ...row, estado: 'inventado' },
  ])('nunca muestra pagado ante una respuesta incompleta o contradictoria: %j', async bad => {
    rpc.mockResolvedValue({ data: [bad], error: null })
    expect((await consultarCobrosPedidos(['1'])).get('1')?.estado).toBe('no_disponible')
  })
  it('conserva el estado no disponible si falta la RPC o falla la red', async () => {
    rpc.mockRejectedValue(new Error('Offline'))
    expect((await consultarCobrosPedidos(['1'])).get('1')?.estado).toBe('no_disponible')
  })
  it('conserva el contador de partidas saldadas y rechaza conteos incompatibles', async () => {
    rpc.mockResolvedValueOnce({ data: [{ ...row, partidas_saldadas: 2 }], error: null })
    expect((await consultarCobrosPedidos(['1'])).get('1')?.partidasSaldadas).toBe(2)
    rpc.mockResolvedValueOnce({ data: [{ ...row, partidas_saldadas: 1 }], error: null })
    expect((await consultarCobrosPedidos(['1'])).get('1')?.estado).toBe('no_disponible')
  })
  it('explica que falta activar el detalle cuando la API no está instalada', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
    await expect(consultarDetalleCobroPedido('1')).rejects.toThrow(/pendiente de activar/)
  })
})
