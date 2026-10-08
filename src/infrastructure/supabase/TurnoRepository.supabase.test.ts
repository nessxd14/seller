import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('./supabaseClient', () => ({ supabase: { rpc, from } }))
import { cerrarTurno, getResumenTurno, listMovimientosTurno, marcarCobroFueraDeArqueo } from './TurnoRepository.supabase'

const cierreOk = { data: { sesion_id: 4, estado: 'CERRADA' }, error: null }
const den = { '100': 1 }

beforeEach(() => { rpc.mockReset(); from.mockReset() })

describe('cerrarTurno — p_cajon_vacio', () => {
  it('no manda p_cajon_vacio si el cajero no marcó "El cajón está en cero"', async () => {
    rpc.mockResolvedValue(cierreOk)
    await cerrarTurno('4', den)
    await cerrarTurno('4', den, false)
    for (const call of rpc.mock.calls) {
      expect(call[0]).toBe('cerrar_turno')
      expect(call[1]).toEqual({ p_sesion_id: 4, p_denominaciones: den })
      expect(call[1]).not.toHaveProperty('p_cajon_vacio')
    }
  })

  it('manda p_cajon_vacio: true solo cuando está marcado', async () => {
    rpc.mockResolvedValue(cierreOk)
    await cerrarTurno('4', {}, true)
    expect(rpc).toHaveBeenCalledWith('cerrar_turno', { p_sesion_id: 4, p_denominaciones: {}, p_cajon_vacio: true })
  })

  it.each([
    'Conteo en cero: el sistema espera efectivo en el cajón. Si está vacío, márcalo.',
    'No puedes cerrar el turno: hay 2 VTD entregadas sin cobrar.',
  ])('muestra el mensaje de la base tal cual aunque PostgREST devuelva un objeto plano: %s', async (message) => {
    rpc.mockResolvedValue({ data: null, error: { message, code: 'P0001', details: null, hint: null } })
    const error = await cerrarTurno('4', den).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(message)
    expect((error as { code?: string }).code).toBe('P0001')
  })
})

describe('cobros fuera del arqueo', () => {
  it('marcarCobroFueraDeArqueo llama a la RPC con fuera = true por defecto', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await marcarCobroFueraDeArqueo('12')
    await marcarCobroFueraDeArqueo('12', false)
    expect(rpc).toHaveBeenNthCalledWith(1, 'marcar_cobro_fuera_de_arqueo', { p_movimiento_id: 12, p_fuera: true })
    expect(rpc).toHaveBeenNthCalledWith(2, 'marcar_cobro_fuera_de_arqueo', { p_movimiento_id: 12, p_fuera: false })
  })

  it('propaga el rechazo de la RPC (p. ej. un cajero) como Error con el mensaje original', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Solo gerente o admin', code: '42501' } })
    await expect(marcarCobroFueraDeArqueo('12')).rejects.toMatchObject({ message: 'Solo gerente o admin', code: '42501' })
  })

  it('listMovimientosTurno pide fuera_de_arqueo y lo mapea', async () => {
    const select = vi.fn().mockReturnValue({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ error: null, data: [
      { id: 1, tipo: 'ANTICIPO', subtipo: null, metodo: 'EFECTIVO', monto: 50, nota: null, creado_en: '2026-10-03T10:00:00Z', fuera_de_arqueo: true, cliente: null, pedido: null, venta: null, caja_gasto: null },
      { id: 2, tipo: 'ANTICIPO', subtipo: null, metodo: 'EFECTIVO', monto: 20, nota: null, creado_en: '2026-10-03T09:00:00Z', cliente: null, pedido: null, venta: null, caja_gasto: null },
    ] }) }) }) })
    from.mockImplementation((table: string) => table === 'saldo_cliente_uso'
      ? { select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) }
      : { select })
    const rows = await listMovimientosTurno('4')
    expect(select.mock.calls[0][0]).toContain('fuera_de_arqueo')
    expect(rows.map((r) => r.fueraDeArqueo)).toEqual([true, false])
  })

  it('incluye una compra totalmente cubierta con saldo, conservando el registro de efectivo separado', async () => {
    const cash = [{ id: 2, tipo: 'VENTA', metodo: 'EFECTIVO', monto: 30, creado_en: '2026-10-03T09:00:00Z', venta: { numero: 'VTA-2', cliente_acreedor: true, cliente: { nombre: 'Cliente acreedor' } } }]
    const balance = [{ id: 3, monto: 100, creado_en: '2026-10-03T10:00:00Z', anulado_en: null, venta: { numero: 'VTA-3' }, cliente: { nombre: 'Cliente acreedor' } }]
    from.mockImplementation((table: string) => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: table === 'saldo_cliente_uso' ? balance : cash, error: null }) }) }) }) }))
    const rows = await listMovimientosTurno('4')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: 'saldo-3', tipo: 'SALDO_FAVOR', montoBs: 100, clienteAcreedor: true, documento: 'VTA-3' })
    expect(rows[0].detalle).toContain('sin ingreso nuevo')
    expect(rows[1]).toMatchObject({ tipo: 'VENTA', metodo: 'EFECTIVO', montoBs: 30, clienteAcreedor: true, clienteNombre: 'Cliente acreedor' })
  })

  it('getResumenTurno mapea cobros_fuera_arqueo (0 si falta)', async () => {
    const base = { apertura: 0, ventas: {}, ventas_retail: {}, ventas_vtd: {}, cantidad_vtd_cobradas: 0, vtd_por_cobrar: null, anticipos: {}, anulaciones: {}, gastos: {}, remesas: 0, inyecciones: 0, cantidad_ventas: 0, pagos_pendientes_verificacion: 0, pagos_rechazados: [], diferencia_relevo: null, esperado_efectivo: null }
    rpc.mockResolvedValueOnce({ data: { ...base, cobros_fuera_arqueo: '75.5' }, error: null })
    rpc.mockResolvedValueOnce({ data: base, error: null })
    expect((await getResumenTurno('4')).cobrosFueraArqueoBs).toBe(75.5)
    expect((await getResumenTurno('4')).cobrosFueraArqueoBs).toBe(0)
  })
})


describe('detalle de productos del turno', () => {
  it('conserva la venta de VTA, VTD y saldo sin asociar gastos a una venta', async () => {
    const cash = [
      { id: 1, venta_id: 21, tipo: 'VENTA', venta: { numero: 'VTA-21' } },
      { id: 2, venta_id: 32, tipo: 'VENTA', venta: { numero: 'VTD-32' } },
      { id: 3, venta_id: null, tipo: 'EGRESO', venta: null },
    ].map(row => ({ ...row, monto: 10, metodo: 'EFECTIVO', creado_en: '2026-10-08T10:00:00Z' }))
    const balance = [{ id: 4, venta_id: 43, monto: 10, creado_en: '2026-10-08T10:00:00Z', venta: { numero: 'VTA-43' } }]
    const selects: string[] = []
    from.mockImplementation((table: string) => ({ select: (fields: string) => {
      selects.push(fields)
      return { eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: table === 'saldo_cliente_uso' ? balance : cash, error: null }) }) }) }
    } }))
    const rows = await listMovimientosTurno('4')
    expect(rows.map(row => row.ventaId)).toEqual(['21', '32', undefined, '43'])
    expect(selects.every(fields => fields.split(',').includes('venta_id'))).toBe(true)
  })
})
