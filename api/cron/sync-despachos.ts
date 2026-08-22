import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Brief S-F: mismo esqueleto que api/hermes/registrar-cargo.ts (imports, manejo de
// HERMES_URL/HERMES_SERVICE_ROLE_KEY, formato de error) — la diferencia es quién dispara
// esto: Vercel Cron, no un cajero, así que no hay sesión de usuario que verificar acá.
// En su lugar se verifica el header estándar que Vercel agrega solo cuando CRON_SECRET
// está configurado como variable de entorno (Authorization: Bearer ${CRON_SECRET}) — si
// no está configurado, Vercel no lo manda, y este endpoint queda sin ese chequeo hasta
// que se configure (ver nota en la descripción del PR).
const LIMITE_POR_CORRIDA = 50
const MAX_INTENTOS = 10

interface PendienteDespachoRow {
  id: number
  pedido_id: number
  fecha_completado: string
  creado_en: string
  intentos: number
  ultimo_error: string | null
  sincronizado_en: string | null
}

const extraerMensajeError = (data: unknown, status: number): string => {
  if (data && typeof data === 'object' && ('message' in data || 'error_description' in data || 'hint' in data)) {
    const d = data as { message?: string; error_description?: string; hint?: string }
    return d.message ?? d.error_description ?? d.hint ?? `Hermes respondió ${status}`
  }
  return `Hermes respondió ${status}`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return }

  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.authorization
    if (auth !== `Bearer ${cronSecret}`) { res.status(401).json({ error: 'No autorizado' }); return }
  }

  const hermesUrl = process.env.HERMES_URL
  const hermesServiceKey = process.env.HERMES_SERVICE_ROLE_KEY
  if (!hermesUrl || !hermesServiceKey) { res.status(500).json({ error: 'Hermes no está configurado en el servidor' }); return }

  // Lee de Cation, no de Hermes — necesita bypassear RLS sin sesión de usuario (esto lo
  // dispara un cron, no un cajero logueado), así que hace falta la service_role de Cation.
  // A diferencia de HERMES_SERVICE_ROLE_KEY (ya configurada), CATION_SERVICE_ROLE_KEY es
  // nueva — ver .env.example y la nota en la descripción del PR.
  const cationUrl = process.env.VITE_SUPABASE_URL
  const cationServiceKey = process.env.CATION_SERVICE_ROLE_KEY
  if (!cationUrl || !cationServiceKey) { res.status(500).json({ error: 'Cation no está configurado en el servidor (falta CATION_SERVICE_ROLE_KEY)' }); return }

  const cation = createClient(cationUrl, cationServiceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data, error } = await cation
    .from('pendiente_sync_hermes_despacho')
    .select('*')
    .is('sincronizado_en', null)
    .order('creado_en', { ascending: true })
    .limit(LIMITE_POR_CORRIDA)
  if (error) { res.status(500).json({ error: error.message }); return }

  const pendientes = (data ?? []) as PendienteDespachoRow[]
  let aplicados = 0
  let sinPartidaAbierta = 0
  let errores = 0
  let saltados = 0

  for (const row of pendientes) {
    // Ya superó el máximo de reintentos — no se vuelve a intentar, solo queda en el log
    // (no hace falta un mecanismo de alerta nuevo para esto, ver brief).
    if (row.intentos >= MAX_INTENTOS) {
      saltados++
      console.warn(`[sync-despachos] pedido ${row.pedido_id} (fila ${row.id}) superó ${MAX_INTENTOS} intentos, se deja de reintentar. Último error: ${row.ultimo_error ?? 'desconocido'}`)
      continue
    }

    try {
      const response = await fetch(`${hermesUrl}/rest/v1/rpc/sincronizar_entrega_pedido`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: hermesServiceKey, Authorization: `Bearer ${hermesServiceKey}` },
        body: JSON.stringify({
          p_pedido_id: row.pedido_id,
          p_fecha: row.fecha_completado,
          p_usuario: 'sync-despacho-automatico',
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        const mensaje = extraerMensajeError(body, response.status)
        await cation.from('pendiente_sync_hermes_despacho')
          .update({ intentos: row.intentos + 1, ultimo_error: mensaje })
          .eq('id', row.id)
        errores++
        console.error(`[sync-despachos] pedido ${row.pedido_id} (fila ${row.id}): ${mensaje}`)
        continue
      }

      const resultado = Array.isArray(body) ? body[0] : body
      const aplicado = Boolean(resultado?.aplicado)
      const motivo = resultado?.motivo as string | undefined

      if (aplicado) {
        await cation.from('pendiente_sync_hermes_despacho')
          .update({ sincronizado_en: new Date().toISOString() })
          .eq('id', row.id)
        aplicados++
      } else if (motivo === 'sin_partida_abierta') {
        // No es un error — todavía no toca. Se deja la fila tal cual (sin marcar,
        // sin sumar intentos) para que la próxima corrida la vuelva a intentar.
        sinPartidaAbierta++
      } else {
        // aplicado: false con un motivo distinto al esperado — no está documentado como
        // caso "no es un error", así que se trata como un fallo real.
        const mensaje = motivo ?? 'La RPC devolvió aplicado: false sin motivo reconocido'
        await cation.from('pendiente_sync_hermes_despacho')
          .update({ intentos: row.intentos + 1, ultimo_error: mensaje })
          .eq('id', row.id)
        errores++
        console.error(`[sync-despachos] pedido ${row.pedido_id} (fila ${row.id}): ${mensaje}`)
      }
    } catch (err) {
      // Fallo de red — no debe frenar al resto de la tanda.
      const mensaje = err instanceof Error ? err.message : 'No se pudo contactar a Hermes'
      await cation.from('pendiente_sync_hermes_despacho')
        .update({ intentos: row.intentos + 1, ultimo_error: mensaje })
        .eq('id', row.id)
      errores++
      console.error(`[sync-despachos] pedido ${row.pedido_id} (fila ${row.id}): ${mensaje}`)
    }
  }

  res.status(200).json({ procesados: pendientes.length, aplicados, sinPartidaAbierta, errores, saltados })
}
