import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))
import { verificarSesionPos } from '../_auth'

const clienteConPerfil = (perfil: unknown) => ({
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.test' } }, error: null }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: perfil, error: null }) }) }) }),
})

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://x.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon')
})
afterEach(() => { vi.unstubAllEnvs(); createClientMock.mockReset() })

describe('verificarSesionPos — perfil activo', () => {
  it.each([[{ rol: 'cajero', activo: null }], [{ rol: 'cajero', activo: false }], [{ rol: 'cajero' }], [null]])('rechaza %j', async (perfil) => {
    createClientMock.mockReturnValue(clienteConPerfil(perfil))
    expect(await verificarSesionPos('Bearer t')).toBeNull()
  })
  it('acepta activo === true y devuelve activo: true', async () => {
    createClientMock.mockReturnValue(clienteConPerfil({ rol: 'cajero', activo: true }))
    expect(await verificarSesionPos('Bearer t')).toEqual({ userId: 'u1', email: 'a@b.test', rol: 'cajero', activo: true })
  })
})
