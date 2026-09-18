import { supabase } from './supabaseClient'
import type { ReportDateRange } from '../../application/ports/reportsRepository'
import type {
  ComisionDevengoRow, ComisionesRepository, ComisionFiltros, ComisionLineaDevengo, ComisionLiquidacion,
  ComisionProductoHuerfano, ComisionRegla, ComisionReglaInput, ComisionSeguimiento, ComisionVendedor,
} from '../../application/ports/comisionesRepository'
import { numericToCents } from './mappers'

const num = (value: unknown): number => (value === null || value === undefined || value === '' ? 0 : Number(value))
// porcentaje viene como fracción (0.01 = 1%) -> basis points (100).
const fracToBp = (value: unknown): number => Math.round(num(value) * 10000)
const bpToFrac = (bp: number): number => bp / 10000

const DEVENGO_SELECT = '*, pedido:pedido_id(cliente:cliente_id(nombre)), venta:venta_id(cliente:cliente_id(nombre)), comision_liquidacion(creado_en)'

const toDevengoRow = (row: Record<string, unknown>): ComisionDevengoRow => {
  const pedido = row.pedido as { cliente?: { nombre?: string } | null } | null
  const venta = row.venta as { cliente?: { nombre?: string } | null } | null
  const liquidacion = row.comision_liquidacion as { creado_en?: string } | null
  return {
    id: String(row.id),
    origen: row.origen as ComisionDevengoRow['origen'],
    documentoId: String(row.origen === 'PEDIDO' ? row.pedido_id : row.venta_id),
    vendedorEmail: String(row.vendedor_email),
    clienteNombre: pedido?.cliente?.nombre ?? venta?.cliente?.nombre ?? null,
    fecha: String(row.documento_fecha),
    baseComisionableCents: numericToCents(num(row.base_comisionable)),
    totalDocumentoCents: numericToCents(num(row.total_documento)),
    porcentajeBp: fracToBp(row.porcentaje),
    montoCents: numericToCents(num(row.monto)),
    estado: row.estado as ComisionDevengoRow['estado'],
    liquidacionId: row.liquidacion_id === null || row.liquidacion_id === undefined ? null : String(row.liquidacion_id),
    liquidacionFecha: liquidacion?.creado_en ?? null,
    tienePersonalizadoComisionable: Boolean(row.tiene_personalizado_comisionable),
  }
}

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

const toLiquidacion = (row: Record<string, unknown>): ComisionLiquidacion => ({
  id: String(row.id),
  vendedorEmail: String(row.vendedor_email),
  montoTotalCents: numericToCents(num(row.monto_total)),
  medioPago: (row.medio_pago as string | null) ?? null,
  referencia: (row.referencia as string | null) ?? null,
  comprobanteUrl: (row.comprobante_url as string | null) ?? null,
  nota: (row.nota as string | null) ?? null,
  creadoPor: String(row.creado_por),
  creadoEn: String(row.creado_en),
  anuladoEn: (row.anulado_en as string | null) ?? null,
  anuladoPor: (row.anulado_por as string | null) ?? null,
  motivoAnulacion: (row.motivo_anulacion as string | null) ?? null,
})

export class SupabaseComisionesRepository implements ComisionesRepository {
  async getMisComisiones(input: { vendedorEmail: string; dates: ReportDateRange; filtros?: ComisionFiltros }): Promise<ComisionDevengoRow[]> {
    // RLS ya restringe esto a las filas del vendedor de la sesión — el filtro por email
    // acá es defensivo, no la fuente de la restricción.
    let builder = supabase.from('comision_devengo').select(DEVENGO_SELECT)
      .eq('vendedor_email', input.vendedorEmail)
      .gte('documento_fecha', input.dates.from).lte('documento_fecha', input.dates.to)
    if (input.filtros?.estado) builder = builder.eq('estado', input.filtros.estado)
    if (input.filtros?.origen) builder = builder.eq('origen', input.filtros.origen)
    const { data, error } = await builder.order('documento_fecha', { ascending: false })
    if (error) throw error
    return (data ?? []).map(toDevengoRow)
  }

