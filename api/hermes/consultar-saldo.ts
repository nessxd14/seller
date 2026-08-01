import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verificarSesionPos } from './_auth'

// Nunca bloquear la UI por esto — cualquier fallo (auth, red, cliente no importado a
// Hermes) devuelve 200 con null, nunca un error que el frontend tenga que manejar
// distinto. El badge simplemente no se muestra.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json(null); return }

  const sesion = await verificarSesionPos(req.headers.authorization)
  if (!sesion) { res.status(200).json(null); return }

  const clienteId = Number(req.body?.clienteId)
  if (!Number.isFinite(clienteId) || clienteId <= 0) { res.status(200).json(null); return }

  const hermesUrl = process.env.HERMES_URL
  const serviceKey = process.env.HERMES_SERVICE_ROLE_KEY
  if (!hermesUrl || !serviceKey) { res.status(200).json(null); return }

  try {
    const response = await fetch(`${hermesUrl}/rest/v1/rpc/consultar_saldo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ p_cliente_id: clienteId }),
    })
    if (!response.ok) { res.status(200).json(null); return }
    const data = await response.json()
    // consultar_saldo devuelve cero filas cuando el cliente no está importado a Hermes
    // — PostgREST lo representa como [] (o null para una función que devuelve un solo
    // registro). Cualquiera de las dos formas es "no hay nada que mostrar".
    const row = Array.isArray(data) ? data[0] : data
    if (!row) { res.status(200).json(null); return }
    res.status(200).json({
      saldoConfirmado: row.saldo_confirmado ?? row.saldoConfirmado ?? 0,
      saldoProvisional: row.saldo_provisional ?? row.saldoProvisional ?? 0,
      situacion: row.situacion ?? null,
    })
  } catch {
    res.status(200).json(null)
  }
}
