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
  cached = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  // Brief I: los navegadores móviles congelan los temporizadores de pestañas en
  // segundo plano — autoRefreshToken no dispara mientras la pestaña está oculta, y
  // al volver el token ya venció (la primera consulta rebota con 401). Registrado
  // una sola vez, junto con el cliente — nunca por componente.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void cached?.auth.startAutoRefresh()
      else void cached?.auth.stopAutoRefresh()
    })
  }
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
