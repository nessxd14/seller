import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verificarSesionPos } from './_auth'

// Mismo patrón que registrar-cargo.ts: acá SÍ hace falta que el frontend distinga éxito de
// fallo — un fallo real dispara la cola de reintentos (pendiente_sync_hermes_pago) del
// lado del POS. p_movimiento_caja_id es la clave de idempotencia del otro lado (el id real
// que ya devolvió registrar_anticipo en Cation), así que un reintento con el mismo id es
// siempre éxito, nunca un caso especial a manejar acá.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const sesion = await verificarSesionPos(req.headers.authorization)
  if (!sesion) { res.status(401).json({ error: 'No autenticado' }); return }

  const { clienteId, monto, medio, pedidoId, movimientoCajaId, usuarioPos } = (req.body ?? {}) as {
    clienteId?: unknown; monto?: unknown; medio?: unknown; pedidoId?: unknown; movimientoCajaId?: unknown; usuarioPos?: unknown
  }
  const clienteIdNum = Number(clienteId)
  const montoNum = Number(monto)
  if (!Number.isFinite(clienteIdNum) || clienteIdNum <= 0 || !Number.isFinite(montoNum) || montoNum <= 0 || typeof medio !== 'string' || !medio || movimientoCajaId == null) {
    res.status(400).json({ error: 'Parámetros inválidos' })
    return
  }

  const hermesUrl = process.env.HERMES_URL
  const serviceKey = process.env.HERMES_SERVICE_ROLE_KEY
  if (!hermesUrl || !serviceKey) { res.status(500).json({ error: 'Hermes no está configurado en el servidor' }); return }

  try {
    const response = await fetch(`${hermesUrl}/rest/v1/rpc/proponer_pago`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        p_cliente_id_pos: clienteIdNum,
        p_monto: montoNum,
        p_medio: medio,
        p_pedido_id_pos: pedidoId != null ? String(pedidoId) : null,
        p_movimiento_caja_id: String(movimientoCajaId),
        p_usuario_pos: typeof usuarioPos === 'string' && usuarioPos ? usuarioPos : (sesion.email ?? sesion.userId),
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
    const row = Array.isArray(data) ? data[0] : data
    res.status(200).json({
      pagoId: row?.pago_id ?? row?.pagoId,
      saldoProvisional: row?.saldo_provisional ?? row?.saldoProvisional,
    })
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'No se pudo contactar a Hermes' })
  }
}
