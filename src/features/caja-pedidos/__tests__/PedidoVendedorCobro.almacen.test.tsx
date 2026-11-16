// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PedidoVendedorRecord } from '../../../application/shared/models'

const svc = vi.hoisted(() => ({ cola: vi.fn(), tomar: vi.fn(), devolver: vi.fn(), anular: vi.fn(), cobrar: vi.fn(), cobrarVtd: vi.fn() }))
const vtdSvc = vi.hoisted(() => ({ getById: vi.fn() }))
vi.mock('../../../infrastructure/services', () => ({
  pedidoVendedorService: svc,
  ventaDirectaService: vtdSvc,
  turnoService: { estadoBancoQr: vi.fn(), estadoPagoQr: vi.fn() },
  productRepository: { resolveScannedCode: vi.fn(), search: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 12, total: 0 }) },
  authSessionProvider: { getSession: vi.fn().mockResolvedValue({ user: { id: 'c1', email: 'caja@x.com' } }) },
  listPresentations: vi.fn().mockResolvedValue([]),
  getStockBySucursalBatch: vi.fn().mockResolvedValue(new Map([[49, { tiendaVendible: 0, almacenVendible: 12 }]])),
}))
vi.mock('../../../lib/auditoriaDvr', () => ({ auditStart: vi.fn(), auditEnd: vi.fn() }))
vi.mock('../../../components/VentaTicket', () => ({ VentaTicket: () => <div>ticket de tienda</div> }))
vi.mock('../../../components/VtdTicketPreviewModal', () => ({ VtdTicketPreviewModal: ({ venta }: { venta: { numero: string } }) => <div role="dialog" aria-label="ticket vtd">ticket {venta.numero}</div> }))
vi.mock('../../../components/VtdUbicacionPicker', () => ({ VtdUbicacionPicker: ({ onChange }: { onChange: (id: number | null) => void }) => <button type="button" onClick={() => onChange(7)}>Elegir ubicación</button> }))
vi.mock('../../../components/AmbiguousScanPicker', () => ({ AmbiguousScanPicker: () => <div /> }))
import { PedidoVendedorCobro } from '../PedidoVendedorCobro'

const pedido: PedidoVendedorRecord = {
  pedidoId: '9', codigo: 'PDV-9', numeroDia: 3, fecha: '2026-11-16', estado: 'EN_CAJA', canal: 'ALMACEN', vendedor: 'Josias', nota: 'Doña Rosa', total: 28,
  enviadoEn: new Date().toISOString(), tomadoPor: 'Rony', ventaNumero: null, anuladoOrigen: null, anuladoMotivo: null, reintento: false,
  lineas: [{ lineaId: '31', orden: 1, productoId: 49, nombre: 'Resma carta', sku: 'RC', presentacionId: 47, presentacion: 'Unidad', esBase: true, factor: 1, esPersonalizado: false, unidadMedida: null, cantidad: 2, precioLista: 15, precioMinimo: 13.5, precioUnitario: 14, subtotal: 28, resultado: null, cantidadFinal: null, precioFinal: null, motivoCaja: null }],
}
const fila = { pedidoId: '9', codigo: 'PDV-9', numeroDia: 3, estado: 'ENVIADO' as const, canal: 'ALMACEN' as const, vendedor: 'Josias', enviadoEn: new Date().toISOString(), total: 28, lineas: 1, tomadoPor: null, sesionCajaId: null }

beforeEach(() => {
  vi.clearAllMocks()
  svc.cola.mockResolvedValue([fila, { ...fila, pedidoId: '10', numeroDia: 4, canal: 'TIENDA', vendedor: 'Ana' }])
  svc.tomar.mockResolvedValue(pedido)
  svc.cobrarVtd.mockResolvedValue({ ventaId: '55', numero: 'VTD-2026-00012', subtotal: 28, descuentoTotal: 0, total: 28, reintento: false, pedidos: ['9'] })
  vtdSvc.getById.mockResolvedValue({ id: '55', numero: 'VTD-2026-00012' })
})
afterEach(cleanup)

const entrar = async () => {
  render(<PedidoVendedorCobro sessionId="4" onClose={vi.fn()} notify={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /Josias/ }))
  await screen.findByRole('button', { name: 'Cobrar y mandar a almacén' })
  fireEvent.click(screen.getByRole('button', { name: /^Verificar: Resma carta/ }))
}

describe('Cola con ventas de almacén', () => {
  it('marca «Almacén VTD» o «Tienda» y explica qué pasa al cobrar', async () => {
    render(<PedidoVendedorCobro sessionId="4" onClose={vi.fn()} notify={vi.fn()} />)
    await screen.findByText('Almacén VTD')
    expect(screen.getByText('Tienda')).toBeTruthy()
    expect(screen.getByText(/Al cobrar sale el ticket VTD y la venta pasa a almacén para entregar/)).toBeTruthy()
  })
})

describe('Cobro de un pedido de almacén', () => {
  it('muestra el stock de almacén y no deja cobrar sin ubicación', async () => {
    await entrar()
    expect(await screen.findByText('Stock en almacén: 12')).toBeTruthy()
    const boton = screen.getByRole('button', { name: 'Cobrar y mandar a almacén' }) as HTMLButtonElement
    expect(boton.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Elegir ubicación' }))
    expect(boton.disabled).toBe(false)
  })

  it('cobra con cobrar_pedido_vendedor_vtd (nunca el de tienda), con ubicación y pago, y muestra el ticket VTD', async () => {
    await entrar()
    fireEvent.click(screen.getByRole('button', { name: 'Elegir ubicación' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cobrar y mandar a almacén' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar cobro' }))
    await waitFor(() => expect(svc.cobrarVtd).toHaveBeenCalledOnce())
    expect(svc.cobrar).not.toHaveBeenCalled()
    expect(svc.cobrarVtd.mock.calls[0][0]).toMatchObject({
      pedidoId: '9', ubicacionId: 7, sesionCajaId: '4', quitadas: [],
      pagos: [{ method: 'cash', amountCents: 2800 }],
      lineas: [{ pedido_linea_id: 31, verificada: true, producto_id: 49, precio_unitario: 14 }],
    })
    expect(await screen.findByRole('dialog', { name: 'ticket vtd' })).toBeTruthy()
    expect(vtdSvc.getById).toHaveBeenCalledWith('55')
  })

  it('si falla el cobro muestra el error y no abre el ticket', async () => {
    svc.cobrarVtd.mockRejectedValue(new Error('La venta de almacén se cobra en el momento: falta el pago'))
    await entrar()
    fireEvent.click(screen.getByRole('button', { name: 'Elegir ubicación' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cobrar y mandar a almacén' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar cobro' }))
    expect(await screen.findByText(/falta el pago/)).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'ticket vtd' })).toBeNull()
  })

  it('«Continuar en carrito» no cobra: entrega el pedido al carrito', async () => {
    const onCartChange = vi.fn(); const onClose = vi.fn()
    render(<PedidoVendedorCobro sessionId="4" initialPedidoId="9" onClose={onClose} notify={vi.fn()} onCartChange={onCartChange} />)
    fireEvent.click(await screen.findByRole('button', { name: /^Verificar: Resma carta/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continuar en carrito' }))
    expect(svc.cobrarVtd).not.toHaveBeenCalled(); expect(svc.cobrar).not.toHaveBeenCalled()
    expect(onCartChange.mock.lastCall?.[0].pedido.canal).toBe('ALMACEN')
    expect(onClose).toHaveBeenCalled()
  })
})
