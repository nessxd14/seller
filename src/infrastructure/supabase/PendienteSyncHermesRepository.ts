import { supabase } from './supabaseClient'

// pendiente_sync_hermes ya existe en esta base (migración 2026-08-01_pendiente_sync_hermes.sql,
// aplicada) con RLS que ya permite ALL a authenticated — se usa directo, sin pasar por /api
// (no hay ninguna credencial de Hermes involucrada acá, es una tabla propia de Cation).

export interface PendienteSyncHermes {
  id: string
  ventaId: string
  clienteId: string
  monto: number
  usuarioPos: string | null
  intentos: number
  ultimoIntento?: string
  ultimoError?: string
  creadoEn: string
  sincronizadoEn?: string
}

interface PendienteSyncHermesRow {
  id: number
  venta_id: number
  cliente_id: number
  monto: number | string
  usuario_pos: string | null
  intentos: number
  ultimo_intento: string | null
  ultimo_error: string | null
  creado_en: string
  sincronizado_en: string | null
}

const rowToPendiente = (row: PendienteSyncHermesRow): PendienteSyncHermes => ({
  id: String(row.id),
  ventaId: String(row.venta_id),
  clienteId: String(row.cliente_id),
  monto: Number(row.monto),
  usuarioPos: row.usuario_pos,
  intentos: row.intentos,
  ultimoIntento: row.ultimo_intento ?? undefined,
  ultimoError: row.ultimo_error ?? undefined,
  creadoEn: row.creado_en,
  sincronizadoEn: row.sincronizado_en ?? undefined,
})

export const pendienteSyncHermesRepository = {
  async listPendientes(): Promise<PendienteSyncHermes[]> {
    const { data, error } = await supabase.from('pendiente_sync_hermes').select('*').is('sincronizado_en', null).order('creado_en', { ascending: false })
    if (error) throw error
    return (data ?? []).map(rowToPendiente as (row: unknown) => PendienteSyncHermes)
  },

  // venta_id es único — la primera falla inserta la fila, las siguientes (reintentos
  // manuales que también fallan) suman a intentos en vez de duplicar filas.
  async registrarFallo(input: { ventaId: string; clienteId: string; monto: number; usuarioPos: string; error: string }): Promise<void> {
    const { data: existing } = await supabase.from('pendiente_sync_hermes').select('id, intentos').eq('venta_id', Number(input.ventaId)).maybeSingle()
    const now = new Date().toISOString()
    if (existing) {
      const { error } = await supabase.from('pendiente_sync_hermes')
        .update({ intentos: (existing as { intentos: number }).intentos + 1, ultimo_intento: now, ultimo_error: input.error })
        .eq('id', (existing as { id: number }).id)
      if (error) throw error
      return
    }
    const { error } = await supabase.from('pendiente_sync_hermes').insert({
      venta_id: Number(input.ventaId),
      cliente_id: Number(input.clienteId),
      monto: input.monto,
      usuario_pos: input.usuarioPos,
      intentos: 1,
      ultimo_intento: now,
      ultimo_error: input.error,
    })
    if (error) throw error
  },

  async marcarSincronizado(id: string): Promise<void> {
    const { error } = await supabase.from('pendiente_sync_hermes').update({ sincronizado_en: new Date().toISOString() }).eq('id', Number(id))
    if (error) throw error
  },
}
