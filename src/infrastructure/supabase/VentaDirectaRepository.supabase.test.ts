import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('./supabaseClient', () => ({ supabase: { rpc, from } }))
import { SupabaseVentaDirectaRepository } from './VentaDirectaRepository.supabase'

const repo = new SupabaseVentaDirectaRepository()
beforeEach(() => { rpc.mockReset(); from.mockReset() })

describe('VentaDirectaRepository — errores de la base (Brief Caja VTD obligatorio A5)', () => {
  it('completar muestra el mensaje del trigger tal cual aunque PostgREST devuelva un objeto plano', async () => {
    const message = 'VTD-2026-00007 no está cobrada. Cóbrala en caja antes de entregar, o márcala como pago posterior con motivo.'
    rpc.mockResolvedValue({ data: null, error: { message, code: 'P0001', details: null, hint: null } })
    const error = await repo.completar('7', { actorId: 'a' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(message)
  })

  it('conserva el code 42501 para que esErrorAutorizacion siga funcionando', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'no autorizado', code: '42501' } })
    const error = await repo.anular('7', undefined, { actorId: 'a' }).catch((e: unknown) => e)
    expect((error as { code?: string }).code).toBe('42501')
  })
})

describe('marcarPagoPosterior', () => {
  it('llama a marcar_vtd_pago_posterior con motivo y contacto', async () => {
    rpc.mockResolvedValue({ data: { venta_id: 7, numero: 'VTD-2026-00007', pago_posterior: true }, error: null })
    await repo.marcarPagoPosterior('7', 'Paga el viernes', 'Ana 7001')
    expect(rpc).toHaveBeenCalledWith('marcar_vtd_pago_posterior', { p_venta_id: 7, p_motivo: 'Paga el viernes', p_contacto: 'Ana 7001' })
  })

  it('manda p_contacto null cuando la venta tiene cliente', async () => {
    rpc.mockResolvedValue({ data: {}, error: null })
    await repo.marcarPagoPosterior('7', 'Paga el viernes', undefined)
    expect(rpc).toHaveBeenCalledWith('marcar_vtd_pago_posterior', expect.objectContaining({ p_contacto: null }))
  })

  it('propaga el rechazo de la RPC con su mensaje', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'El motivo debe tener al menos 5 caracteres', code: 'P0001' } })
    await expect(repo.marcarPagoPosterior('7', 'abc', undefined)).rejects.toThrow('El motivo debe tener al menos 5 caracteres')
  })
})

describe('listPorCobrar', () => {
  it('mapea las columnas de pago posterior de v_vtd_por_cobrar', async () => {
    from.mockReturnValue({ select: () => Promise.resolve({ error: null, data: [
      { venta_id: 1, numero: 'VTD-1', estado: 'ABIERTA', cliente_id: null, cliente_nombre: null, total: '10', creado_por: null, creado_en: 'x', sesion_creacion_id: 3, pago_posterior: true, pago_posterior_motivo: 'Paga mañana', pago_posterior_contacto: 'Ana 700' },
      { venta_id: 2, numero: 'VTD-2', estado: 'ABIERTA', cliente_id: null, cliente_nombre: null, total: '10', creado_por: null, creado_en: 'x', sesion_creacion_id: 3 },
    ] }) })
    const rows = await repo.listPorCobrar()
    expect(rows[0]).toMatchObject({ pagoPosterior: true, pagoPosteriorMotivo: 'Paga mañana', pagoPosteriorContacto: 'Ana 700' })
    expect(rows[1]).toMatchObject({ pagoPosterior: false, pagoPosteriorMotivo: undefined })
  })
})
