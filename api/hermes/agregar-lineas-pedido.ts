import type { VercelRequest, VercelResponse } from '@vercel/node'
// La extensión .js es obligatoria: package.json declara "type": "module", así
// que estas funciones corren como ESM y el specifier tiene que apuntar al
// archivo EMITIDO. TypeScript resuelve './_auth.js' -> './_auth.ts' con
// moduleResolution "Bundler", así que el fuente sigue typechequeando.
// Sin la extensión: ERR_MODULE_NOT_FOUND y exit 1 en cada request.
import { verificarSesionPos } from './_auth.js'

// Brief S-I: a diferencia de los demás endpoints de api/hermes/*, este primero le pega a
// CATION (agregar_lineas_pedido), no a Hermes — y ahí corre con la sesión real del
// usuario, no con service_role: la función ya trae su propia guarda del lado de Cation
// (app_puede_inventariar()), así que alcanza con reenviar el token del usuario tal cual
// llegó (mismo criterio que verificarSesionPos usa internamente vía supabase-js). Recién
// con el monto_adicional que devuelve Cation se pasa a Hermes (procesar_adicion_pedido),
// y ahí sí con service_role — esa función exige contexto_confiable() o rol gerente/admin
// en Hermes, que el usuario de Seller no necesariamente tiene.
const extraerMensaje = (data: unknown, status: number): string => {
  if (data && typeof data === 'object' && ('message' in data || 'error_description' in data || 'hint' in data)) {
    const d = data as { message?: string; error_description?: string; hint?: string }
    return d.message ?? d.error_description ?? d.hint ?? `respondió ${status}`
  }
  return `respondió ${status}`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const authHeader = req.headers.authorization
  const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader
  const token = headerValue?.startsWith('Bearer ') ? headerValue.slice('Bearer '.length) : undefined
  const sesion = await verificarSesionPos(authHeader)
  if (!sesion || !token) { res.status(401).json({ error: 'No autenticado' }); return }

  const { pedidoId, lineas, motivo } = (req.body ?? {}) as { pedidoId?: unknown; lineas?: unknown; motivo?: unknown }
  const pedidoIdNum = Number(pedidoId)
  if (!Number.isFinite(pedidoIdNum) || pedidoIdNum <= 0 || !Array.isArray(lineas) || !lineas.length) {
    res.status(400).json({ error: 'Parámetros inválidos' })
    return
  }
  const usuario = sesion.email ?? sesion.userId
  const motivoNorm = typeof motivo === 'string' && motivo.trim() ? motivo.trim() : null

  const cationUrl = process.env.VITE_SUPABASE_URL
  const cationAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!cationUrl || !cationAnonKey) { res.status(500).json({ error: 'Cation no está configurado en el servidor' }); return }

  let pedidoIdResuelto: number
  let lineasAgregadas: number
  let montoAdicional: number
  try {
    const response = await fetch(`${cationUrl}/rest/v1/rpc/agregar_lineas_pedido`, {
      method: 'POST',
      // Token del usuario, no la anon key sola ni service_role: la RPC corre con los
      // permisos normales de quien está logueado (RLS + app_puede_inventariar()).
      headers: { 'Content-Type': 'application/json', apikey: cationAnonKey, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ p_pedido_id: pedidoIdNum, p_lineas: lineas, p_motivo: motivoNorm, p_usuario: usuario }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      res.status(502).json({ error: extraerMensaje(data, response.status) })
      return
    }
    const row = (data && typeof data === 'object') ? data as Record<string, unknown> : {}
    pedidoIdResuelto = Number(row.pedido_id ?? pedidoIdNum)
    lineasAgregadas = Number(row.lineas_agregadas ?? 0)
    montoAdicional = Number(row.monto_adicional ?? 0)
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'No se pudo contactar a Cation' })
    return
  }

  if (!Number.isFinite(montoAdicional) || montoAdicional <= 0) {
    // Las líneas ya quedaron agregadas en Cation — no hay monto que sincronizar en Hermes
    // (p. ej. ítems sin costo), así que no tiene sentido llamar a procesar_adicion_pedido
    // con un monto inválido.
    res.status(200).json({ pedidoId: pedidoIdResuelto, lineasAgregadas, montoAdicional: 0, camino: null })
    return
  }

  const hermesUrl = process.env.HERMES_URL
  const hermesServiceKey = process.env.HERMES_SERVICE_ROLE_KEY
  if (!hermesUrl || !hermesServiceKey) {
    res.status(502).json({ error: 'Las líneas se agregaron al pedido, pero Hermes no está configurado en el servidor', pedidoId: pedidoIdResuelto, lineasAgregadas, montoAdicional })
    return
  }

  try {
    const response = await fetch(`${hermesUrl}/rest/v1/rpc/procesar_adicion_pedido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: hermesServiceKey, Authorization: `Bearer ${hermesServiceKey}` },
      body: JSON.stringify({ p_pedido_id: pedidoIdNum, p_monto_adicional: montoAdicional, p_motivo: motivoNorm, p_usuario: usuario }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      // Las líneas ya quedaron agregadas en Cation (paso anterior, no se revierte acá) —
      // el mensaje de Hermes se reenvía tal cual, sin interpretarlo ni esconderlo (p. ej.
      // "el pedido no tiene ninguna partida abierta").
      res.status(502).json({ error: extraerMensaje(data, response.status), pedidoId: pedidoIdResuelto, lineasAgregadas, montoAdicional })
      return
    }
    const row = (data && typeof data === 'object') ? data as Record<string, unknown> : {}
    res.status(200).json({
      pedidoId: pedidoIdResuelto,
      lineasAgregadas,
      montoAdicional,
      camino: row.camino ?? null,
      partidaId: row.partida_id ?? null,
      entregaNumero: row.entrega_numero ?? null,
      documentoInterno: row.documento_interno ?? null,
      habilitantesReabiertos: row.habilitantes_reabiertos ?? null,
    })
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'No se pudo contactar a Hermes', pedidoId: pedidoIdResuelto, lineasAgregadas, montoAdicional })
  }
}
