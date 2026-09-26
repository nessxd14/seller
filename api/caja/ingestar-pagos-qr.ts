import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'node:crypto'

// Brief Caja-2 A3 — ingesta del scraper BNB QR. Mismo esqueleto que
// api/cron/sync-despachos.ts (imports, manejo de env vars, formato de error), pero acá
// SÍ hay una identidad externa que verificar: el scraper nunca tiene sesión de usuario
// del Seller, así que el único auth aceptado es un secreto compartido dedicado
// (QR_INGEST_SECRET) — nunca la service_role key ni la anon key, por la regla del
// proyecto de "un secreto por endpoint, nunca reusado".
const MAX_MOVIMIENTOS = 500

interface MovimientoEntrada {
  banco_id: string
  importe: number
  fecha_transaccion: string
  estado: string
  originante?: string
  glosa?: string
  raw?: unknown
}

// Constante en tiempo respecto al CONTENIDO del secreto — comparar buffers de largo
// distinto con timingSafeEqual tira, así que el único dato que se filtra por timing es
// el LARGO del header (no el secreto en sí), que es la misma superficie que acepta el
// brief ("crypto.timingSafeEqual on equal-length buffers").
function secretoValido(header: string | string[] | undefined, secreto: string): boolean {
  const valor = Array.isArray(header) ? header[0] : header
  if (!valor) return false
  const provisto = Buffer.from(valor)
  const esperado = Buffer.from(secreto)
  if (provisto.length !== esperado.length) return false
  return timingSafeEqual(provisto, esperado)
}

const ISO_CON_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

function validarMovimiento(m: unknown): m is MovimientoEntrada {
  if (typeof m !== 'object' || m === null) return false
  const v = m as Record<string, unknown>
  if (typeof v.banco_id !== 'string' || !v.banco_id.trim()) return false
  if (typeof v.importe !== 'number' || !Number.isFinite(v.importe)) return false
  if (typeof v.fecha_transaccion !== 'string' || !ISO_CON_OFFSET.test(v.fecha_transaccion)) return false
  if (typeof v.estado !== 'string' || !v.estado.trim()) return false
  if (v.originante !== undefined && typeof v.originante !== 'string') return false
  if (v.glosa !== undefined && typeof v.glosa !== 'string') return false
  return true
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const ingestSecret = process.env.QR_INGEST_SECRET
  if (!ingestSecret) { res.status(500).json({ error: 'QR_INGEST_SECRET no está configurado en el servidor' }); return }
  if (!secretoValido(req.headers['x-ingest-secret'], ingestSecret)) { res.status(401).json({ error: 'No autorizado' }); return }

  const body = req.body as { fuente?: unknown; version?: unknown; movimientos?: unknown } | null | undefined
  if (!body || typeof body !== 'object') { res.status(400).json({ error: 'Body inválido' }); return }
  if (body.fuente !== 'bnb-qr') { res.status(400).json({ error: "fuente debe ser 'bnb-qr'" }); return }
  if (body.version !== undefined && typeof body.version !== 'string') { res.status(400).json({ error: 'version debe ser un string' }); return }
  if (!Array.isArray(body.movimientos)) { res.status(400).json({ error: 'movimientos debe ser un array' }); return }
  if (body.movimientos.length > MAX_MOVIMIENTOS) { res.status(400).json({ error: `movimientos no puede tener más de ${MAX_MOVIMIENTOS} filas` }); return }
  if (!body.movimientos.every(validarMovimiento)) { res.status(400).json({ error: 'Una o más filas de movimientos tienen un shape inválido' }); return }

  const cationUrl = process.env.VITE_SUPABASE_URL
  const cationServiceKey = process.env.CATION_SERVICE_ROLE_KEY
  if (!cationUrl || !cationServiceKey) { res.status(500).json({ error: 'Cation no está configurado en el servidor (falta CATION_SERVICE_ROLE_KEY)' }); return }
  const cation = createClient(cationUrl, cationServiceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data, error } = await cation.rpc('ingestar_pagos_qr', {
    p_movimientos: body.movimientos,
    p_version: body.version ?? null,
  })
  if (error) {
    // Nunca loguear el body completo (puede traer datos bancarios) ni el secreto —
    // solo el conteo y el mensaje de error de Postgres.
    console.error(`[ingestar-pagos-qr] ${body.movimientos.length} fila(s): ${error.message}`)
    res.status(500).json({ error: error.message })
    return
  }

  console.log(`[ingestar-pagos-qr] recibidos=${body.movimientos.length} resultado=${JSON.stringify(data)}`)
  res.status(200).json(data)
}
