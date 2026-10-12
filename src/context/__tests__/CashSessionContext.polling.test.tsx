// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

const h = vi.hoisted(() => ({ getSesionAbierta: vi.fn(), getSession: vi.fn() }))
vi.mock('../../config/featureFlags', () => ({ featureFlags: { supabase: true } }))
vi.mock('../../infrastructure/services', () => ({
  turnoService: { getSesionAbierta: h.getSesionAbierta },
  authSessionProvider: { getSession: h.getSession },
}))
import { CashSessionProvider } from '../CashSessionContext'

const setVisibility = (v: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v })
}

beforeEach(() => {
  vi.useFakeTimers()
  h.getSesionAbierta.mockReset().mockResolvedValue(null)
  h.getSession.mockReset().mockResolvedValue({ user: { id: 'u', role: 'admin', active: true } })
  setVisibility('visible')
})
afterEach(() => { cleanup(); vi.useRealTimers(); setVisibility('visible') })

it('sondea cada 60 s con la pestaña visible', async () => {
  render(<CashSessionProvider><div /></CashSessionProvider>)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  expect(h.getSesionAbierta).toHaveBeenCalledTimes(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(59_000) })
  expect(h.getSesionAbierta).toHaveBeenCalledTimes(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
  expect(h.getSesionAbierta).toHaveBeenCalledTimes(2)
})

it('no llama getSesionAbierta con la pestaña oculta y refresca al volver a verla', async () => {
  render(<CashSessionProvider><div /></CashSessionProvider>)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  h.getSesionAbierta.mockClear()
  setVisibility('hidden')
  await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000) })
  expect(h.getSesionAbierta).not.toHaveBeenCalled()
  setVisibility('visible')
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0) })
  expect(h.getSesionAbierta).toHaveBeenCalledTimes(1)
})
