import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('./supabaseClient', () => ({ supabase: { rpc, from } }))
import { productRepository } from './ProductRepository.supabase'
import type { Product } from '../../types'

const producto = (id: number) => ({ id, nombre: `P${id}` }) as unknown as Product
const fila = (producto_id: number, presentacion_id: number | null, factor: number, nombre: string) => ({ producto_id, presentacion_id, factor_unidad_base: factor, presentacion_nombre: nombre })

beforeEach(() => {
  rpc.mockReset(); from.mockReset()
  vi.spyOn(productRepository, 'getById').mockImplementation(async (id: string) => producto(Number(id)))
})

describe('resolveScannedCode — presentación del código (Piso)', () => {
  it('una sola presentación en todas las filas: la devuelve', async () => {
    rpc.mockResolvedValue({ data: [fila(49, 3001, 10, 'Caja x10'), fila(49, 3001, 10, 'Caja x10')], error: null })
    const r = await productRepository.resolveScannedCode('7701')
    expect(rpc).toHaveBeenCalledWith('resolver_identificador', { p_codigo: '7701' })
    expect(r).toMatchObject({ kind: 'found', presentation: { id: 3001, nombre: 'Caja x10', factorUnidadBase: 10, esBase: false } })
  })

  it('la presentación base queda marcada como base', async () => {
    rpc.mockResolvedValue({ data: [fila(49, 47, 1, 'Unidad')], error: null })
    const r = await productRepository.resolveScannedCode('7701')
    expect(r).toMatchObject({ kind: 'found', presentation: { id: 47, esBase: true, factorUnidadBase: 1 } })
  })

  it('varias presentaciones del mismo producto: found sin presentation', async () => {
    rpc.mockResolvedValue({ data: [fila(49, 47, 1, 'Unidad'), fila(49, 3001, 10, 'Caja')], error: null })
    const r = await productRepository.resolveScannedCode('7701')
    expect(r.kind).toBe('found')
    expect(r).not.toHaveProperty('presentation')
  })

  it('filas sin presentacion_id: found como siempre, sin presentation', async () => {
    rpc.mockResolvedValue({ data: [{ producto_id: 49 }], error: null })
    const r = await productRepository.resolveScannedCode('7701')
    expect(r.kind).toBe('found')
    expect(r).not.toHaveProperty('presentation')
  })

  it('productos distintos: ambiguous (sin presentation)', async () => {
    rpc.mockResolvedValue({ data: [fila(49, 47, 1, 'Unidad'), fila(50, 51, 1, 'Unidad')], error: null })
    const r = await productRepository.resolveScannedCode('7701')
    expect(r).toEqual({ kind: 'ambiguous', productIds: [49, 50] })
  })

  it('código vacío: not_found sin llamar a la RPC', async () => {
    expect(await productRepository.resolveScannedCode('  ')).toEqual({ kind: 'not_found' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('getStockBySucursalBatch — una sola RPC stock_vendible_lote', () => {
  it('deriva las mismas cantidades: excluye_disponible, override LIBRE y fallback al default', async () => {
    const { getStockBySucursalBatch } = await import('./ProductRepository.supabase')
    const payload = {
      stock: [
        { producto_id: 1, cantidad_base: '10', sucursal_id: 2, excluye_disponible: false },
        { producto_id: 1, cantidad_base: 3, sucursal_id: 2, excluye_disponible: true },
        { producto_id: 1, cantidad_base: 5, sucursal_id: 1, excluye_disponible: false },
        { producto_id: 1, cantidad_base: 7, sucursal_id: null, excluye_disponible: null },
        { producto_id: 2, cantidad_base: 4, sucursal_id: 1, excluye_disponible: false },
      ],
      overrides: [{ producto_id: 1, sucursal_id: 1, control_stock: 'LIBRE' }],
      vendible_tienda: [{ producto_id: 1, vendible: 8, reservado: '2', motivo: null }],
      vendible_almacen: [{ producto_id: 1, vendible: 5, reservado: 0, motivo: 'FIFO' }],
    }
    rpc.mockResolvedValue({ data: payload, error: null })
    from.mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [{ id: 1, control_stock_default: 'ESTRICTO' }, { id: 2, control_stock_default: 'LIBRE' }], error: null }) })
    const result = await getStockBySucursalBatch([1, 2, 1])
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('stock_vendible_lote', { p_producto_ids: [1, 2] })
    expect(result.get(1)).toEqual({
      tienda: 10, almacen: 5, tiendaLibre: true, almacenLibre: true,
      tiendaVendible: 8, almacenVendible: 5, tiendaReservado: 2, almacenReservado: 0,
      tiendaMotivo: null, almacenMotivo: 'FIFO',
    })
    expect(result.get(2)).toEqual({
      tienda: 0, almacen: 4, tiendaLibre: true, almacenLibre: false,
      tiendaVendible: 0, almacenVendible: 0, tiendaReservado: 0, almacenReservado: 0,
      tiendaMotivo: null, almacenMotivo: null,
    })
  })
})
