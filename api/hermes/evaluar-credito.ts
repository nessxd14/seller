import type { VercelRequest, VercelResponse } from '@vercel/node'
// La extensión .js es obligatoria: package.json declara "type": "module", así
// que estas funciones corren como ESM y el specifier tiene que apuntar al
// archivo EMITIDO. TypeScript resuelve './_auth.js' -> './_auth.ts' con
// moduleResolution "Bundler", así que el fuente sigue typechequeando.
// Sin la extensión: ERR_MODULE_NOT_FOUND y exit 1 en cada request.
import { verificarSesionPos } from './_auth.js'

// Tanda 3: mismo contrato de tres estados que consultar-saldo.ts — auth inválida → 401;
// Hermes caído/sin configurar/error de red → 502; cliente sin contraparte → 200 +
// { sinCuenta: true }. Solo advertencia (evaluarTope ya usa el mismo patrón en este POS):
// el llamador decide si sigue con la venta, esto nunca bloquea del lado del servidor.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const sesion = await verificarSesionPos(req.headers.authorization)
  if (!sesion) { res.status(401).json({ error: 'No autenticado' }); return }

  const clienteId = Number(req.body?.clienteId)
  const monto = Number(req.body?.monto)
  if (!Number.isFinite(clienteId) || clienteId <= 0 || !Number.isFinite(monto) || monto < 0) {
    res.status(400).json({ error: 'clienteId o monto inválido' }); return
  }

  const hermesUrl = process.env.HERMES_URL
  const serviceKey = process.env.HERMES_SERVICE_ROLE_KEY
  if (!hermesUrl || !serviceKey) { res.status(502).json({ error: 'Hermes no está configurado en el servidor' }); return }

  try {
    const response = await fetch(`${hermesUrl}/rest/v1/rpc/evaluar_credito_pos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ p_cliente_id: clienteId, p_monto: monto }),
    })
    if (!response.ok) { res.status(502).json({ error: `Hermes respondió ${response.status}` }); return }
    const data = await response.json()
    // evaluar_credito_pos devuelve cero filas cuando el cliente no tiene contraparte
    // en Hermes — mismo criterio que consultar_saldo, no es "crédito permitido".
    const row = Array.isArray(data) ? data[0] : data
    if (!row) { res.status(200).json({ sinCuenta: true }); return }
    res.status(200).json({
      permitido: row.permitido !== false,
      // PostgREST serializa numeric como string ("922.40"). Sin Number() el
      // === 0 del frontend nunca se cumple y un cliente al día se ve como deudor.
      saldoConfirmado: Number(row.saldo_confirmado ?? row.saldoConfirmado ?? 0),
      limiteCredito: row.limite_credito != null || row.limiteCredito != null ? Number(row.limite_credito ?? row.limiteCredito) : null,
      motivoAdvertencia: row.motivo_advertencia ?? row.motivoAdvertencia ?? null,
    })
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'No se pudo contactar a Hermes' })
  }
}
