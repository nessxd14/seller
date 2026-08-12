import type { VercelRequest, VercelResponse } from '@vercel/node'
// La extensión .js es obligatoria: package.json declara "type": "module".
// Sin ella: ERR_MODULE_NOT_FOUND y exit 1 en cada request (ya nos pasó).
import { verificarSesionPos } from './_auth.js'

// Brief T2 Tarea 2: saldo de los candidatos del panel de "cliente parecido". A
// diferencia de consultar-saldos.ts (que usa consultar_saldos, con INNER JOIN a
// v_saldo_cliente — un candidato sin cuenta corriente en Hermes simplemente no aparece
// en la respuesta), acá se necesita también partidas_abiertas y saber que el candidato
// SÍ existe en Hermes aunque tenga saldo cero, así que se llama a
// consultar_saldos_por_pos_ids (RPC nueva de Hermes, aplicada por Ness), que hace LEFT
// JOIN y siempre devuelve una fila por cada pos_cliente_id que sí tiene contraparte allá.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const sesion = await verificarSesionPos(req.headers.authorization)
  if (!sesion) { res.status(401).json({ error: 'No autenticado' }); return }

  const posIds = req.body?.posIds
  if (!Array.isArray(posIds) || !posIds.length) { res.status(200).json({ saldos: [] }); return }

  const hermesUrl = process.env.HERMES_URL
  const serviceKey = process.env.HERMES_SERVICE_ROLE_KEY
  if (!hermesUrl || !serviceKey) { res.status(502).json({ error: 'Hermes no está configurado en el servidor' }); return }

  try {
    const response = await fetch(`${hermesUrl}/rest/v1/rpc/consultar_saldos_por_pos_ids`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ p_pos_ids: posIds }),
    })
    if (!response.ok) { res.status(502).json({ error: `Hermes respondió ${response.status}` }); return }
    const data = await response.json()
    res.status(200).json({ saldos: Array.isArray(data) ? data : [] })
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'No se pudo contactar a Hermes' })
  }
}
