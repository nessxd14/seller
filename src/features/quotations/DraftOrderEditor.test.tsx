// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { QuoteDraft } from '../../application/shared/models'
import { getDisponibilidadPedido } from '../../infrastructure/services'
import { DraftOrderEditor } from './DraftOrderEditor'

// Evita llamadas reales a Supabase/Hermes durante el test — solo importa que
// runAction no dispare onSave dos veces ante un doble clic.
vi.mock('../../infrastructure/services', () => ({
  customerService: { list: vi.fn().mockResolvedValue([]) },
  productRepository: { search: vi.fn().mockResolvedValue({ items: [], total: 0 }), getById: vi.fn().mockResolvedValue(null) },
  getStockByProduct: vi.fn().mockResolvedValue({}),
  getDisponibilidadPedido: vi.fn().mockResolvedValue({}),
  listPresentations: vi.fn().mockResolvedValue([]),
  listLineIdentifiers: vi.fn().mockResolvedValue({ p1: {} }),
  authSessionProvider: { getSession: vi.fn().mockResolvedValue(null) },
}))
vi.mock('../../infrastructure/supabase/ContactoCliente.supabase', () => ({
  evaluarTope: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../infrastructure/hermes/client', () => ({
  evaluarCredito: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../config/featureFlags', () => ({ featureFlags: { supabase: false } }))

afterEach(() => { cleanup(); vi.mocked(getDisponibilidadPedido).mockReset().mockResolvedValue({}); vi.restoreAllMocks() })

const baseQuote: QuoteDraft = {
  id: '',
  number: '',
  customerId: 'c1',
  customerName: 'Cliente Uno',
  channel: 'mayoreo',
  status: 'draft',
  conditionPago: 'CONTADO',
  validUntil: '',
  terms: '',
  notes: '',
  generalDiscountCents: 0,
  createdAt: '',
  lines: [
    { id: 'l1', productId: 'p1', name: 'Producto 1', sku: 'P1', quantity: 1, unitPriceCents: 1000, discountBasisPoints: 0 },
  ],
}

describe('DraftOrderEditor — candado de doble envío', () => {
  it('un doble clic muy rápido en "Guardar como cotización" llama a onSave una sola vez', async () => {
    let resolveSave: () => void = () => {}
    const onSave = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve }))
    render(<DraftOrderEditor quote={baseQuote} onClose={() => {}} onSave={onSave} />)

    const button = await screen.findByText('Guardar como cotización')
    // Ambos clics se disparan dentro del mismo `act()` síncrono, antes de que React
    // repinte `disabled`, para simular el doble clic/toque real que llega en el mismo
    // tick — si solo se probara con dos `fireEvent.click` separados, el primero ya
    // repintaría `disabled=true` antes del segundo y el test no probaría nada.
    act(() => {
      fireEvent.click(button)
      fireEvent.click(button)
    })

    expect(onSave).toHaveBeenCalledTimes(1)
    await act(async () => { resolveSave() })
  })

  it('no permite crear un pedido sin cliente y muestra qué falta', async () => {
    const onCreateOrder = vi.fn()
    render(<DraftOrderEditor quote={{ ...baseQuote, customerId: '', customerName: '' }} onClose={() => {}} onSave={vi.fn()} onCreateOrder={onCreateOrder} />)
    const button = await screen.findByRole('button', { name: 'Crear pedido' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(button)
    expect(onCreateOrder).not.toHaveBeenCalled()
    expect(screen.getByText('Selecciona un cliente de la lista para asociar el documento.')).toBeTruthy()
  })

  it('confirma cantidad con Enter sin abrir el editor de línea y guarda el total actualizado', async () => {
    const onSave = vi.fn()
    render(<DraftOrderEditor quote={baseQuote} onClose={() => {}} onSave={onSave} />)
    const quantity = await screen.findByRole('spinbutton', { name: 'Cantidad Producto 1' })
    fireEvent.change(quantity, { target: { value: '3' } })
    fireEvent.keyDown(quantity, { key: 'Enter' })
    expect(screen.queryByRole('dialog', { name: 'Editar producto' })).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Guardar como cotización' })) })
    expect(onSave.mock.calls[0][0].lines[0].quantity).toBe(3)
  })
})

describe('DraftOrderEditor — faltantes ("Por comprar")', () => {
  const disp = (n: number) => ({ stockFisico: n, reservado: 0, disponible: n })
  const quoteConFaltantes = (lines: QuoteDraft['lines']): QuoteDraft => ({ ...baseQuote, id: 'q1', lines })
  const line = (id: string, productId: string, quantity: number) => ({ id, productId, name: `Producto ${productId}`, sku: `P${productId}`, quantity, unitPriceCents: 1000, discountBasisPoints: 0 })
  const convertButton = () => screen.getByRole('button', { name: 'Convertir a pedido' }) as HTMLButtonElement

  it('deshabilita "Convertir a pedido" mientras haya un faltante sin decidir y lo habilita al comprar el faltante', async () => {
    vi.mocked(getDisponibilidadPedido).mockResolvedValue({ '7': disp(6) })
    render(<DraftOrderEditor quote={quoteConFaltantes([line('a', '7', 10)])} isExistingQuote onClose={() => {}} onSave={vi.fn()} onConvert={vi.fn()} />)
    expect(await screen.findByText('Disponible 6 · faltan 4')).toBeTruthy()
    expect(convertButton().disabled).toBe(true)
    expect(convertButton().title).toBe('Decidí qué hacer con las líneas sin stock')
    expect(screen.getByText(/1 línea sin stock suficiente: elegí comprar el faltante, bajar la cantidad o cambiar el producto\./)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Comprar el faltante Producto 7' }))
    expect(convertButton().disabled).toBe(false)
    expect(screen.getByText('Se compran 4')).toBeTruthy()
    expect(screen.getByText('1 línea van a Compras')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Deshacer compra del faltante Producto 7' }))
    expect(convertButton().disabled).toBe(true)
  })

  it('"Bajar a X" elimina el faltante y habilita el botón', async () => {
    vi.mocked(getDisponibilidadPedido).mockResolvedValue({ '7': disp(6) })
    render(<DraftOrderEditor quote={quoteConFaltantes([line('a', '7', 10)])} isExistingQuote onClose={() => {}} onSave={vi.fn()} onConvert={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Bajar Producto 7 a 6' }))
    await waitFor(() => expect(convertButton().disabled).toBe(false))
    expect(screen.queryByText(/faltan/)).toBeNull()
  })

  it('"Comprar todos los faltantes" aparece con dos o más líneas sin decidir y las decide todas', async () => {
    vi.mocked(getDisponibilidadPedido).mockResolvedValue({ '7': disp(1), '8': disp(0) })
    render(<DraftOrderEditor quote={quoteConFaltantes([line('a', '7', 3), line('b', '8', 2)])} isExistingQuote onClose={() => {}} onSave={vi.fn()} onConvert={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Comprar todos los faltantes' }))
    expect(screen.queryByRole('button', { name: 'Comprar todos los faltantes' })).toBeNull()
    expect(screen.getByText('2 líneas van a Compras')).toBeTruthy()
    expect(convertButton().disabled).toBe(false)
  })

  it('al convertir confirma, y manda cantidadPorComprar y comprarFaltante por línea', async () => {
    vi.mocked(getDisponibilidadPedido).mockResolvedValue({ '7': disp(6), '9': disp(50) })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onConvert = vi.fn()
    render(<DraftOrderEditor quote={quoteConFaltantes([line('a', '7', 10), line('b', '9', 2)])} isExistingQuote onClose={() => {}} onSave={vi.fn()} onConvert={onConvert} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Comprar el faltante Producto 7' }))
    await act(async () => { fireEvent.click(convertButton()) })
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Se van a mandar a Compras: Producto 7'))
    const sent = onConvert.mock.calls[0][0] as QuoteDraft
    expect(sent.lines.map((l) => [l.comprarFaltante ?? false, l.cantidadPorComprar])).toEqual([[true, 4], [false, 0]])
  })

  it('si el usuario cancela la confirmación no se llama a la acción', async () => {
    vi.mocked(getDisponibilidadPedido).mockResolvedValue({ '7': disp(6) })
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onConvert = vi.fn()
    render(<DraftOrderEditor quote={quoteConFaltantes([line('a', '7', 10)])} isExistingQuote onClose={() => {}} onSave={vi.fn()} onConvert={onConvert} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Comprar el faltante Producto 7' }))
    await act(async () => { fireEvent.click(convertButton()) })
    expect(onConvert).not.toHaveBeenCalled()
  })

  it('si el stock cambió al enviar, aborta y avisa', async () => {
    vi.mocked(getDisponibilidadPedido).mockResolvedValueOnce({ '7': disp(20) })
    const onConvert = vi.fn()
    render(<DraftOrderEditor quote={quoteConFaltantes([line('a', '7', 10)])} isExistingQuote onClose={() => {}} onSave={vi.fn()} onConvert={onConvert} />)
    await waitFor(() => expect(convertButton().disabled).toBe(false))
    vi.mocked(getDisponibilidadPedido).mockResolvedValue({ '7': disp(6) })
    await act(async () => { fireEvent.click(convertButton()) })
    expect(onConvert).not.toHaveBeenCalled()
    expect(await screen.findByText('El stock cambió mientras armabas el pedido. Revisá las líneas marcadas.')).toBeTruthy()
  })

  it('en solo lectura se puede comprar el faltante pero no bajar la cantidad', async () => {
    vi.mocked(getDisponibilidadPedido).mockResolvedValue({ '7': disp(6) })
    render(<DraftOrderEditor quote={{ ...quoteConFaltantes([line('a', '7', 10)]), status: 'approved' }} isExistingQuote onClose={() => {}} onSave={vi.fn()} onConvert={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'Comprar el faltante Producto 7' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Bajar Producto 7 a 6' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Comprar el faltante Producto 7' }))
    expect(convertButton().disabled).toBe(false)
  })
})
