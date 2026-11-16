// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('../EscanerContinuo', () => ({ EscanerContinuo: () => null, useWakeLock: () => {}, vibrarDesconocido: vi.fn() }))
vi.mock('../usePedidosPiso', () => ({ usePedidosPiso: () => ({ activo: { clave: 'local', estado: 'ARMANDO', lineas: [] }, pedidos: [], abiertos: 1, errorPedido: {}, agregar: vi.fn() }) }))
vi.mock('../../../infrastructure/services', () => ({ listPresentations: vi.fn(), productRepository: {} }))
vi.mock('../../../infrastructure/supabase/SupabaseAuthSessionProvider', () => ({ supabaseAuthSessionProvider: {} }))
vi.mock('../TrasladosPiso', () => ({ TrasladosPiso: ({ iniciarPedido }: { iniciarPedido?: boolean }) => <p>Traslados móvil {iniciarPedido ? 'pedir' : 'lista'}</p> }))
vi.mock('../InicioPiso', () => ({ InicioPiso: ({ onTraslado }: { onTraslado: () => void }) => <button type="button" onClick={onTraslado}>Pedir traslado</button> }))
import { PedidoPisoApp } from '../PedidoPisoApp'
afterEach(cleanup)
const sesion = { user: { id: 'u', name: 'QA', role: 'vendedor' as const, active: true }, expiresAt: '2999-01-01' }

it('la pestaña Traslados muestra la vista móvil, no TransfersPage', () => {
  render(<PedidoPisoApp session={sesion} />)
  fireEvent.click(screen.getByRole('button', { name: 'Traslados' }))
  expect(screen.getByText('Traslados móvil lista')).toBeTruthy()
})

it('Pedir traslado de Inicio abre directo la pantalla de pedir', () => {
  render(<PedidoPisoApp session={sesion} />)
  fireEvent.click(screen.getByRole('button', { name: 'Pedir traslado' }))
  expect(screen.getByText('Traslados móvil pedir')).toBeTruthy()
})
