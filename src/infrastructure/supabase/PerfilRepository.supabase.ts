import { supabase } from './supabaseClient'

interface PerfilRow { email: string | null; nombre: string }

// Brief S3 Parte B: "creado_por es un texto con el email. Resolver el nombre contra
// perfil... con el email como respaldo si no hay perfil." Tabla chica (un puñado de
// usuarios) — se trae entera una vez y se cachea en memoria para el resto de la sesión.
let cache: Map<string, string> | null = null

const load = async (): Promise<Map<string, string>> => {
  if (cache) return cache
  const { data, error } = await supabase.from('perfil').select('email,nombre')
  if (error) throw error
  cache = new Map(((data ?? []) as PerfilRow[]).filter((row) => row.email).map((row) => [row.email!.toLowerCase(), row.nombre]))
  return cache
}

/** Nombre legible para un `creado_por` (email crudo) — el email mismo si no hay perfil. */
export const resolveNombrePorEmail = async (email: string | undefined | null): Promise<string> => {
  if (!email) return ''
  const map = await load()
  return map.get(email.toLowerCase()) ?? email
}

/** Resuelve varios a la vez (una sola carga de perfil, N lookups) — para listas/detalle
 * con más de un autor a mostrar junto. */
export const resolveNombresPorEmail = async (emails: Array<string | undefined | null>): Promise<Map<string, string>> => {
  const map = await load()
  const result = new Map<string, string>()
  for (const email of emails) {
    if (!email) continue
    result.set(email, map.get(email.toLowerCase()) ?? email)
  }
  return result
}
