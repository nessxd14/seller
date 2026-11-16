import { describe, expect, it } from 'vitest'

describe('sinProduccion', () => {
  it('rechaza fetch hacia Supabase real', async () => {
    await expect(fetch('https://x.supabase.co/rest/v1/')).rejects.toThrow(
      'Test intentó llamar a Supabase real: https://x.supabase.co/rest/v1/',
    )
  })

  it('rechaza URL y Request', async () => {
    await expect(fetch(new URL('https://x.supabase.in/rest/v1/'))).rejects.toThrow('Supabase real')
    await expect(fetch(new Request('https://x.supabase.co/rest/v1/'))).rejects.toThrow('Supabase real')
  })

  it('usa la URL falsa en el entorno de pruebas', () => {
    expect(import.meta.env.VITE_SUPABASE_URL).toBe('http://127.0.0.1:54321')
  })
})
