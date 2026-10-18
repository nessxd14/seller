// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CobroPedidoBadge, ResumenCobroPedido } from '../CobroPedidoBadge'
import { cobroNoDisponible } from '../../domain/orders/cobroPedido'

afterEach(cleanup)
describe('indicadores de cobro del pedido', () => {
  it('distingue pago confirmado y entrega pendiente', () => {
    render(<ResumenCobroPedido cobro={{ ...cobroNoDisponible, estado: 'pagado', totalCents: 10000, aplicadoCents: 10000, partidas: 2 }} />)
    expect(screen.getByText('Pagado')).toBeTruthy()
    expect(screen.getByText(/La entrega se consulta en el estado del pedido/)).toBeTruthy()
  })
  it('separa la recepción por verificar del importe que aún falta registrar', () => {
    render(<CobroPedidoBadge cobro={{ ...cobroNoDisponible, estado: 'por_verificar', enRevisionCents: 6000, porCobrarCents: 4000 }} />)
    expect(screen.getByText('Por verificar')).toBeTruthy()
    expect(screen.getByText(/60,00 en revisión/)).toBeTruthy()
    expect(screen.getByText(/Pendiente.*40,00/)).toBeTruthy()
    expect(screen.queryByText('Pagado')).toBeNull()
  })
  it('cargar o fallar una consulta nunca muestra saldo cero', () => {
    const { rerender } = render(<CobroPedidoBadge cobro={null} />)
    expect(screen.getByText('Consultando cobro…')).toBeTruthy()
    rerender(<CobroPedidoBadge cobro={cobroNoDisponible} />)
    expect(screen.getByText('Cobro no disponible')).toBeTruthy()
    expect(screen.queryByText(/Saldo/)).toBeNull()
  })
})
