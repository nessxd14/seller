import { supabase } from './supabaseClient'

// pendiente_sync_hermes_pago ya existe en esta base con RLS que ya permite ALL a
// authenticated — se usa directo, sin pasar por /api (no hay ninguna credencial de Hermes
// involucrada acá, es una tabla propia de Cation). Misma forma que
// PendienteSyncHermesRepository.ts para ventas, con movimiento_caja_id en vez de venta_id
// como clave de idempotencia (también UNIQUE del lado de la base).

export interface PendienteSyncHermesPago {
  id: string
  movimientoCajaId: string
  clienteId: string
  pedidoId?: string
  monto: number
  metodo: string
  usuarioPos: string | null
  intentos: number
  ultimoIntento?: string
  ultimoError?: string
  creadoEn: string
  sincronizadoEn?: string
}

interface PendienteSyncHermesPagoRow {
  id: number
  movimiento_caja_id: number
  cliente_id: number
  pedido_id: number | null
  monto: number | string
  metodo: string
  usuario_pos: string | null
  intentos: number
  ultimo_intento: string | null
  ultimo_error: string | null
  creado_en: string
  sincronizado_en: string | null
}

const rowToPendiente = (row: PendienteSyncHermesPagoRow): PendienteSyncHermesPago => ({
  id: String(row.id),
  movimientoCajaId: String(row.movimiento_caja_id),
  clienteId: String(row.cliente_id),
  pedidoId: row.pedido_id != null ? String(row.pedido_id) : undefined,
  monto: Number(row.monto),
  metodo: row.metodo,
  usuarioPos: row.usuario_pos,
  intentos: row.intentos,
  ultimoIntento: row.ultimo_intento ?? undefined,
  ultimoError: row.ultimo_error ?? undefined,
  creadoEn: row.creado_en,
  sincronizadoEn: row.sincronizado_en ?? undefined,
})

export const pendienteSyncHermesPagoRepository = {
  async listPendientes(): Promise<PendienteSyncHermesPago[]> {
    const { data, error } = await supabase.from('pendiente_sync_hermes_pago').select('*').is('sincronizado_en', null).order('creado_en', { ascending: false })
    if (error) throw error
    return (data ?? []).map(rowToPendiente as (row: unknown) => PendienteSyncHermesPago)
  },

  // movimiento_caja_id es único — la primera falla inserta la fila, las siguientes
  // (reintentos manuales que también fallan) suman a intentos en vez de duplicar filas.
  async registrarFallo(input: { movimientoCajaId: string; clienteId: string; pedidoId?: string; monto: number; metodo: string; usuarioPos: string; error: string }): Promise<void> {
    const { data: existing } = await supabase.from('pendiente_sync_hermes_pago').select('id, intentos').eq('movimiento_caja_id', Number(input.movimientoCajaId)).maybeSingle()
    const now = new Date().toISOString()
    if (existing) {
      const { error } = await supabase.from('pendiente_sync_hermes_pago')
        .update({ intentos: (existing as { intentos: number }).intentos + 1, ultimo_intento: now, ultimo_error: input.error })
        .eq('id', (existing as { id: number }).id)
      if (error) throw error
      return
    }
    const { error } = await supabase.from('pendiente_sync_hermes_pago').insert({
      movimiento_caja_id: Number(input.movimientoCajaId),
      cliente_id: Number(input.clienteId),
      pedido_id: input.pedidoId ? Number(input.pedidoId) : null,
      monto: input.monto,
      metodo: input.metodo,
      usuario_pos: input.usuarioPos,
      intentos: 1,
      ultimo_intento: now,
      ultimo_error: input.error,
    })
    if (error) throw error
  },

  async marcarSincronizado(id: string): Promise<void> {
    const { error } = await supabase.from('pendiente_sync_hermes_pago').update({ sincronizado_en: new Date().toISOString() }).eq('id', Number(id))
    if (error) throw error
  },
}
