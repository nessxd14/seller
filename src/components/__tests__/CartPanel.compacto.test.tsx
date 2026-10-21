// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CartPanel } from '../CartPanel'
import { PosProvider, usePos } from '../../context/PosContext'
import { CashSessionProvider } from '../../context/CashSessionContext'
import type { Product } from '../../types'

const { stock } = vi.hoisted(() => ({ stock: (tienda: number) => ({ tienda, almacen: 100, tiendaLibre: false, almacenLibre: false, tiendaVendible: tienda, almacenVendible: 100, tiendaReservado: 0, almacenReservado: 0, tiendaMotivo: null, almacenMotivo: null }) }))

vi.mock('../../infrastructure/services', () => ({
  authSessionProvider: { getSession: vi.fn().mockResolvedValue({ user: { id: 'u1', role: 'cajero', active: true }, expiresAt: '2099-01-01' }) },
  turnoService: { getSesionAbierta: vi.fn().mockResolvedValue({ id: '1', cajeroId: 'u1' }) },
  cashService: { getOpenSession: vi.fn().mockResolvedValue({ id: '1', register: 'Caja Tienda', openedAt: new Date().toISOString(), openingCents: 0, status: 'open', movements: [] }) },
  transferService: { create: vi.fn() },
  ventaDirectaService: { getUbicacionVentasDirectas: vi.fn().mockResolvedValue(1), listAbiertas: vi.fn().mockResolvedValue([]), listPorCobrar: vi.fn().mockResolvedValue([]), cobrarVtd: vi.fn(), getById: vi.fn().mockResolvedValue(null) },
  borradorOperacionService: { save: vi.fn() },
  // 998 y 997 con stock de sobra; 999 solo tiene 1 en Tienda (para forzar un bloqueo con cantidad 5).
  getStockBySucursalBatch: vi.fn().mockResolvedValue(new Map([[998, stock(100)], [997, stock(100)], [999, stock(1)]])),
  configService: { listSucursales: vi.fn().mockResolvedValue([]) },
  listPresentations: vi.fn().mockResolvedValue([
    { id: 1, nombre: 'Unidad', factorUnidadBase: 1, esBase: true, precios: { retail: 10, mayoreo: 10, institucional: 10, corporativo: 10 }, tienePrecioPropio: false },
    { id: 2, nombre: 'Caja', factorUnidadBase: 12, esBase: false, precios: { retail: 100, mayoreo: 100, institucional: 100, corporativo: 100 }, tienePrecioPropio: true },
  ]),
}))

const scrollIntoView = vi.fn()
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); scrollIntoView.mockClear(); Element.prototype.scrollIntoView = scrollIntoView })
afterEach(cleanup)

const product = (id: number, nombre: string): Product => ({
  id, sku: `SKU-${id}`, codigoBarra: '', codigoFabrica: '', nombre, descripcion: '', categoria: '', imagen: '', color: '',
  precioRetail: 10, precioMayoreo: 10, precioInstitucional: 10, precioCorporativo: 10, stockTienda: 100, stockAlmacen: 100,
} as Product)

// Expone el contexto real al test sin reasignar variables durante el render.
const holder: { current: ReturnType<typeof usePos> | null } = { current: null }
const pos = () => holder.current!
function Probe() { const value = usePos(); useEffect(() => { holder.current = value }); return null }

const renderPanel = () => render(<PosProvider><CashSessionProvider><Probe /><CartPanel notify={() => {}} onOpenDraftOrder={() => {}} onGoToCash={() => {}} /></CashSessionProvider></PosProvider>)
const names = () => [...document.querySelectorAll('.cart-line-name')].map((el) => el.textContent)

describe('CartPanel compacto — línea', () => {
  it('sin seleccionar muestra nombre, detalle, cantidad y total, pero no presentación ni papelera; al seleccionar aparecen', async () => {
    renderPanel()
    act(() => { pos().addProduct(product(998, 'Cuaderno')) })
    act(() => { pos().setSelectedLineId(null) })
    const row = (await screen.findByText('Cuaderno')).closest('article') as HTMLElement
    expect(row.querySelector('.cart-line-meta')?.textContent).toContain('Bs 10,00 c/u')
    expect(within(row).getByRole('button', { name: 'Aumentar cantidad' })).toBeTruthy()
    expect(row.querySelector('.line-total')?.textContent).toBe('Bs 10,00')
    expect(within(row).queryByRole('combobox')).toBeNull()
    expect(within(row).queryByRole('button', { name: 'Eliminar Cuaderno' })).toBeNull()
    expect(row.querySelector('[data-line-action="edit"]')).toBeNull()

    fireEvent.click(screen.getByText('Cuaderno'))
    await waitFor(() => expect(within(row).getByRole('combobox', { name: 'Presentación Cuaderno' })).toBeTruthy())
    expect(within(row).getByRole('button', { name: 'Eliminar Cuaderno' })).toBeTruthy()
    expect(row.querySelector('[data-line-action="price"]')).toBeTruthy()
    expect(row.querySelector('[data-line-action="edit"]')).toBeTruthy()
  })

  it('tocar la cantidad no selecciona la línea', async () => {
    renderPanel()
    act(() => { pos().addProduct(product(998, 'Cuaderno')) })
    act(() => { pos().setSelectedLineId(null) })
    const row = (await screen.findByText('Cuaderno')).closest('article') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Aumentar cantidad' }))
    expect(row.className).not.toContain('cart-item-selected')
    expect(row.querySelector('.line-total')?.textContent).toBe('Bs 20,00')
  })
})

