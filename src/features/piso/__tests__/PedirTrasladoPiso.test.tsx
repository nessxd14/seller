// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ create: vi.fn(), search: vi.fn(), presentaciones: vi.fn(), stock: vi.fn() }))
vi.mock('../../../infrastructure/services', () => ({ transferService: { create: mocks.create }, productRepository: { search: mocks.search, resolveScannedCode: vi.fn() }, listPresentations: mocks.presentaciones, getStockBySucursalBatch: mocks.stock }))
vi.mock('../EscanerContinuo', () => ({ EscanerContinuo: () => null, vibrarDesconocido: vi.fn() }))
import { PedirTrasladoPiso } from '../PedirTrasladoPiso'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.search.mockResolvedValue({ items: [{ id: 7, nombre: 'Cinta', sku: 'C-7' }] })
  mocks.presentaciones.mockResolvedValue([{ id: 1, nombre: 'Unidad', esBase: true }])
  mocks.stock.mockResolvedValue(new Map([[7, { tiendaVendible: 3, almacenVendible: 40 }]]))
  mocks.create.mockResolvedValue({ id: '9' })
})
afterEach(cleanup)

it('crea un traslado REPOSICION de Almacén Central (1) a la sucursal del usuario', async () => {
  const onCreado = vi.fn()
  render(<PedirTrasladoPiso sucursalId={2} onVolver={vi.fn()} onCreado={onCreado} aviso={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Buscar producto'), { target: { value: 'cin' } })
  fireEvent.click(await screen.findByRole('button', { name: /Cinta/ }))
  expect(await screen.findByText('En tienda: 3 · En almacén: 40')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Más Cantidad Cinta' }))
  fireEvent.click(screen.getByRole('button', { name: 'Pedir a almacén' }))
  await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ motivo: 'REPOSICION', nota: undefined, sucursalOrigenId: 1, sucursalDestinoId: 2, lines: [{ productId: '7', cantidadBase: 2 }] }))
  await waitFor(() => expect(onCreado).toHaveBeenCalled())
})
