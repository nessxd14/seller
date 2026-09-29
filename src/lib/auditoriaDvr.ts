// Brief Caja-2 B3 — puerto de la auditoría de DVR de Caja ROARI (lib/auditoriaDvr.js)
// al Seller: el POS dispara /start y /end automáticamente en vez de que el cajero
// apriete los botones a mano. Reglas duras heredadas tal cual, no negociables:
//   * fire-and-forget: nunca se espera la respuesta, nunca se propaga un error.
//   * timeout de 1.5 s con AbortController — un relay colgado no puede frenar al POS.
//   * keepalive: true — la request debe sobrevivir aunque la pestaña navegue.
//   * errores solo van a console.debug, nunca console.error/warn (no es un fallo real
//     del POS, es un audit trail best-effort).
//   * sin VITE_AUDIT_API_URL configurada, el módulo es un no-op TOTAL — ni siquiera
//     arma la URL. Así, previews de Vercel y cualquier PC sin este env var nunca
//     emiten nada por accidente.
const TIMEOUT_MS = 1500

const apiUrl = (): string | null => {
  const url = import.meta.env.VITE_AUDIT_API_URL as string | undefined
  return url && url.trim() ? url.replace(/\/+$/, '') : null
}

// Sin VITE_AUDIT_CAJA_ID configurada, cae al nombre de la caja (brief: "default is the
// caja name") — se resuelve en el momento de emitir, no acá, porque el nombre de caja
// puede no estar disponible todavía cuando este módulo se importa.
const cajaIdFromEnv = (): string | undefined => (import.meta.env.VITE_AUDIT_CAJA_ID as string | undefined)?.trim() || undefined

async function post(path: string, body: unknown): Promise<void> {
  const base = apiUrl()
  if (!base) return
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
      signal: controller.signal,
    })
  } catch (err) {
    // Nunca console.error/warn acá — un relay caído o lento no es un fallo del POS,
    // ver el comentario al tope del archivo.
    console.debug('[auditoriaDvr]', path, err)
  } finally {
    clearTimeout(timeout)
  }
}

export interface AuditStartInput {
  transactionId: string
  cajeroId?: string
  cajaId?: string
  clientTs?: string
}

export function auditStart(input: AuditStartInput): void {
  void post('/start', {
    transactionId: input.transactionId,
    cajaId: input.cajaId ?? cajaIdFromEnv(),
    cajeroId: input.cajeroId,
    clientTs: input.clientTs ?? new Date().toISOString(),
  })
}

export type AuditEndReason = 'completada' | 'cancelada' | 'suspendida'

export interface AuditEndInput {
  transactionId: string
  reason: AuditEndReason
  totalBs?: number
  numero?: string
}

export function auditEnd(input: AuditEndInput): void {
  void post('/end', {
    transactionId: input.transactionId,
    reason: input.reason,
    ...(input.totalBs != null ? { totalBs: input.totalBs } : {}),
    ...(input.numero != null ? { numero: input.numero } : {}),
  })
}
