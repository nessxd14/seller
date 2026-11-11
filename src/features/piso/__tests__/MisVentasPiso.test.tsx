// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { MiCuentaVendedor } from '../../../application/shared/models'

const svc = vi.hoisted(() => ({ misCuentaVendedor: vi.fn() }))
vi.mock('../../../infrastructure/services', () => ({ pedidoVendedorService: svc }))
vi.mock('../../../domain/common/fechas', async (orig) => ({ ...(await orig<typeof import('../../../domain/common/fechas')>()), hoyLocal: () => '2026-11-11' }))
import { MisVentasPiso } from '../MisVentasPiso'

const base = { totalEnviado: 50, cobradoEn: null, parte: null, agregadoCaja: null, preciosCorregidos: 0, lineasQuitadas: 0, anuladoOrigen: null, anuladoMotivo: null, fecha: '2026-11-11' }
const cuenta: MiCuentaVendedor = {
  desde: '2026-11-11', hasta: '2026-11-11', parte: 120, cobradas: 1, porCobrar: 1, guardadas: 1, anuladas: 2,
  pedidos: [
    { ...base, pedidoId: '1', numeroDia: 14, estado: 'COBRADO', parte: 120, agregadoCaja: 30, preciosCorregidos: 2 },
    { ...base, pedidoId: '2', numeroDia: 13, estado: 'ENVIADO' },
    { ...base, pedidoId: '3', numeroDia: 12, estado: 'ARMANDO' },
    { ...base, pedidoId: '4', numeroDia: 11, estado: 'ANULADO', anuladoOrigen: 'CAJERO', anuladoMotivo: 'Venta duplicada' },
    { ...base, pedidoId: '5', numeroDia: 10, estado: 'ANULADO', anuladoOrigen: 'CIERRE_DIA' },
  ],
}

beforeEach(() => { svc.misCuentaVendedor.mockReset() })
afterEach(cleanup)

describe('MisVentasPiso', () => {
  it('muestra la parte, los contadores, los estados y las tres notas', async () => {
    svc.misCuentaVendedor.mockResolvedValue(cuenta)
    render(<MisVentasPiso abribles={new Set(['1'])} onAbrir={vi.fn()} />)
    await screen.findByText('Bs 120,00', { selector: 'strong' })
    expect(svc.misCuentaVendedor).toHaveBeenCalledWith('2026-11-11', '2026-11-11')
    expect(screen.getByText('cobradas').textContent).toBe('1 cobradas')
    expect(screen.getByText('por cobrar').textContent).toBe('1 por cobrar')
    expect(screen.getByText('guardadas').textContent).toBe('1 guardadas')
    expect(screen.getByText('Cuenta solo lo que tú anotaste, al precio que cobró caja. Lo que caja agregó no suma para ti.')).toBeTruthy()
    for (const t of ['Cobrada', 'En caja', 'Guardada', 'Anulada por caja', 'Se cerró sola']) expect(screen.getByText(t)).toBeTruthy()
    expect(screen.getByText('Caja agregó productos (Bs 30,00). No cuentan para ti.')).toBeTruthy()
    expect(screen.getByText('Caja corrigió 2 precios. Tu parte usa el precio de caja.')).toBeTruthy()
    expect(screen.getByText('Motivo: Venta duplicada')).toBeTruthy()
  })

  it('solo se abre la venta de hoy que existe en este teléfono', async () => {
    svc.misCuentaVendedor.mockResolvedValue(cuenta)
    const onAbrir = vi.fn()
    render(<MisVentasPiso abribles={new Set(['1'])} onAbrir={onAbrir} />)
    await screen.findByText('Venta 14')
    expect(screen.getAllByRole('button', { name: /Venta/ }).length).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: /Venta 14/ }))
    expect(onAbrir).toHaveBeenCalledWith('1')
  })

  it('Semana pide los últimos 7 días y Mes desde el día 1', async () => {
    svc.misCuentaVendedor.mockResolvedValue(cuenta)
    render(<MisVentasPiso abribles={new Set()} onAbrir={vi.fn()} />)
    await screen.findByText('Venta 14')
    fireEvent.click(screen.getByRole('button', { name: 'Semana' }))
    await waitFor(() => expect(svc.misCuentaVendedor).toHaveBeenLastCalledWith('2026-11-05', '2026-11-11'))
    fireEvent.click(screen.getByRole('button', { name: 'Mes' }))
    await waitFor(() => expect(svc.misCuentaVendedor).toHaveBeenLastCalledWith('2026-11-01', '2026-11-11'))
  })

  it('si la función todavía no existe en la base, avisa sin romperse', async () => {
    svc.misCuentaVendedor.mockRejectedValue(Object.assign(new Error('function public.mi_cuenta_vendedor(date, date) does not exist'), { code: '42883' }))
    render(<MisVentasPiso abribles={new Set()} onAbrir={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toBe('Todavía no está disponible')
  })
})
