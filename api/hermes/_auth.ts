import { createClient } from '@supabase/supabase-js'

/**
 * Verifica que la llamada venga de una sesión real de Supabase de Cation (el mismo
 * proyecto que usa el POS) — el frontend manda el access_token de su propia sesión en
 * el header Authorization. Esto NO tiene nada que ver con las credenciales de Hermes:
 * es solo para que /api/hermes/* no quede como un endpoint público sin más, dado que
 * registrar-cargo mueve plata. Las variables VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY
 * ya están configuradas en Vercel para el build del cliente — el prefijo VITE_ solo
 * afecta qué se empaqueta al bundle del navegador, no qué lee process.env del lado
 * del servidor, así que reusarlas acá es seguro.
 */
export async function verificarSesionPos(
  authHeader: string | string[] | undefined,
): Promise<{ userId: string; email: string | null; rol: string; activo: boolean } | null> {
  const header = Array.isArray(authHeader) ? authHeader[0] : authHeader
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length)
  const url = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey || !token) return null
  const supabase = createClient(url, anonKey)
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  const { data: perfil, error: perfilError } = await supabase.from('perfil').select('rol,activo').eq('id', data.user.id).maybeSingle()
  if (perfilError || !perfil || perfil.activo === false) return null
  return { userId: data.user.id, email: data.user.email ?? null, rol: perfil.rol as string, activo: perfil.activo !== false }
}

/** Roles autorizados a mover plata en Hermes. Deliberadamente restrictivo:
 *  agregar un rol acá es una decisión de negocio, no un detalle técnico. */
const ROLES_MOVIMIENTO = new Set(['admin', 'supervisor', 'cajero'])
export const puedeMoverSaldo = (sesion: { rol: string; activo: boolean }) =>
  sesion.activo && ROLES_MOVIMIENTO.has(sesion.rol)
