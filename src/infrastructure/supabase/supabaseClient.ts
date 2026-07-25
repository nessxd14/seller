import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

export const getSupabaseClient = (): SupabaseClient => {
  if (cached) return cached
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!url || !anonKey) {
    throw new Error(
      'Faltan las variables de entorno VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Configura un archivo .env.local (ver .env.example).'
    )
  }
  cached = createClient(url, anonKey)
  return cached
}

// Proxy so consumers can `import { supabase } from './supabaseClient'` and call
// methods lazily without creating the client at module-import time (keeps tests
// that never touch supabase from failing when env vars are absent).
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getSupabaseClient()
    return Reflect.get(client, prop, receiver)
  },
})
