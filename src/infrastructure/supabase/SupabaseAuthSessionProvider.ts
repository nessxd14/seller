import type { AuthSession, AuthSessionProvider, AuthUser, MockRole } from '../../application/auth/AuthSessionProvider'
import { supabase } from './supabaseClient'
import { featureFlags } from '../../config/featureFlags'

interface PerfilRow {
  id: string
  nombre: string
  rol: MockRole
  email: string | null
  activo: boolean
  sucursal_id: number | null
}

const SESSION_TTL_MS = 8 * 3600000

const resolveSession = async (userId: string): Promise<AuthSession> => {
  const { data, error } = await supabase.from('perfil').select('id,nombre,rol,email,activo,sucursal_id').eq('id', userId).maybeSingle()
  if (error) throw error
  const perfil = data as PerfilRow | null
  const user: AuthUser = perfil
    ? { id: perfil.id, name: perfil.nombre, role: perfil.rol, active: perfil.activo, email: perfil.email ?? undefined, sucursalId: perfil.sucursal_id ?? undefined }
    // No perfil row for this auth user: keep existing PosPage handling (hasProfile===false -> 'unauthorized' block screen).
    : { id: userId, name: '', role: 'operario', active: true, hasProfile: false }
  return { user, expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() }
}

// Caché del perfil: getSession() lo llaman muchos componentes (incl. CashSessionContext en
// cada tick) y cada llamada era un GET /perfil. El token se lee local; el perfil se reusa 5 min.
const PROFILE_TTL_MS = 5 * 60000
let cache: { userId: string; session: AuthSession; fetchedAt: number } | null = null
let inflight: { userId: string; promise: Promise<AuthSession> } | null = null
let generation = 0

export const invalidarSesionCache = () => { cache = null; inflight = null; generation++ }

const resolveSessionCached = (userId: string): Promise<AuthSession> => {
  if (cache && cache.userId === userId && Date.now() - cache.fetchedAt < PROFILE_TTL_MS) return Promise.resolve(cache.session)
  if (inflight && inflight.userId === userId) return inflight.promise
  const gen = generation
  const promise: Promise<AuthSession> = resolveSession(userId).then((session) => {
    // No se cachean errores (rechazan arriba) ni resultados de antes de una invalidación.
    if (gen === generation) cache = { userId, session, fetchedAt: Date.now() }
    return session
  }).finally(() => { if (inflight?.promise === promise) inflight = null })
  inflight = { userId, promise }
  return promise
}

export class SupabaseAuthSessionProvider implements AuthSessionProvider {
  private listeners = new Set<(session: AuthSession | null) => void>()

  constructor() {
    // El proveedor se importa también en modo mock; no debe crear el cliente real.
    if (!featureFlags.supabase) return
    // Brief I: un 401 de una consulta cualquiera (JWT vencido, red caída, lo que
    // sea) NO es motivo para expulsar — solo un SIGNED_OUT real de GoTrueClient
    // (logout explícito, o refresco de token fallado de verdad: eso también lo
    // emite como SIGNED_OUT, no hace falta reimplementarlo acá). Antes, cualquier
    // evento con `authSession` null caía por la misma rama que SIGNED_OUT —
    // INITIAL_SESSION con sesión null (arranque en frío, nunca hubo login) es
    // legítimo y sigue mostrando el login, pero ya no se trata como una expulsión.
    supabase.auth.onAuthStateChange((event: string, authSession: { user: { id: string } } | null) => {
      // Supabase re-emite SIGNED_IN al recuperar el foco: solo invalida si cambió el usuario.
      if (event === 'SIGNED_OUT' || event === 'USER_UPDATED' || (event === 'SIGNED_IN' && authSession?.user.id !== cache?.userId)) invalidarSesionCache()
      if (event === 'SIGNED_OUT') {
        this.listeners.forEach((listener) => listener(null))
        return
      }
      if (!authSession) {
        if (event === 'INITIAL_SESSION') this.listeners.forEach((listener) => listener(null))
        return
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        void resolveSessionCached(authSession.user.id).then((session) => this.listeners.forEach((listener) => listener(session)))
      }
    })
  }

  async getSession(): Promise<AuthSession | null> {
    const { data, error } = await supabase.auth.getSession()
    if (error) throw error
    const authSession = data.session
    if (!authSession) return null
    return resolveSessionCached(authSession.user.id)
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
