// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('../EscanerContinuo', () => ({ EscanerContinuo: () => null, useWakeLock: () => {}, vibrarDesconocido: vi.fn() }))
vi.mock('../usePedidosPiso', () => ({ usePedidosPiso: () => ({ activo: { clave: 'local', estado: 'ARMANDO', lineas: [] }, pedidos: [], abiertos: 1, errorPedido: {}, agregar: vi.fn() }) }))
vi.mock('../../../infrastructure/services', () => ({ listPresentations: vi.fn(), productRepository: {} }))
vi.mock('../../../infrastructure/supabase/SupabaseAuthSessionProvider', () => ({ supabaseAuthSessionProvider: {} }))
vi.mock('../../transfers/TransfersPage', () => ({ TransfersPage: ({ session }: { session: { user: { role: string } } }) => <p>Traslados para {session.user.role}</p> }))
import { PedidoPisoApp } from '../PedidoPisoApp'
afterEach(cleanup)
it('el vendedor entra a traslados desde Piso y regresa a su pedido', () => {
  render(<PedidoPisoApp session={{ user: { id: 'u', name: 'QA', role: 'vendedor', active: true }, expiresAt: '2999-01-01' }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Traslados' }))
  expect(screen.getByText('Traslados para vendedor')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Volver a mi pedido' }))
  expect(screen.getByRole('button', { name: 'Enviar a caja' })).toBeTruthy()
})
