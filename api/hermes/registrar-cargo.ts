import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verificarSesionPos } from './_auth'

// A diferencia de consultar-saldo, acá SÍ hace falta que el frontend distinga éxito de
// fallo: un fallo real dispara la cola de reintentos (pendiente_sync_hermes) del lado
// del POS. La idempotencia (mismo venta_id -> mismo movimiento, nunca duplicado) ya la
// garantiza la RPC del lado de Hermes — acá no hay que tratarla como un caso especial,
// una respuesta 200 es éxito sea la primera llamada o un reintento.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const sesion = await verificarSesionPos(req.headers.authorization)
  if (!sesion) { res.status(401).json({ error: 'No autenticado' }); return }

  const { clienteId, monto, ventaId, usuarioPos } = (req.body ?? {}) as { clienteId?: unknown; monto?: unknown; ventaId?: unknown; usuarioPos?: unknown }
  const clienteIdNum = Number(clienteId)
  const montoNum = Number(monto)
  if (!Number.isFinite(clienteIdNum) || clienteIdNum <= 0 || !Number.isFinite(montoNum) || montoNum <= 0 || ventaId == null) {
    res.status(400).json({ error: 'Parámetros inválidos' })
    return
  }

  const hermesUrl = process.env.HERMES_URL
  const serviceKey = process.env.HERMES_SERVICE_ROLE_KEY
  if (!hermesUrl || !serviceKey) { res.status(500).json({ error: 'Hermes no está configurado en el servidor' }); return }

  try {
    const response = await fetch(`${hermesUrl}/rest/v1/rpc/registrar_cargo_saldo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        p_cliente_id: clienteIdNum,
        p_monto: montoNum,
        // Clave de idempotencia del otro lado: 'pos-venta-' || p_venta_id — siempre string.
        p_venta_id: String(ventaId),
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
      movimientoId: row?.movimiento_id ?? row?.movimientoId,
      saldoResultante: row?.saldo_resultante ?? row?.saldoResultante,
      cubiertoPorSaldo: row?.cubierto_por_saldo ?? row?.cubiertoPorSaldo,
    })
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'No se pudo contactar a Hermes' })
  }
}
