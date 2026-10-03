// Sin `.throwOnError()`, supabase-js devuelve `error` como un objeto plano
// ({ message, code, details, hint }), NO como instancia de Error. Si se relanza tal cual,
// los `error instanceof Error ? error.message : <genérico>` de la UI descartan el mensaje
// real de la base (p. ej. el del trigger "VTD-… no está cobrada…" o los de cerrar_turno).
// Este helper convierte en el borde del repositorio, conservando `code`/`details`/`hint`
// (esErrorAutorizacion depende de `code`).
export class DatabaseError extends Error {
  code?: string
  details?: string | null
  hint?: string | null
  constructor(source: { message?: string; code?: string; details?: string | null; hint?: string | null }) {
    super(source.message || 'Error de base de datos')
    this.name = 'DatabaseError'
    this.code = source.code
    this.details = source.details
    this.hint = source.hint
  }
}

export const toError = (error: unknown): Error => {
  if (error instanceof Error) return error
  if (error && typeof error === 'object') return new DatabaseError(error as { message?: string; code?: string; details?: string | null; hint?: string | null })
  return new Error(typeof error === 'string' && error ? error : 'Error de base de datos')
}
