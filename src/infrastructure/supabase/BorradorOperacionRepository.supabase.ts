import { supabase } from './supabaseClient'
import type { BorradorOperacionRepository, MutationContext } from '../../application/ports/repositories'
import type { BorradorOperacionRecord, BorradorOperacionTipo } from '../../application/shared/models'
import { NotFoundError } from '../../application/errors/AppError'

interface BorradorRow {
  id: number
  usuario_id: string
  tipo: BorradorOperacionTipo
  sucursal_id: number | null
  titulo: string | null
  contenido: unknown
  creado_en: string
  actualizado_en: string
  expira_en: string
}

const rowToRecord = (row: BorradorRow): BorradorOperacionRecord => ({
  id: String(row.id),
  tipo: row.tipo,
  sucursalId: row.sucursal_id ?? undefined,
  titulo: row.titulo ?? undefined,
  contenido: row.contenido,
  creadoEn: row.creado_en,
  actualizadoEn: row.actualizado_en,
  expiraEn: row.expira_en,
})

/**
 * `usuario_id = auth.uid()` vía RLS (política `borrador_propio`) filtra list()/getById()
 * solas — no hace falta repetir el filtro acá. save() sí necesita el id explícito al
 * insertar (la tabla no tiene default para usuario_id).
 */
export class SupabaseBorradorOperacionRepository implements BorradorOperacionRepository {
  async list(): Promise<BorradorOperacionRecord[]> {
    const { data, error } = await supabase.from('borrador_operacion').select('*').order('actualizado_en', { ascending: false })
    if (error) throw error
    return (data ?? []).map((row) => rowToRecord(row as BorradorRow))
  }

  async getById(id: string): Promise<BorradorOperacionRecord | null> {
    const numericId = Number(id)
    if (!Number.isFinite(numericId)) return null
    const { data, error } = await supabase.from('borrador_operacion').select('*').eq('id', numericId).maybeSingle()
    if (error) throw error
    return data ? rowToRecord(data as BorradorRow) : null
  }

  async save(input: { id?: string; tipo: BorradorOperacionTipo; sucursalId?: number; titulo?: string; contenido: unknown }, context: MutationContext): Promise<BorradorOperacionRecord> {
    if (!context.actorId) throw new Error('No hay usuario autenticado para guardar el borrador')
    if (input.id) {
      const { error } = await supabase.from('borrador_operacion').update({
        tipo: input.tipo,
        sucursal_id: input.sucursalId ?? null,
        titulo: input.titulo || null,
        contenido: input.contenido,
        // actualizado_en/expira_en los pisa trg_borrador_touch — no se mandan acá.
      }).eq('id', Number(input.id))
      if (error) throw error
      const updated = await this.getById(input.id)
      if (!updated) throw new NotFoundError('No se pudo releer el borrador actualizado')
      return updated
    }
    const { data, error } = await supabase.from('borrador_operacion').insert({
      usuario_id: context.actorId,
      tipo: input.tipo,
      sucursal_id: input.sucursalId ?? null,
      titulo: input.titulo || null,
      contenido: input.contenido,
    }).select('*').single()
    if (error) throw error
    return rowToRecord(data as BorradorRow)
  }

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('borrador_operacion').delete().eq('id', Number(id))
    if (error) throw error
  }
}

export const borradorOperacionRepository = new SupabaseBorradorOperacionRepository()
