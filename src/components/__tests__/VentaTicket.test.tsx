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

const { getTicket } = vi.hoisted(() => ({ getTicket: vi.fn() }))
vi.mock('../../infrastructure/services', () => ({ saleService: { getTicket } }))
vi.mock('../../config/empresaStore', () => ({
  empresaStore: { razonSocial: 'Comercial ROARI', direccion: 'Av. Siempre Viva', ciudad: 'La Paz', celular: '', correo: '', nit: '', pieDocumento: '', logoSrc: '', selloUrl: '', firmaUrl: '', firmaNombre: '', firmaCargo: '' },
  loadEmpresaConfig: vi.fn().mockResolvedValue(undefined),
}))

afterEach(cleanup)

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
