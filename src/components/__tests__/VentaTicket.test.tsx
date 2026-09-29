// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { VentaTicket } from '../VentaTicket'
import type { VentaTicketRecord } from '../../application/shared/models'

// Brief Caja-1 B1: el ticket se arma desde la venta YA GUARDADA (saleService.getTicket),
// nunca desde el carrito — este fixture simula exactamente esa forma de respuesta.
const fixture: VentaTicketRecord = {
  ventaId: '42',
  numero: 'VTA-2026-00016',
  estado: 'COMPLETADA',
  creadoEn: '2026-09-27T15:00:00Z',
  cajaNombre: 'Caja Tienda',
  cajero: 'natalia@roari.com',
  clienteNombre: 'Cliente de mostrador',
  lineas: [{ id: 'l1', nombre: 'Cuaderno TUKI 50 hojas', sku: 'CUA-TUK-050', cantidad: 2, precioUnitarioBs: 18.5, subtotalBs: 37 }],
  subtotalBs: 37,
  descuentoBs: 0,
  totalBs: 37,
  pagos: [{ metodo: 'EFECTIVO', montoBs: 37, recibidoBs: 50, estadoVerificacion: 'NO_APLICA' }],
}

const { getTicket, estadoBancoQr } = vi.hoisted(() => ({
  getTicket: vi.fn(),
  // Default: banco offline — así los tests que no la pisan (los del bloque Caja-1
  // original) no rompen por un `.then` sobre un valor no resuelto.
  estadoBancoQr: vi.fn().mockResolvedValue({ ultimoLatido: null, minutosDesde: null, enLinea: false }),
}))
vi.mock('../../infrastructure/services', () => ({ saleService: { getTicket }, turnoService: { estadoBancoQr } }))
vi.mock('../../config/empresaStore', () => ({
  empresaStore: { razonSocial: 'Comercial ROARI', direccion: 'Av. Siempre Viva', ciudad: 'La Paz', celular: '', correo: '', nit: '', pieDocumento: '', logoSrc: '', selloUrl: '', firmaUrl: '', firmaNombre: '', firmaCargo: '' },
  loadEmpresaConfig: vi.fn().mockResolvedValue(undefined),
}))

afterEach(cleanup)

const pendienteFixture: VentaTicketRecord = {
  ...fixture,
  creadoEn: new Date().toISOString(),
  pagos: [{ metodo: 'QR', montoBs: 37, estadoVerificacion: 'PENDIENTE' }],
}
const rechazadoFixture: VentaTicketRecord = {
  ...fixture,
  pagos: [{ metodo: 'TRANSFERENCIA', montoBs: 37, estadoVerificacion: 'RECHAZADO' }],
}

const imprimirButton = () => screen.getByRole('button', { name: /Imprimir ticket/ }) as HTMLButtonElement

describe('VentaTicket — ticket post-venta real (Brief Caja-1 B1)', () => {
  it('muestra el número de ticket, el cambio y los pagos de la venta guardada', async () => {
    getTicket.mockResolvedValue(fixture)
    render(<VentaTicket id="42" onClose={() => {}} />)

    await waitFor(() => expect(getTicket).toHaveBeenCalledWith('42'))
    await waitFor(() => expect(screen.getAllByText('VTA-2026-00016', { exact: false }).length).toBeGreaterThan(0))
    expect(screen.getByText('Efectivo', { exact: false })).toBeTruthy()
    // Cambio = recibido (50) − monto (37) = 13
    expect(document.body.textContent).toMatch(/Cambio/)
    expect(document.body.textContent).toMatch(/13[.,]00/)
    expect(document.body.textContent).toMatch(/Recibido/)
    expect(document.body.textContent).toMatch(/50[.,]00/)
  })

  it('muestra un estado vacío cuando la venta no existe', async () => {
    getTicket.mockResolvedValue(null)
    render(<VentaTicket id="999" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(/No se encontró la venta/)).toBeTruthy())
  })
})

describe('VentaTicket — reglas de impresión (Brief Caja-2 B1)', () => {
  it('bloquea Imprimir cuando un pago está RECHAZADO', async () => {
    getTicket.mockResolvedValue(rechazadoFixture)
    estadoBancoQr.mockResolvedValue({ ultimoLatido: null, minutosDesde: null, enLinea: true })
    render(<VentaTicket id="42" onClose={() => {}} />)
    await waitFor(() => expect(imprimirButton().disabled).toBe(true))
  })

  it('bloquea Imprimir cuando el pago está PENDIENTE, el banco está en línea y la venta tiene menos de 90s', async () => {
    getTicket.mockResolvedValue(pendienteFixture)
    estadoBancoQr.mockResolvedValue({ ultimoLatido: new Date().toISOString(), minutosDesde: 0, enLinea: true })
    render(<VentaTicket id="42" onClose={() => {}} />)
    await waitFor(() => expect(imprimirButton().disabled).toBe(true))
  })

  it('permite Imprimir cuando el pago está PENDIENTE pero el banco está offline', async () => {
    getTicket.mockResolvedValue(pendienteFixture)
    estadoBancoQr.mockResolvedValue({ ultimoLatido: null, minutosDesde: null, enLinea: false })
    render(<VentaTicket id="42" onClose={() => {}} />)
    await waitFor(() => expect(getTicket).toHaveBeenCalled())
    await waitFor(() => expect(imprimirButton().disabled).toBe(false))
  })

  it('permite Imprimir cuando el pago está PENDIENTE y la consulta de estado del banco falla', async () => {
    getTicket.mockResolvedValue(pendienteFixture)
    estadoBancoQr.mockRejectedValue(new Error('network'))
    render(<VentaTicket id="42" onClose={() => {}} />)
    await waitFor(() => expect(getTicket).toHaveBeenCalled())
    await waitFor(() => expect(imprimirButton().disabled).toBe(false))
  })
})
