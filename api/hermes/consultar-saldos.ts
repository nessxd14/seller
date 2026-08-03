import type { VercelRequest, VercelResponse } from '@vercel/node'
// La extensión .js es obligatoria: package.json declara "type": "module".
// Sin ella: ERR_MODULE_NOT_FOUND y exit 1 en cada request (ya nos pasó).
import { verificarSesionPos } from './_auth.js'

// Batch de consultar-saldo.ts (singular) para la grilla de Clientes: un solo request
// para todos los clientes en vez de uno por tarjeta. Los ids que no vuelvan en el
// resultado son clientes sin cuenta corriente en Hermes, no clientes en cero.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const sesion = await verificarSesionPos(req.headers.authorization)
  if (!sesion) { res.status(401).json({ error: 'No autenticado' }); return }

  const clienteIds = req.body?.clienteIds
  if (!Array.isArray(clienteIds) || !clienteIds.length) { res.status(200).json({ saldos: [] }); return }

  const hermesUrl = process.env.HERMES_URL
  const serviceKey = process.env.HERMES_SERVICE_ROLE_KEY
  if (!hermesUrl || !serviceKey) { res.status(500).json({ error: 'Hermes no está configurado en el servidor' }); return }

  try {
    const response = await fetch(`${hermesUrl}/rest/v1/rpc/consultar_saldos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ p_cliente_ids: clienteIds }),
    })
    if (!response.ok) { res.status(502).json({ error: `Hermes respondió ${response.status}` }); return }
    const data = await response.json()
    res.status(200).json({ saldos: Array.isArray(data) ? data : [] })
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'No se pudo contactar a Hermes' })
  }
}
