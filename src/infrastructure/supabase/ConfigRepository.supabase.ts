import { supabase } from './supabaseClient'
import type { CajaSummary, ConfigRepository, EmpresaConfig, SucursalSummary, UserSummary } from '../../application/ports/configRepository'

interface ConfigEmpresaRow {
  id: number
  razon_social: string
  nit: string | null
  direccion: string | null
  ciudad: string | null
  telefono: string | null
  email: string | null
  pie_documento: string | null
}

const rowToEmpresaConfig = (row: ConfigEmpresaRow): EmpresaConfig => ({
  razonSocial: row.razon_social ?? '',
  nit: row.nit ?? '',
  direccion: row.direccion ?? '',
  ciudad: row.ciudad ?? '',
  telefono: row.telefono ?? '',
  email: row.email ?? '',
  pieDocumento: row.pie_documento ?? '',
})

export class SupabaseConfigRepository implements ConfigRepository {
  // config_empresa is a singleton row (id=1, seeded once by BRIEF_G_SQL). There is no
  // "create" concept here — getEmpresaConfig/saveEmpresaConfig always target id=1.
  async getEmpresaConfig(): Promise<EmpresaConfig> {
    const { data, error } = await supabase.from('config_empresa').select('*').eq('id', 1).limit(1).maybeSingle()
    if (error) throw error
    if (!data) throw new Error('config_empresa no tiene fila sembrada (id=1)')
    return rowToEmpresaConfig(data as ConfigEmpresaRow)
  }

  async saveEmpresaConfig(patch: Partial<EmpresaConfig>): Promise<EmpresaConfig> {
    const payload: Record<string, unknown> = { actualizado_en: new Date().toISOString() }
    if (patch.razonSocial !== undefined) payload.razon_social = patch.razonSocial
    if (patch.nit !== undefined) payload.nit = patch.nit || null
    if (patch.direccion !== undefined) payload.direccion = patch.direccion || null
    if (patch.ciudad !== undefined) payload.ciudad = patch.ciudad || null
    if (patch.telefono !== undefined) payload.telefono = patch.telefono || null
    if (patch.email !== undefined) payload.email = patch.email || null
    if (patch.pieDocumento !== undefined) payload.pie_documento = patch.pieDocumento || null
    const { data, error } = await supabase.from('config_empresa').update(payload).eq('id', 1).select('*').single()
    if (error) throw error
    return rowToEmpresaConfig(data as ConfigEmpresaRow)
  }

  // perfil requires an `authenticated` session per RLS (confirmed in a prior brief) —
  // read-only display here, no create/edit/delete UI (explicit security constraint).
  async listUsers(): Promise<UserSummary[]> {
    const { data, error } = await supabase.from('perfil').select('id,nombre,email,rol,activo').order('nombre')
    if (error) throw error
    return (data ?? []).map((row) => ({ id: String(row.id), nombre: row.nombre ?? '', email: row.email ?? '', rol: row.rol ?? '', activo: Boolean(row.activo) }))
  }

  // tipo='virtual' (the Shopify sucursal) is excluded — confirmed live via
  // information_schema/spot-check before writing this filter.
  async listSucursales(): Promise<SucursalSummary[]> {
    const { data, error } = await supabase.from('sucursal').select('id,nombre,tipo').neq('tipo', 'virtual').order('id')
    if (error) throw error
    return (data ?? []).map((row) => ({ id: row.id, nombre: row.nombre ?? '', tipo: row.tipo ?? '' }))
  }

  async listCajas(): Promise<CajaSummary[]> {
    const { data, error } = await supabase.from('caja').select('id,nombre,sucursal_id,activa').order('id')
    if (error) throw error
    return (data ?? []).map((row) => ({ id: row.id, nombre: row.nombre ?? '', sucursalId: row.sucursal_id, activa: Boolean(row.activa) }))
  }
}

export const configRepository = new SupabaseConfigRepository()
