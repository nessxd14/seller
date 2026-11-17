import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../supabaseClient', () => ({ supabase: { rpc } }))
import { pisoRepository } from '../PisoRepository.supabase'
import { rowToProduct, type ProductoRow } from '../../../domain/catalog/mapeoProducto'

beforeEach(() => rpc.mockReset())

const abierto = { turno_id: 3, inicio: '2026-11-16T12:00:00Z', sucursal_id: 2, cobradas: 1, por_cobrar: 0, no_realizadas: 0, por_reclamar: 2, cierra_a: '2026-11-16T18:00:00Z' }

describe('pisoRepository.estadoTurno', () => {
  it('con turno abierto mapea cierra_a y no trae ultimo', async () => {
    rpc.mockResolvedValue({ data: abierto, error: null })
    const e = await pisoRepository.estadoTurno()
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('piso_turno_actual')
    expect(e.turno?.cierraA).toBe('2026-11-16T18:00:00Z')
    expect(e.ultimo).toBeNull()
  })

  it.each(['AUTOMATICO', 'CAJA', 'MANUAL'])('sin turno mapea ultimo (%s)', async (cierre) => {
    rpc.mockResolvedValue({ data: { turno_id: null, ultimo: { turno_id: 2, inicio: 'a', fin: 'b', cierre } }, error: null })
    const e = await pisoRepository.estadoTurno()
    expect(e.turno).toBeNull()
    expect(e.ultimo).toEqual({ turnoId: 2, inicio: 'a', fin: 'b', cierre })
  })

  it('sin turno y sin ultimo: ambos nulos', async () => {
    rpc.mockResolvedValue({ data: { turno_id: null, ultimo: null }, error: null })
    expect(await pisoRepository.estadoTurno()).toEqual({ turno: null, ultimo: null })
  })

  it('turnoActual sigue devolviendo PisoTurno | null', async () => {
    rpc.mockResolvedValue({ data: { turno_id: null, ultimo: { turno_id: 2, inicio: 'a', fin: 'b', cierre: 'CAJA' } }, error: null })
    expect(await pisoRepository.turnoActual()).toBeNull()
  })
})

describe('pisoRepository.traslados', () => {
  it('llama traslados_piso y pasa a camelCase', async () => {
    rpc.mockResolvedValue({ data: { sucursal_id: 2, traslados: [{
      id: 88, numero: 'TRA-2026-00088', estado: 'SOLICITADO', motivo: 'REPOSICION', origen_id: 1, destino_id: 2, solicitado_en: 'x', mio: true, nota: null,
      tarea_estado: 'PREPARADO', alista: 'Beto', alistado_en: 'y', retira: null, retiro_mio: false, recibido_en: null, lineas: 3, con_faltante: false,
    }] }, error: null })
    const r = await pisoRepository.traslados()
    expect(rpc).toHaveBeenCalledWith('traslados_piso', { p_dias: 14 })
    expect(r.sucursalId).toBe(2)
    expect(r.traslados[0]).toMatchObject({ id: '88', origenId: 1, destinoId: 2, mio: true, tareaEstado: 'PREPARADO', alista: 'Beto', alistadoEn: 'y', lineas: 3, conFaltante: false })
  })
})

describe('mapeo de miniatura', () => {
  const fila = { id: 1, nombre: 'P', sku_interno: 'S', marca: null, unidad_base: null, precio_base: 1, precio_mayoreo: null, precio_institucion: null, precio_corporativo: null, activo: true, imagen_url: 'f.jpg', stock_min: null, punto_reorden: null, familia_id: null } as ProductoRow
  it('imagen_miniatura_url → imagenMiniaturaUrl', () => {
    expect(rowToProduct({ ...fila, imagen_miniatura_url: 'm.jpg' }).imagenMiniaturaUrl).toBe('m.jpg')
    expect(rowToProduct(fila).imagenMiniaturaUrl).toBeUndefined()
  })
})
