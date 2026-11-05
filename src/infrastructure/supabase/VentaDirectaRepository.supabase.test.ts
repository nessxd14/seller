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
    const error = await repo.anular('7', undefined, 'Error de cobro', { actorId: 'a' }).catch((e: unknown) => e)
    expect((error as { code?: string }).code).toBe('42501')
  })

  it('anular manda el motivo a anular_venta', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'x', code: 'P0001' } })
    await repo.anular('7', '3', 'Error de cobro', { actorId: 'a' }).catch(() => undefined)
    expect(rpc).toHaveBeenCalledWith('anular_venta', { p_venta_id: 7, p_usuario: 'a', p_sesion_caja_id: 3, p_motivo: 'Error de cobro' })
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

describe('RPC de la bandeja para VTD de Caja–Almacén', () => {
  it('infoCajaAlmacen traduce vtd_info y no consulta sin ventas', async () => {
    expect(await repo.infoCajaAlmacen([])).toEqual([])
    expect(rpc).not.toHaveBeenCalled()
    rpc.mockResolvedValue({ data: [{ venta_id: 7, caja_almacen: true, operacion_id: 'op', operacion_cerrada: false, turno_abierto: true, entrega: 'EN_CAJA', version: 2, faltante: null, lineas: [] }, { venta_id: 8, caja_almacen: false, operacion_id: null, operacion_cerrada: null, turno_abierto: null, entrega: null, version: null, faltante: null, lineas: null }], error: null })
    const filas = await repo.infoCajaAlmacen(['7', '8'])
    expect(rpc).toHaveBeenCalledWith('vtd_info', { p_venta_ids: [7, 8] })
    expect(filas[0]).toMatchObject({ ventaId: '7', cajaAlmacen: true, entrega: 'EN_CAJA', version: 2 })
    expect(filas[1]).toMatchObject({ ventaId: '8', cajaAlmacen: false, entrega: undefined, lineas: [] })
  })

  it('cobrarVtdBandeja llama a vtd_cobrar y traduce el comprobante', async () => {
    rpc.mockResolvedValue({ data: { id: 5, numero: 'CJA-1', total: 90, ventas: [7], cambio: 10, pagos: [{ metodo: 'EFECTIVO', monto: 50 }, { metodo: 'QR', monto: 40 }], reintento: true }, error: null })
    const r = await repo.cobrarVtdBandeja({ ventaId: '7', sesionCajaId: '3', pagos: [{ method: 'cash', amountCents: 5000, receivedCents: 6000 }, { method: 'qr', amountCents: 4000 }] }, { idempotencyKey: 'clave-1234' })
    expect(rpc).toHaveBeenCalledWith('vtd_cobrar', { p_venta_id: 7, p_pagos: [{ metodo: 'EFECTIVO', monto: 50, recibido: 60 }, { metodo: 'QR', monto: 40 }], p_sesion_id: 3, p_idempotencia: 'clave-1234' })
    expect(r).toMatchObject({ reintento: true, totalBs: 90, cambioBs: 10, pendienteVerificacion: true, sesionCajaId: '3' })
  })

  it('ajustar, rechazar y pago posterior envían los parámetros de sus RPC', async () => {
    rpc.mockResolvedValue({ data: {}, error: null })
    await repo.ajustarVtdBandeja('7', [{ linea_id: 1, cantidad_presentacion: 2 }], 'Falta material')
    expect(rpc).toHaveBeenLastCalledWith('vtd_ajustar', { p_venta_id: 7, p_lineas: [{ linea_id: 1, cantidad_presentacion: 2 }], p_motivo: 'Falta material', p_devolucion: null })
    await repo.rechazarVtdBandeja('7', 'Cliente se fue', true, '')
    expect(rpc).toHaveBeenLastCalledWith('vtd_rechazar', { p_venta_id: 7, p_motivo: 'Cliente se fue', p_devolucion_realizada: true, p_referencia: null })
    await repo.pagoPosteriorVtdBandeja('7', 'Paga el viernes', undefined)
    expect(rpc).toHaveBeenLastCalledWith('vtd_pago_posterior', { p_venta_id: 7, p_motivo: 'Paga el viernes', p_contacto: null })
  })

  it('propaga el mensaje de la base', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'La operación ya se cobró', code: 'P0001' } })
    await expect(repo.rechazarVtdBandeja('7', 'Cliente se fue', false, '')).rejects.toThrow('La operación ya se cobró')
  })
})
