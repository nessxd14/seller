import type { VercelRequest, VercelResponse } from '@vercel/node'
// La extensión .js es obligatoria: package.json declara "type": "module", así
// que estas funciones corren como ESM y el specifier tiene que apuntar al
// archivo EMITIDO. TypeScript resuelve './_auth.js' -> './_auth.ts' con
// moduleResolution "Bundler", así que el fuente sigue typechequeando.
// Sin la extensión: ERR_MODULE_NOT_FOUND y exit 1 en cada request.
import { verificarSesionPos, puedeMoverSaldo } from './_auth.js'

// Brief T4 Tarea 2: calcular_imputacion_fifo solo calcula, no escribe nada — se puede
// llamar tantas veces como haga falta mientras el vendedor ajusta cliente/monto, antes de
// guardar nada con imputar-pago.ts.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const sesion = await verificarSesionPos(req.headers.authorization)
  if (!sesion) { res.status(401).json({ error: 'No autenticado' }); return }
  if (!puedeMoverSaldo(sesion)) { res.status(403).json({ error: 'Tu rol no permite registrar movimientos de saldo' }); return }

  const { clienteId, monto } = (req.body ?? {}) as { clienteId?: unknown; monto?: unknown }
  const clienteIdNum = Number(clienteId)
  const montoNum = Number(monto)
  if (!Number.isFinite(clienteIdNum) || clienteIdNum <= 0 || !Number.isFinite(montoNum) || montoNum <= 0) {
    res.status(400).json({ error: 'Parámetros inválidos' })
    return
  }

  const hermesUrl = process.env.HERMES_URL
  const serviceKey = process.env.HERMES_SERVICE_ROLE_KEY
  if (!hermesUrl || !serviceKey) { res.status(500).json({ error: 'Hermes no está configurado en el servidor' }); return }

  try {
    // calcular_imputacion_fifo filtra v_partida_estado.cliente_id directo, sin traducir
    // pos_cliente_id como sí hacen proponer_pago/consultar_saldo internamente — así que acá
    // hay que resolver el id interno de Hermes primero, o el filtro no encuentra nada.
    const clienteRes = await fetch(`${hermesUrl}/rest/v1/cliente?pos_cliente_id=eq.${clienteIdNum}&select=id`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    })
    const clienteRows = await clienteRes.json().catch(() => null)
    const clienteInternoId = Array.isArray(clienteRows) && clienteRows[0]?.id != null ? Number(clienteRows[0].id) : null
    if (!clienteRes.ok || clienteInternoId == null) {
      res.status(200).json({ filas: [] })
      return
    }

    const response = await fetch(`${hermesUrl}/rest/v1/rpc/calcular_imputacion_fifo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ p_cliente_id: clienteInternoId, p_monto: montoNum }),
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
    const rows = Array.isArray(data) ? data : []
    res.status(200).json({
      filas: rows.map((row: Record<string, unknown>) => ({
        partidaId: row.o_partida_id,
        referencia: row.o_referencia,
        total: row.o_total,
        pendiente: row.o_pendiente,
        aplica: row.o_aplica,
        restante: row.o_restante,
      })),
    })
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'No se pudo contactar a Hermes' })
  }
}
