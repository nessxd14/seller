import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc, getSession } = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn() }))
vi.mock('./supabaseClient', () => ({ supabase: { rpc } }))
vi.mock('./SupabaseAuthSessionProvider', () => ({ supabaseAuthSessionProvider: { getSession } }))
import { anulacionRepository, resetPuedeAnularCache } from './AnulacionRepository.supabase'

beforeEach(() => {
  rpc.mockReset(); getSession.mockReset(); resetPuedeAnularCache()
  getSession.mockResolvedValue({ user: { id: 'u1', email: 'ness@x.com' } })
})

describe('puedeAnular', () => {
  it('cachea por usuario y reconsulta cuando cambia', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    expect(await anulacionRepository.puedeAnular()).toBe(true)
    expect(await anulacionRepository.puedeAnular()).toBe(true)
    expect(rpc).toHaveBeenCalledTimes(1)
    getSession.mockResolvedValue({ user: { id: 'u2', email: 'caja@x.com' } })
    rpc.mockResolvedValue({ data: false, error: null })
    expect(await anulacionRepository.puedeAnular()).toBe(false)
    expect(rpc).toHaveBeenCalledTimes(2)
  })
  it('no cachea un fallo', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    await expect(anulacionRepository.puedeAnular()).rejects.toThrow('boom')
    rpc.mockResolvedValueOnce({ data: true, error: null })
    expect(await anulacionRepository.puedeAnular()).toBe(true)
  })
  it('sin sesión es false', async () => {
    getSession.mockResolvedValue(null)
    expect(await anulacionRepository.puedeAnular()).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('RPC de anulación', () => {
  it('anular manda p_motivo y mapea el resultado', async () => {
    rpc.mockResolvedValue({ data: { venta_id: 5, estado: 'ANULADA', estado_previo: 'COMPLETADA', devuelto: '30', reintegro_sesion_id: 8, fuera_de_arqueo: false }, error: null })
    const r = await anulacionRepository.anular('5', 'Error de cobro')
    expect(rpc).toHaveBeenCalledWith('anular_venta', { p_venta_id: 5, p_usuario: 'ness@x.com', p_sesion_caja_id: null, p_motivo: 'Error de cobro' })
    expect(r).toMatchObject({ ventaId: '5', devuelto: 30, reintegroSesionId: '8', fueraDeArqueo: false })
  })
  it('solicitar, retirar, aprobar y rechazar usan sus RPC', async () => {
    rpc.mockResolvedValue({ data: { solicitud_id: 3, venta_id: 5, numero: 'VTA-1', estado: 'SOLICITADA' }, error: null })
    expect(await anulacionRepository.solicitar('5', 'Motivo claro')).toMatchObject({ solicitudId: '3', ventaId: '5' })
    expect(rpc).toHaveBeenLastCalledWith('solicitar_anulacion_venta', { p_venta_id: 5, p_motivo: 'Motivo claro' })
    rpc.mockResolvedValue({ data: {}, error: null })
    await anulacionRepository.retirar('3')
    expect(rpc).toHaveBeenLastCalledWith('retirar_solicitud_anulacion', { p_solicitud_id: 3 })
    await anulacionRepository.rechazar('3', 'No procede')
    expect(rpc).toHaveBeenLastCalledWith('rechazar_solicitud_anulacion', { p_solicitud_id: 3, p_nota: 'No procede' })
    rpc.mockResolvedValue({ data: { venta_id: 5, estado: 'ANULADA', solicitud_id: 3, devuelto: 0, fuera_de_arqueo: true }, error: null })
    expect(await anulacionRepository.aprobar('3')).toMatchObject({ solicitudId: '3', fueraDeArqueo: true })
    expect(rpc).toHaveBeenLastCalledWith('aprobar_solicitud_anulacion', { p_solicitud_id: 3, p_nota: null })
  })
  it('propaga el mensaje en español de la base', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Solo Ness o el gerente pueden anular', code: '42501' } })
    await expect(anulacionRepository.anular('5', 'Motivo claro')).rejects.toThrow('Solo Ness o el gerente pueden anular')
  })
  it('listar usa SOLICITADA por defecto, null para todos, y mapea filas', async () => {
    rpc.mockResolvedValue({ data: [{ id: 1, venta_id: 5, numero: 'VTA-1', total: '40', venta_estado: 'COMPLETADA', estado: 'SOLICITADA', motivo: 'x', solicitada_en: 't', sesion_cobro_id: 7, sesion_cobro_abierta: true, cobrado: '40' }], error: null })
    const rows = await anulacionRepository.listar()
    expect(rpc).toHaveBeenLastCalledWith('listar_solicitudes_anulacion', { p_estado: 'SOLICITADA', p_limite: 50 })
    expect(rows[0]).toMatchObject({ id: '1', ventaId: '5', total: 40, sesionCobroAbierta: true, sesionCobroId: '7', cobrado: 40 })
    await anulacionRepository.listar(null, 20)
    expect(rpc).toHaveBeenLastCalledWith('listar_solicitudes_anulacion', { p_estado: null, p_limite: 20 })
  })
})
