import { afterEach, describe, expect, it, vi } from 'vitest'
import { hermesHeaders } from '../_database'

afterEach(() => vi.unstubAllEnvs())
describe('selección de la cartera en REST', () => {
  it('selecciona hermes tanto para lecturas como para escrituras', () => {
    vi.stubEnv('HERMES_SCHEMA', 'hermes')
    const headers = hermesHeaders('test-server-key')
    expect(headers['Accept-Profile']).toBe('hermes')
    expect(headers['Content-Profile']).toBe('hermes')
    expect(headers.Authorization).toBe('Bearer test-server-key')
  })
  it('mantiene public durante la transición con el proyecto antiguo', () => {
    vi.stubEnv('HERMES_URL', 'https://vlthlcbcgvsrwxqazvne.supabase.co')
    vi.stubEnv('HERMES_SCHEMA', undefined)
    expect(hermesHeaders('test-server-key')['Content-Profile']).toBe('public')
  })
  it('rechaza configuraciones de esquema desconocidas', () => {
    vi.stubEnv('HERMES_SCHEMA', 'hremes')
    expect(() => hermesHeaders('test-server-key')).toThrow('HERMES_SCHEMA')
  })
  it('impide enviar pagos al esquema public de Cation por omisión', () => {
    vi.stubEnv('HERMES_URL', 'https://zxoxougwgstrarwymlvd.supabase.co')
    vi.stubEnv('HERMES_SCHEMA', undefined)
    expect(() => hermesHeaders('test-server-key')).toThrow('Cation requiere')
  })
})
