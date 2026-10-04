// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SaldoPedidoModal } from '../SaldoPedidoModal'

const state = vi.hoisted(() => ({ available: 100, apply: vi.fn() }))
vi.mock('../../hooks/useSaldoCliente', () => ({ useSaldoCliente: () => ({ saldo: { disponible: state.available, pedidoPendiente: state.available }, loading: false, refresh: vi.fn() }) }))
vi.mock('../../infrastructure/supabase/SaldoCliente.supabase', () => ({ aplicarSaldoPedido: state.apply }))
afterEach(cleanup)
beforeEach(() => { localStorage.clear(); state.available = 100; state.apply.mockReset().mockResolvedValue({ usoId: 1 }) })

it('reabre un intento sin respuesta y conserva importe, turno y clave aunque el disponible haya cambiado', async () => {
  state.apply.mockRejectedValueOnce(new Error('Respuesta perdida'))
  const success = vi.fn()
  const view = render(<SaldoPedidoModal pedidoId="1" clienteId="35" numero="PED-TEST" sesionId="25" onClose={() => {}} onSuccess={success} />)
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar saldo al pedido' }))
  await screen.findByText('Respuesta perdida')
  const original = state.apply.mock.calls[0][0]
  view.unmount(); state.available = 0
  render(<SaldoPedidoModal pedidoId="1" clienteId="35" numero="PED-TEST" sesionId="26" onClose={() => {}} onSuccess={success} />)
  fireEvent.click(screen.getByRole('button', { name: 'Comprobar aplicación anterior' }))
  await waitFor(() => expect(success).toHaveBeenCalledTimes(1))
  expect(state.apply.mock.calls[1][0]).toEqual(original)
  expect(localStorage.getItem('roari-saldo-pedido:1')).toBeNull()
})
