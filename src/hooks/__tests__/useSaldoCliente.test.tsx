// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SaldoDisponible } from '../../infrastructure/supabase/SaldoCliente.supabase'

const { consultar } = vi.hoisted(() => ({ consultar: vi.fn() }))
vi.mock('../../config/featureFlags', () => ({ featureFlags: { supabase: true } }))
vi.mock('../../infrastructure/supabase/SaldoCliente.supabase', () => ({ consultarSaldoDisponible: consultar }))
import { useSaldoCliente } from '../useSaldoCliente'

const creditor: SaldoDisponible = { sinCuenta: false, saldoConfirmado: -100, disponible: 100, esAcreedor: true, enRevision: 0, pedidoPendiente: 0, aplicadoPedido: 0 }
const retail: SaldoDisponible = { ...creditor, sinCuenta: true, saldoConfirmado: 0, disponible: 0, esAcreedor: false }
afterEach(() => { cleanup(); consultar.mockReset() })

describe('saldo del cliente seleccionado', () => {
  it('descarta una consulta anterior que llega después de seleccionar otro cliente', async () => {
    let resolveOld!: (value: SaldoDisponible) => void
    consultar.mockImplementation((id: string) => id === '1' ? new Promise<SaldoDisponible>(resolve => { resolveOld = resolve }) : Promise.resolve(retail))
    const { result, rerender } = renderHook(({ id }: { id?: string }) => useSaldoCliente(id), { initialProps: { id: '1' as string | undefined } })
    await waitFor(() => expect(consultar).toHaveBeenCalledWith('1', undefined))
    rerender({ id: '2' })
    await waitFor(() => expect(result.current.saldo?.sinCuenta).toBe(true))
    await act(async () => { resolveOld(creditor) })
    expect(result.current.saldo?.esAcreedor).toBe(false)
    expect(result.current.saldo?.disponible).toBe(0)
  })

  it('retira el saldo inmediatamente al volver al cliente de mostrador', async () => {
    consultar.mockResolvedValue(creditor)
    const { result, rerender } = renderHook(({ id }: { id?: string }) => useSaldoCliente(id), { initialProps: { id: '1' as string | undefined } })
    await waitFor(() => expect(result.current.saldo?.esAcreedor).toBe(true))
    rerender({ id: undefined })
    expect(result.current.saldo).toBeNull()
    expect(result.current.loading).toBe(false)
  })
})
