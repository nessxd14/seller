import type { VercelRequest, VercelResponse } from '@vercel/node'
// La extensión .js es obligatoria: package.json declara "type": "module", así
// que estas funciones corren como ESM y el specifier tiene que apuntar al
// archivo EMITIDO. TypeScript resuelve './_auth.js' -> './_auth.ts' con
// moduleResolution "Bundler", así que el fuente sigue typechequeando.
// Sin la extensión: ERR_MODULE_NOT_FOUND y exit 1 en cada request.
import { verificarSesionPos, puedeMoverSaldo } from './_auth.js'

// Brief T4 Tarea 2: guarda el reparto (editado o tal cual lo propuso el FIFO) contra un
// pago todavía PROPUESTO. imputar_pago valida del lado servidor (partida existe y es del
// cliente, monto no supera el pendiente, suma no supera el pago) y devuelve mensajes
// legibles — se reenvían tal cual, sin reemplazarlos por uno genérico.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const sesion = await verificarSesionPos(req.headers.authorization)
  if (!sesion) { res.status(401).json({ error: 'No autenticado' }); return }
  if (!puedeMoverSaldo(sesion)) { res.status(403).json({ error: 'Tu rol no permite registrar movimientos de saldo' }); return }

  const { pagoId, aplicaciones, usuarioPos } = (req.body ?? {}) as { pagoId?: unknown; aplicaciones?: unknown; usuarioPos?: unknown }
  const pagoIdNum = Number(pagoId)
  if (!Number.isFinite(pagoIdNum) || pagoIdNum <= 0 || !Array.isArray(aplicaciones) || !aplicaciones.length) {
    res.status(400).json({ error: 'Parámetros inválidos' })
    return
  }
  const aplicacionesValidas = aplicaciones.every((a) =>
    a && typeof a === 'object' && Number.isFinite(Number((a as { partidaId?: unknown }).partidaId)) && Number.isFinite(Number((a as { monto?: unknown }).monto))
  )
  if (!aplicacionesValidas) { res.status(400).json({ error: 'Parámetros inválidos' }); return }

  const hermesUrl = process.env.HERMES_URL
  const serviceKey = process.env.HERMES_SERVICE_ROLE_KEY
  if (!hermesUrl || !serviceKey) { res.status(500).json({ error: 'Hermes no está configurado en el servidor' }); return }

  try {
    const response = await fetch(`${hermesUrl}/rest/v1/rpc/imputar_pago`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        p_pago_id: pagoIdNum,
        p_aplicaciones: (aplicaciones as Array<{ partidaId: unknown; monto: unknown }>).map((a) => ({
          partida_id: Number(a.partidaId),
          monto: Number(a.monto),
        })),
        p_usuario: typeof usuarioPos === 'string' && usuarioPos ? usuarioPos : (sesion.email ?? sesion.userId),
      }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      const message = (data && typeof data === 'object' && ('message' in data || 'error_description' in data || 'hint' in data))
        ? ((data as { message?: string; error_description?: string; hint?: string }).message
          ?? (data as { message?: string; error_description?: string; hint?: string }).error_description
          ?? (data as { message?: string; error_description?: string; hint?: string }).hint)
        : `Hermes respondió ${response.status}`
      res.status(502).json({ error: message || `Hermes respondió ${response.status}` })
      return
    }
    const row = (data && typeof data === 'object') ? data as Record<string, unknown> : {}
    res.status(200).json({
      pagoId: row.pago_id,
      aplicaciones: row.aplicaciones,
      imputado: row.imputado,
      excedente: row.excedente,
    })
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'No se pudo contactar a Hermes' })
  }
}