  async getEquipo(input: { dates: ReportDateRange; filtros?: ComisionFiltros }): Promise<ComisionDevengoRow[]> {
    let builder = supabase.from('comision_devengo').select(DEVENGO_SELECT)
      .gte('documento_fecha', input.dates.from).lte('documento_fecha', input.dates.to)
    if (input.filtros?.estado) builder = builder.eq('estado', input.filtros.estado)
    if (input.filtros?.origen) builder = builder.eq('origen', input.filtros.origen)
    if (input.filtros?.vendedorEmail) builder = builder.eq('vendedor_email', input.filtros.vendedorEmail)
    const { data, error } = await builder.order('vendedor_email').order('documento_fecha', { ascending: false })
    if (error) throw error
    return (data ?? []).map(toDevengoRow)
  }

  async getSeguimiento(dates: ReportDateRange): Promise<ComisionSeguimiento[]> {
    const { data, error } = await supabase.rpc('comision_seguimiento', { p_desde: dates.from, p_hasta: dates.to })
    if (error) throw error
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      devengoId: String(row.devengo_id),
      partidas: num(row.partidas),
      partidaTotalCents: numericToCents(num(row.partida_total)),
      imputadoCents: numericToCents(num(row.imputado)),
      pendienteCents: numericToCents(num(row.pendiente)),
      fechaVencimiento: (row.fecha_vencimiento as string | null) ?? null,
      diasVencido: row.dias_vencido === null || row.dias_vencido === undefined ? null : num(row.dias_vencido),
      relojCorriendo: Boolean(row.reloj_corriendo),
    }))
  }

  async getLineasDevengo(devengoId: string): Promise<ComisionLineaDevengo[]> {
    const { data, error } = await supabase.rpc('comision_lineas_devengo', { p_devengo_id: Number(devengoId) })
    if (error) throw error
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      productoId: row.producto_id === null || row.producto_id === undefined ? null : String(row.producto_id),
      productoNombre: String(row.producto_nombre ?? ''),
      marca: (row.marca as string | null) ?? null,
      subtotalCents: numericToCents(num(row.subtotal)),
      porcentajeBp: row.porcentaje === null || row.porcentaje === undefined ? null : fracToBp(row.porcentaje),
      comisiona: Boolean(row.comisiona),
      esPersonalizado: Boolean(row.es_personalizado),
      reglaTipo: (row.regla_tipo as ComisionRegla['tipo'] | null) ?? null,
      reglaPatron: (row.regla_patron as string | null) ?? null,
    }))
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

  async getReglaConteo(): Promise<Record<string, number>> {
    const { data, error } = await supabase.rpc('comision_regla_conteo')
    if (error) throw error
    const out: Record<string, number> = {}
    for (const row of (data ?? []) as Array<{ regla_id: number; productos: number }>) out[String(row.regla_id)] = row.productos
    return out
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

  async listLiquidaciones(vendedorEmail?: string): Promise<ComisionLiquidacion[]> {
    let builder = supabase.from('comision_liquidacion').select('*')
    if (vendedorEmail) builder = builder.eq('vendedor_email', vendedorEmail)
    const { data, error } = await builder.order('creado_en', { ascending: false })
    if (error) throw error
    return (data ?? []).map(toLiquidacion)
  }

  async crearLiquidacion(input: { vendedorEmail: string; devengoIds: string[]; medioPago?: string; referencia?: string; comprobanteUrl?: string; nota?: string }): Promise<ComisionLiquidacion> {
    const { data: liquidacionId, error } = await supabase.rpc('comision_crear_liquidacion', {
      p_vendedor_email: input.vendedorEmail,
      p_devengo_ids: input.devengoIds.map(Number),
      p_medio_pago: input.medioPago ?? null,
      p_referencia: input.referencia ?? null,
      p_comprobante_url: input.comprobanteUrl ?? null,
      p_nota: input.nota ?? null,
    })
    if (error) throw error
    const { data, error: e2 } = await supabase.from('comision_liquidacion').select('*').eq('id', liquidacionId).single()
    if (e2) throw e2
    return toLiquidacion(data)
  }

  async anularLiquidacion(liquidacionId: string, motivo: string): Promise<void> {
    const { error } = await supabase.rpc('comision_anular_liquidacion', { p_liquidacion_id: Number(liquidacionId), p_motivo: motivo })
    if (error) throw error
  }
}

export const comisionesRepository = new SupabaseComisionesRepository()
