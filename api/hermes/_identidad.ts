const MAX_USUARIO_POS = 120

/**
 * Identidad que se manda a Hermes para auditoría. Siempre sale de la sesión; `usuarioPos`
 * del body solo agrega el origen (la cola de reintentos de ConfigPage reenvía a nombre del
 * cajero original) y nunca reemplaza al usuario autenticado.
 */
export function usuarioAuditoria(
  sesion: { email: string | null; userId: string },
  usuarioPos: unknown,
): string {
  const identidad = sesion.email ?? sesion.userId
  if (typeof usuarioPos !== 'string') return identidad
  const origen = usuarioPos.trim().slice(0, MAX_USUARIO_POS)
  if (!origen || origen === identidad) return identidad
  return `${identidad} (origen: ${origen})`
}
