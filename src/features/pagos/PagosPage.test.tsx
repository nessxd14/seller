// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { consultarHistorialPagosMock } from '../../infrastructure/mock/historialPagos'
import { PagosPage } from './PagosPage'

const mocks = vi.hoisted(() => ({ consultar: vi.fn() }))
vi.mock('../../infrastructure/hermes/client', () => ({ consultarHistorialPagos: mocks.consultar }))
vi.mock('./HistorialPagosImpresion', () => ({ HistorialPagosImpresion: () => null }))

const RANGO = { desde: '2020-01-01', hasta: '2099-12-31' }
const con = (rol: string) => (p: Parameters<typeof consultarHistorialPagosMock>[0]) => Promise.resolve(consultarHistorialPagosMock({ ...p, ...RANGO }, rol))

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('PagosPage', () => {
  it('admin ve las tarjetas de totales y la leyenda de confirmados', async () => {
    mocks.consultar.mockImplementation(con('admin'))
    render(<PagosPage />)
    expect(await screen.findByLabelText('Totales del período')).toBeTruthy()
    expect(screen.getByText('Los totales cuentan solo pagos confirmados')).toBeTruthy()
  })

  it('cajero (resumen null) no ve tarjetas ni leyenda de totales', async () => {
    mocks.consultar.mockImplementation(con('cajero'))
    render(<PagosPage />)
    await screen.findByRole('table')
    expect(screen.queryByLabelText('Totales del período')).toBeNull()
    expect(screen.queryByText('Los totales cuentan solo pagos confirmados')).toBeNull()
  })

  it('los chips de tipo muestran su conteo y cada uno tiene su (i) fuera del botón', async () => {
    mocks.consultar.mockImplementation(con('admin'))
    render(<PagosPage />)
    await screen.findByRole('table')
    const grupo = screen.getByRole('group', { name: 'Tipo de movimiento' })
    await waitFor(() => expect(within(grupo).getByRole("button", { name: /^Anticipo/ }).textContent).toMatch(/Anticipo\s*2/))
    for (const t of ['Pago a pedido', 'Pago a cuenta', 'Anticipo', 'Aplicación de saldo']) {
      const hint = within(grupo).getByRole('button', { name: `Qué es ${t}` })
      expect(hint.closest('.pagos-chip')).toBeNull()
    }
  })

  it('las aplicaciones de saldo muestran Bs 0,00 como dinero recibido', async () => {
    mocks.consultar.mockImplementation(con('admin'))
    render(<PagosPage />)
    const tabla = await screen.findByRole('table')
    const fila = within(tabla).getAllByRole('row').find(r => r.textContent?.includes('Aplicación de saldo'))
    expect(fila).toBeTruthy()
    expect(within(fila!).getByText('Bs 0,00')).toBeTruthy()
    expect(within(fila!).getByText(/Usó Bs 9\.530,00 a favor/)).toBeTruthy()
  })

  it('sin acceso (42501) muestra el estado Sin acceso', async () => {
    const { SinAccesoPagosError } = await import('../../domain/pagos/historialPagos')
    mocks.consultar.mockRejectedValue(new SinAccesoPagosError())
    render(<PagosPage />)
    expect(await screen.findByText('Sin acceso a los pagos')).toBeTruthy()
  })
})
