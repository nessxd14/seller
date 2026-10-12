import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  from: vi.fn(),
  getSession: vi.fn(),
  authCb: null as null | ((event: string, s: { user: { id: string } } | null) => void),
}))
vi.mock('../../../config/featureFlags', () => ({ featureFlags: { supabase: true } }))
vi.mock('../supabaseClient', () => ({
  supabase: {
    from: h.from,
    auth: { getSession: h.getSession, onAuthStateChange: (cb: typeof h.authCb) => { h.authCb = cb } },
  },
}))
import { SupabaseAuthSessionProvider, invalidarSesionCache } from '../SupabaseAuthSessionProvider'

const perfil = { id: 'u1', nombre: 'Ana', rol: 'cajero', email: 'a@x.com', activo: true }

describe('SupabaseAuthSessionProvider — caché de perfil', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    invalidarSesionCache()
    h.maybeSingle.mockReset().mockResolvedValue({ data: perfil, error: null })
    h.from.mockReset().mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: h.maybeSingle }) }) })
    h.getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
  })
  afterEach(() => vi.useRealTimers())

  it('5 llamadas dentro de 5 minutos hacen una sola consulta a perfil', async () => {
    const provider = new SupabaseAuthSessionProvider()
    await provider.getSession()
    for (let i = 0; i < 4; i++) { await vi.advanceTimersByTimeAsync(50_000); await provider.getSession() }
    expect(h.maybeSingle).toHaveBeenCalledTimes(1)
  })

  it('llamadas concurrentes comparten una sola consulta', async () => {
    const provider = new SupabaseAuthSessionProvider()
    await Promise.all([provider.getSession(), provider.getSession(), provider.getSession()])
    expect(h.maybeSingle).toHaveBeenCalledTimes(1)
  })

  it('consulta de nuevo pasado el TTL de 5 minutos', async () => {
    const provider = new SupabaseAuthSessionProvider()
    await provider.getSession()
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1)
    await provider.getSession()
    expect(h.maybeSingle).toHaveBeenCalledTimes(2)
  })

  it('consulta de nuevo tras SIGNED_OUT seguido de SIGNED_IN', async () => {
    const provider = new SupabaseAuthSessionProvider()
    await provider.getSession()
    h.authCb?.('SIGNED_OUT', null)
    h.authCb?.('SIGNED_IN', { user: { id: 'u1' } })
    await vi.advanceTimersByTimeAsync(0)
    const callsAfterSignIn = h.maybeSingle.mock.calls.length
    expect(callsAfterSignIn).toBe(2)
    await provider.getSession()
    expect(h.maybeSingle).toHaveBeenCalledTimes(2)
  })

  it('TOKEN_REFRESHED reutiliza la caché si el usuario no cambió', async () => {
    const provider = new SupabaseAuthSessionProvider()
    const listener = vi.fn()
    provider.subscribe(listener)
    await provider.getSession()
    h.authCb?.('TOKEN_REFRESHED', { user: { id: 'u1' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.maybeSingle).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('no cachea errores y conserva hasProfile:false sin fila de perfil', async () => {
    const provider = new SupabaseAuthSessionProvider()
    h.maybeSingle.mockResolvedValueOnce({ data: null, error: new Error('red') })
    await expect(provider.getSession()).rejects.toThrow('red')
    h.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    const s = await provider.getSession()
    expect(s?.user.hasProfile).toBe(false)
    expect(h.maybeSingle).toHaveBeenCalledTimes(2)
  })
})
