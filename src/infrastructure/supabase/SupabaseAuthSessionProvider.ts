import type { AuthSession, AuthSessionProvider, AuthUser, MockRole } from '../../application/auth/AuthSessionProvider'
import { supabase } from './supabaseClient'

interface PerfilRow {
  id: string
  nombre: string
  rol: MockRole
  email: string | null
  activo: boolean
}

const SESSION_TTL_MS = 8 * 3600000

const resolveSession = async (userId: string): Promise<AuthSession> => {
  const { data, error } = await supabase.from('perfil').select('id,nombre,rol,email,activo').eq('id', userId).maybeSingle()
  if (error) throw error
  const perfil = data as PerfilRow | null
  const user: AuthUser = perfil
    ? { id: perfil.id, name: perfil.nombre, role: perfil.rol, active: perfil.activo, email: perfil.email ?? undefined }
    // No perfil row for this auth user: keep existing PosPage handling (hasProfile===false -> 'unauthorized' block screen).
    : { id: userId, name: '', role: 'operario', active: true, hasProfile: false }
  return { user, expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() }
}

export class SupabaseAuthSessionProvider implements AuthSessionProvider {
  private listeners = new Set<(session: AuthSession | null) => void>()

  constructor() {
    // Brief I: un 401 de una consulta cualquiera (JWT vencido, red caída, lo que
    // sea) NO es motivo para expulsar — solo un SIGNED_OUT real de GoTrueClient
    // (logout explícito, o refresco de token fallado de verdad: eso también lo
    // emite como SIGNED_OUT, no hace falta reimplementarlo acá). Antes, cualquier
    // evento con `authSession` null caía por la misma rama que SIGNED_OUT —
    // INITIAL_SESSION con sesión null (arranque en frío, nunca hubo login) es
    // legítimo y sigue mostrando el login, pero ya no se trata como una expulsión.
    supabase.auth.onAuthStateChange((event: string, authSession: { user: { id: string } } | null) => {
      if (event === 'SIGNED_OUT') {
        this.listeners.forEach((listener) => listener(null))
        return
      }
      if (!authSession) {
        if (event === 'INITIAL_SESSION') this.listeners.forEach((listener) => listener(null))
        return
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        void resolveSession(authSession.user.id).then((session) => this.listeners.forEach((listener) => listener(session)))
      }
    })
  }

  async getSession(): Promise<AuthSession | null> {
    const { data, error } = await supabase.auth.getSession()
    if (error) throw error
    const authSession = data.session
    if (!authSession) return null
    return resolveSession(authSession.user.id)
  }

  async setMockUser(): Promise<void> {
    throw new Error('No aplica en modo Supabase — usa signIn/signOut')
  }

  subscribe(listener: (session: AuthSession | null) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async signIn(email: string, password: string): Promise<void> {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async signOut(): Promise<void> {
    await supabase.auth.signOut()
  }
}

export const supabaseAuthSessionProvider = new SupabaseAuthSessionProvider()
