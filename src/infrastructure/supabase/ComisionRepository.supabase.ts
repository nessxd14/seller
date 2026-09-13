import { supabase } from './supabaseClient'
import type { ReportDateRange } from '../../application/ports/reportsRepository'
import type {
  ComisionDevengoRow, ComisionesRepository, ComisionProductoHuerfano, ComisionRegla, ComisionReglaInput,
  ComisionVendedor,
} from '../../application/ports/comisionesRepository'
import { numericToCents } from './mappers'

const num = (value: unknown): number => (value === null || value === undefined || value === '' ? 0 : Number(value))
// porcentaje viene como fracción (0.01 = 1%) -> basis points (100).
const fracToBp = (value: unknown): number => Math.round(num(value) * 10000)
const bpToFrac = (bp: number): number => bp / 10000

const toDevengoRow = (row: Record<string, unknown>): ComisionDevengoRow => ({
  id: String(row.id),
  origen: row.origen as ComisionDevengoRow['origen'],
  documentoId: String(row.origen === 'PEDIDO' ? row.pedido_id : row.venta_id),
  vendedorEmail: String(row.vendedor_email),
  fecha: String(row.documento_fecha),
  baseComisionableCents: numericToCents(num(row.base_comisionable)),
  totalDocumentoCents: numericToCents(num(row.total_documento)),
  porcentajeBp: fracToBp(row.porcentaje),
  montoCents: numericToCents(num(row.monto)),
  estado: row.estado as ComisionDevengoRow['estado'],
})

const toRegla = (row: Record<string, unknown>): ComisionRegla => ({
  id: String(row.id),
  tipo: row.tipo as ComisionRegla['tipo'],
  patron: String(row.patron),
  accion: row.accion as ComisionRegla['accion'],
  porcentajeBp: fracToBp(row.porcentaje),
  prioridad: num(row.prioridad),
  activo: Boolean(row.activo),
  nota: (row.nota as string | null) ?? null,
  creadoPor: (row.creado_por as string | null) ?? null,
  creadoEn: String(row.creado_en),
})

const reglaToRow = (input: ComisionReglaInput) => ({
  tipo: input.tipo,
  patron: input.patron,
  accion: input.accion,
  porcentaje: bpToFrac(input.porcentajeBp),
  prioridad: input.prioridad,
  activo: input.activo,
  nota: input.nota,
  creado_por: input.creadoPor,
})

export class SupabaseComisionesRepository implements ComisionesRepository {
  async getMisComisiones(input: { vendedorEmail: string; dates: ReportDateRange }): Promise<ComisionDevengoRow[]> {
    // RLS ya restringe esto a las filas del vendedor de la sesión — el filtro por email
    // acá es defensivo, no la fuente de la restricción.
    const { data, error } = await supabase.from('comision_devengo').select('*')
      .eq('vendedor_email', input.vendedorEmail)
      .gte('documento_fecha', input.dates.from).lte('documento_fecha', input.dates.to)
      .order('documento_fecha', { ascending: false })
    if (error) throw error
    return (data ?? []).map(toDevengoRow)
  }

  async getEquipo(input: { dates: ReportDateRange }): Promise<ComisionDevengoRow[]> {
    const { data, error } = await supabase.from('comision_devengo').select('*')
      .gte('documento_fecha', input.dates.from).lte('documento_fecha', input.dates.to)
      .order('vendedor_email').order('documento_fecha', { ascending: false })
    if (error) throw error
    return (data ?? []).map(toDevengoRow)
  }

  async listReglas(): Promise<ComisionRegla[]> {
    const { data, error } = await supabase.from('comision_regla').select('*').order('accion').order('prioridad').order('patron')
    if (error) throw error
    return (data ?? []).map(toRegla)
  }

  async createRegla(input: ComisionReglaInput): Promise<ComisionRegla> {
    const { data, error } = await supabase.from('comision_regla').insert(reglaToRow(input)).select('*').single()
    if (error) throw error
    return toRegla(data)
  }

  async updateRegla(id: string, input: ComisionReglaInput): Promise<ComisionRegla> {
    const { data, error } = await supabase.from('comision_regla').update(reglaToRow(input)).eq('id', id).select('*').single()
    if (error) throw error
    return toRegla(data)
  }

  async deleteRegla(id: string): Promise<void> {
    const { error } = await supabase.from('comision_regla').delete().eq('id', id)
    if (error) throw error
  }

  async listVendedores(): Promise<ComisionVendedor[]> {
    const { data, error } = await supabase.from('comision_vendedor').select('perfil_id,activo,desde,nota,perfil(nombre,email)').order('desde')
    if (error) throw error
    return (data ?? []).map((row: Record<string, unknown>) => {
      const perfil = row.perfil as { nombre?: string; email?: string } | null
      return {
        perfilId: String(row.perfil_id),
        nombre: perfil?.nombre ?? '',
        email: perfil?.email ?? '',
        activo: Boolean(row.activo),
        desde: String(row.desde),
        nota: (row.nota as string | null) ?? null,
      }
    })
  }

  async setVendedorActivo(perfilId: string, activo: boolean): Promise<void> {
    const { error } = await supabase.from('comision_vendedor').update({ activo }).eq('perfil_id', perfilId)
    if (error) throw error
  }

  async addVendedor(perfilId: string, nota?: string): Promise<ComisionVendedor> {
    const { data, error } = await supabase.from('comision_vendedor').insert({ perfil_id: perfilId, nota: nota ?? null })
      .select('perfil_id,activo,desde,nota,perfil(nombre,email)').single()
    if (error) throw error
    const perfil = data.perfil as { nombre?: string; email?: string } | null
    return { perfilId: String(data.perfil_id), nombre: perfil?.nombre ?? '', email: perfil?.email ?? '', activo: Boolean(data.activo), desde: String(data.desde), nota: (data.nota as string | null) ?? null }
  }

  async listPerfilesDisponibles(): Promise<Array<{ id: string; nombre: string; email: string }>> {
    const { data: existentes, error: e1 } = await supabase.from('comision_vendedor').select('perfil_id')
    if (e1) throw e1
    const excluidos = (existentes ?? []).map((r: { perfil_id: string }) => r.perfil_id)
    let builder = supabase.from('perfil').select('id,nombre,email').eq('activo', true).order('nombre')
    if (excluidos.length) builder = builder.not('id', 'in', `(${excluidos.join(',')})`)
    const { data, error } = await builder
    if (error) throw error
    return (data ?? []).map((row: { id: string; nombre: string; email: string }) => ({ id: row.id, nombre: row.nombre, email: row.email }))
  }

  async getProductosHuerfanos(dates: ReportDateRange): Promise<ComisionProductoHuerfano[]> {
    // v_comision_huerfano_linea es línea a línea — se agrega client-side por producto,
    // igual que getSummary en ReportsRepository (volumen chico, sin paginar 1000 filas).
    const { data, error } = await supabase.from('v_comision_huerfano_linea').select('*')
      .gte('fecha', dates.from).lte('fecha', dates.to)
    if (error) throw error
    const porProducto = new Map<string, ComisionProductoHuerfano>()
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const id = String(row.producto_id)
      const existente = porProducto.get(id)
      const monto = numericToCents(num(row.monto))
      if (existente) existente.montoVendidoCents += monto
      else porProducto.set(id, { productoId: id, productoNombre: String(row.producto_nombre ?? ''), marca: (row.marca as string | null) ?? null, montoVendidoCents: monto })
    }
    return [...porProducto.values()].sort((a, b) => b.montoVendidoCents - a.montoVendidoCents)
  }
}

export const comisionesRepository = new SupabaseComisionesRepository()
