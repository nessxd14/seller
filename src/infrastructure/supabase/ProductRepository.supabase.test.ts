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