describe('CartPanel compacto — quitar y deshacer', () => {
  const seed = () => { act(() => { pos().addProduct(product(998, 'Primero')); pos().addProduct(product(997, 'Segundo')); pos().addProduct(product(996, 'Tercero')) }) }

  it('quitar muestra la barra y Deshacer devuelve la línea a su posición', async () => {
    renderPanel()
    seed()
    await screen.findByText('Segundo')
    fireEvent.click(screen.getByText('Segundo'))
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar Segundo' }))
    expect(names()).toEqual(['Primero', 'Tercero'])
    const bar = screen.getByRole('status', { name: '' }) as HTMLElement
    expect(bar.textContent).toContain('Quitaste Segundo')
    fireEvent.click(within(bar).getByRole('button', { name: /Deshacer/ }))
    expect(names()).toEqual(['Primero', 'Segundo', 'Tercero'])
    expect(screen.queryByText(/Quitaste/)).toBeNull()
    expect(pos().selectedLineId).toBe(997)
  })

  it('undoLastRemove (Ctrl+Z) restaura la última quita y no hace nada si no hay', async () => {
    renderPanel()
    seed()
    await screen.findByText('Tercero')
    act(() => { pos().removeItem(998) })
    expect(names()).toEqual(['Segundo', 'Tercero'])
    expect(pos().lastRemoved?.index).toBe(0)
    act(() => { expect(pos().undoLastRemove()).toBe('Primero') })
    expect(names()).toEqual(['Primero', 'Segundo', 'Tercero'])
    act(() => { expect(pos().undoLastRemove()).toBeNull() })
  })

  it('una operación nueva olvida la última quita', async () => {
    renderPanel()
    seed()
    await screen.findByText('Tercero')
    act(() => { pos().removeItem(998) })
    expect(pos().lastRemoved).not.toBeNull()
    act(() => { pos().clearOperation() })
    expect(pos().lastRemoved).toBeNull()
  })

  it('la barra desaparece a los 6 segundos', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderPanel()
      seed()
      act(() => { pos().removeItem(997) })
      expect(screen.getByText(/Quitaste/)).toBeTruthy()
      act(() => { vi.advanceTimersByTime(6100) })
      expect(screen.queryByText(/Quitaste/)).toBeNull()
      expect(pos().lastRemoved).not.toBeNull()
    } finally { vi.useRealTimers() }
  })
})

describe('CartPanel compacto — cobro bloqueado', () => {
  it('un solo botón cuenta las líneas a corregir y salta a la primera', async () => {
    renderPanel()
    act(() => {
      pos().addProduct(product(998, 'Con stock'))
      pos().addCustomItem({ descripcion: 'Sello sin precio', cantidad: 1, precio: 0, unidadMedida: 'UNIDAD' })
      pos().addProduct(product(999, 'Sin stock'), 5)
    })
    const button = await screen.findByRole('button', { name: /líneas para corregir/ })
    expect(button.textContent).toContain('2 líneas para corregir')
    expect(document.querySelectorAll('.cart-fix-lines')).toHaveLength(1)
    expect((screen.getByRole('button', { name: /^Cobrar/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText(/no tiene precio/)).toBeNull()
    act(() => { pos().setSelectedLineId(998) })
    scrollIntoView.mockClear()
    fireEvent.click(button)
    expect(pos().selectedLineId).toBeLessThan(0) // el ítem sin precio es el primero con problema (ids negativos = personalizados)
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    expect(document.querySelector('.cart-item-selected .cart-line-name')?.textContent).toBe('Sello sin precio')
  })
})

describe('CartPanel compacto — menú + Agregar', () => {
  it('ofrece ítem personalizado, VTD y pedido con sus atajos y cierra al elegir', async () => {
    renderPanel()
    const menu = document.querySelector('details.cart-add-menu') as HTMLDetailsElement
    expect(menu.querySelector('summary')?.textContent).toContain('+ Agregar')
    expect([...menu.querySelectorAll('.cart-add-items > button')].map((b) => b.getAttribute('data-pos-action'))).toEqual(['custom-item', 'agregar-vtd'])
    expect(menu.textContent).toContain('F10')
    expect(menu.textContent).toContain('Alt+K')
    menu.open = true
    fireEvent.click(menu.querySelector('[data-pos-action="custom-item"]')!)
    expect(menu.open).toBe(false)
    expect(await screen.findByText('Agregar ítem personalizado')).toBeTruthy()
  })
})
