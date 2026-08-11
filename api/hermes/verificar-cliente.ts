import type { VercelRequest, VercelResponse } from '@vercel/node'
// La extensión .js es obligatoria: package.json declara "type": "module", así
// que estas funciones corren como ESM y el specifier tiene que apuntar al
// archivo EMITIDO. TypeScript resuelve './_auth.js' -> './_auth.ts' con
// moduleResolution "Bundler", así que el fuente sigue typechequeando.
// Sin la extensión: ERR_MODULE_NOT_FOUND y exit 1 en cada request.
import { verificarSesionPos } from './_auth.js'

// Brief S11 Bloque B4: paso 2 de "eliminar cliente" — antes de borrarlo en Cation hay que
// saber si existe en Hermes (si existe, hay que borrarlo primero desde el Conciliador).
// Reusa consultar_saldo (mismo RPC que consultar-saldo.ts): cero filas = el cliente no
// tiene contraparte en Hermes = no existe allá. No hace falta un RPC nuevo del lado de
// Hermes, esta pregunta ya la responde el mismo dato.
//
// Mismo contrato de tres estados que S4 (consultar-saldo.ts): auth inválida → 401; Hermes
// caído/sin configurar/error de red → 502 (y el llamador, según la decisión de Ness, trata
// ese 502 como "bloquear igual" — más seguro no borrar que borrar algo que estaba en
// Hermes); cliente sin contraparte → 200 + { existe: false }.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const sesion = await verificarSesionPos(req.headers.authorization)
  if (!sesion) { res.status(401).json({ error: 'No autenticado' }); return }

  const clienteId = Number(req.body?.clienteId)
  if (!Number.isFinite(clienteId) || clienteId <= 0) { res.status(400).json({ error: 'clienteId inválido' }); return }

  const hermesUrl = process.env.HERMES_URL
  const serviceKey = process.env.HERMES_SERVICE_ROLE_KEY
  if (!hermesUrl || !serviceKey) { res.status(502).json({ error: 'Hermes no está configurado en el servidor' }); return }

  try {
    const response = await fetch(`${hermesUrl}/rest/v1/rpc/consultar_saldo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ p_cliente_id: clienteId }),
    })
    if (!response.ok) { res.status(502).json({ error: `Hermes respondió ${response.status}` }); return }
    const data = await response.json()
    const row = Array.isArray(data) ? data[0] : data
    res.status(200).json({ existe: Boolean(row) })
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'No se pudo contactar a Hermes' })
  }
}
