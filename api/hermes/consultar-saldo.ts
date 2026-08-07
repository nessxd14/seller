import type { VercelRequest, VercelResponse } from '@vercel/node'
// La extensión .js es obligatoria: package.json declara "type": "module", así
// que estas funciones corren como ESM y el specifier tiene que apuntar al
// archivo EMITIDO. TypeScript resuelve './_auth.js' -> './_auth.ts' con
// moduleResolution "Bundler", así que el fuente sigue typechequeando.
// Sin la extensión: ERR_MODULE_NOT_FOUND y exit 1 en cada request.
import { verificarSesionPos } from './_auth.js'

// Nunca bloquear la UI por esto — cualquier fallo (auth, red) devuelve 200 con null,
// nunca un error que el frontend tenga que manejar distinto. Un cliente sin cuenta en
// Hermes es un caso real y distinto de un fallo: ver el bloque de la RPC más abajo.
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
    // consultar_saldo devuelve cero filas cuando el cliente no tiene contraparte
    // en Hermes (busca por pos_cliente_id) — PostgREST lo representa como [] (o null
    // para una función que devuelve un solo registro). Eso NO es "saldo cero" — es
    // "no tiene cuenta corriente", y el cajero necesita ver la diferencia.
    const row = Array.isArray(data) ? data[0] : data
    if (!row) { res.status(200).json({ sinCuenta: true }); return }
    res.status(200).json({
      // PostgREST serializa numeric como string ("922.40"). Sin Number() el
      // === 0 del frontend nunca se cumple y un cliente al día se ve como deudor.
      saldoConfirmado: Number(row.saldo_confirmado ?? row.saldoConfirmado ?? 0),
      saldoProvisional: Number(row.saldo_provisional ?? row.saldoProvisional ?? 0),
      situacion: row.situacion ?? null,
    })
  } catch {
    res.status(200).json(null)
  }
}
