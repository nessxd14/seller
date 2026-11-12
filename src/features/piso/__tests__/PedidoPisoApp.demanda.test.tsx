// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ search: vi.fn(), stock: vi.fn() }))
vi.mock('../EscanerContinuo', () => ({ EscanerContinuo: () => null, useWakeLock: () => {}, vibrarDesconocido: vi.fn() }))
const activo = { clave: 'c', pedidoId: null, codigo: null, numeroDia: null, estado: 'ARMANDO', lineas: [], nota: null, revision: 0, guardadoRevision: 0, creadoEn: '', snapshot: null }
vi.mock('../usePedidosPiso', () => ({ usePedidosPiso: () => ({ activo, pedidos: [activo], abiertos: 1, errorPedido: {}, agregar: vi.fn() }) }))
vi.mock('../../../infrastructure/services', () => ({
  listPresentations: vi.fn(),
  productRepository: { search: mocks.search },
  getStockBySucursalBatch: mocks.stock,
  pedidoVendedorService: {},
  demandaRepository: { previa: vi.fn().mockResolvedValue({ ideaId: null, titulo: null, estado: null, via: null, vecesSemana: 0, vecesTotal: 0 }), anotar: vi.fn(), subirFoto: vi.fn() },
}))
vi.mock('../../../infrastructure/supabase/SupabaseAuthSessionProvider', () => ({ supabaseAuthSessionProvider: {} }))
vi.mock('../../transfers/TransfersPage', () => ({ TransfersPage: () => null }))
vi.mock('../MisVentasPiso', () => ({ MisVentasPiso: () => null }))
import { PedidoPisoApp } from '../PedidoPisoApp'

const sesion = { user: { id: 'u', name: 'QA', role: 'vendedor' as const, active: true }, expiresAt: '2999-01-01' }
const buscar = (q: string) => fireEvent.change(screen.getByLabelText('Buscar producto'), { target: { value: q } })

beforeEach(() => { mocks.search.mockReset(); mocks.stock.mockReset() })
afterEach(cleanup)

describe('PedidoPisoApp — anotar demanda', () => {
  it('"Sin resultados" ofrece «Anotar que lo buscaron» y abre la hoja con el texto', async () => {
    mocks.search.mockResolvedValue({ items: [], total: 0 })
    render(<PedidoPisoApp session={sesion} />)
    buscar('papel kraft')
    fireEvent.click(await screen.findByRole('button', { name: 'Anotar que lo buscaron' }))
    expect(screen.getByRole('dialog', { name: 'Un cliente busca algo' })).toBeTruthy()
    expect((screen.getByLabelText('¿Qué buscó?') as HTMLInputElement).value).toBe('papel kraft')
  })

  it('producto sin stock vendible: botón "Anotar" abre la hoja con el producto', async () => {
    mocks.search.mockResolvedValue({ items: [{ id: 7, nombre: 'Hoja bond', sku: 'HB', precioRetail: 1 }], total: 1 })
    mocks.stock.mockResolvedValue(new Map([[7, { tiendaVendible: 0, almacenVendible: 0 }]]))
    render(<PedidoPisoApp session={sesion} />)
    buscar('hoja')
    fireEvent.click(await screen.findByRole('button', { name: 'Anotar Hoja bond' }))
    expect((screen.getByLabelText('¿Qué buscó?') as HTMLInputElement).value).toBe('Hoja bond')
  })

  it('si el stock falla no aparece "Anotar" en la fila', async () => {
    mocks.search.mockResolvedValue({ items: [{ id: 7, nombre: 'Hoja bond', sku: 'HB', precioRetail: 1 }], total: 1 })
    mocks.stock.mockRejectedValue(new Error('x'))
    render(<PedidoPisoApp session={sesion} />)
    buscar('hoja')
    await screen.findByText('Hoja bond')
    await waitFor(() => expect(mocks.stock).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Anotar Hoja bond' })).toBeNull()
  })

  it('el encabezado tiene "Cliente busca algo"', () => {
    render(<PedidoPisoApp session={sesion} />)
    fireEvent.click(screen.getByRole('button', { name: /Cliente busca algo/ }))
    expect(screen.getByRole('dialog', { name: 'Un cliente busca algo' })).toBeTruthy()
  })
})
