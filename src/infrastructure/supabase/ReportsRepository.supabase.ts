import { supabase } from './supabaseClient'
import type { Page, PageRequest } from '../../application/ports/repositories'
import type {
  CajaReportRow, CotizacionReportRow, ProductoVendidoRow, ReordenRow, ReportDateRange, ReportSummary,
  ReportsRepository, ValuacionRow, VentaRow,
} from '../../application/ports/reportsRepository'
import { numericToCents } from './mappers'

// numeric columns come back from PostgREST as strings — this normalizes any of
// string/number/null/undefined into a plain JS number.
const num = (value: unknown): number => (value === null || value === undefined || value === '' ? 0 : Number(value))
const range = (page: PageRequest) => { const from = (page.page - 1) * page.pageSize; return { from, to: from + page.pageSize - 1 } }

export class SupabaseReportsRepository implements ReportsRepository {
  async getVentas(input: { dates: ReportDateRange; vendedor?: string; cliente?: string; metodoPago?: string; page: PageRequest }): Promise<Page<VentaRow>> {
    const { from, to } = range(input.page)
    let builder = supabase.from('v_reporte_ventas').select('*', { count: 'exact' }).gte('fecha', input.dates.from).lte('fecha', input.dates.to)
    if (input.vendedor) builder = builder.ilike('vendedor', `%${input.vendedor}%`)
    if (input.cliente) builder = builder.ilike('cliente', `%${input.cliente}%`)
    if (input.metodoPago) builder = builder.ilike('metodos', `%${input.metodoPago}%`)
    const { data, error, count } = await builder.order('fecha', { ascending: false }).range(from, to)
    if (error) throw error
    const items: VentaRow[] = (data ?? []).map((row) => ({
      ventaId: String(row.venta_id),
      fecha: row.fecha,
      vendedor: row.vendedor ?? '',
      clienteId: row.cliente_id === null ? null : String(row.cliente_id),
      cliente: row.cliente,
      subtotalCents: numericToCents(num(row.subtotal)),
      descuentoTotalCents: numericToCents(num(row.descuento_total)),
      totalCents: numericToCents(num(row.total)),
      sesionCajaId: row.sesion_caja_id === null ? null : String(row.sesion_caja_id),
      metodos: row.metodos ?? '',
    }))
    return { items, page: input.page.page, pageSize: input.page.pageSize, total: count ?? 0 }
  }

  async getProductosVendidos(input: { dates: ReportDateRange; canal?: string; page: PageRequest }): Promise<Page<ProductoVendidoRow>> {
    const { from, to } = range(input.page)
    let builder = supabase.from('v_reporte_productos_vendidos').select('*', { count: 'exact' }).gte('fecha', input.dates.from).lte('fecha', input.dates.to)
    if (input.canal) builder = builder.eq('canal', input.canal)
    const { data, error, count } = await builder.order('fecha', { ascending: false }).range(from, to)
    if (error) throw error
    const items: ProductoVendidoRow[] = (data ?? []).map((row) => ({
      productoId: String(row.producto_id),
      producto: row.producto ?? '',
      skuInterno: row.sku_interno,
      marca: row.marca,
      fecha: row.fecha,
      canal: row.canal ?? '',
      cantidadBase: num(row.cantidad_base),
      importeCents: numericToCents(num(row.importe)),
    }))
    return { items, page: input.page.page, pageSize: input.page.pageSize, total: count ?? 0 }
  }

  async getCaja(input: { dates: ReportDateRange; page: PageRequest }): Promise<Page<CajaReportRow>> {
    const { from, to } = range(input.page)
    const { data, error, count } = await supabase.from('v_reporte_caja').select('*', { count: 'exact' }).gte('fecha', input.dates.from).lte('fecha', input.dates.to).order('fecha', { ascending: false }).range(from, to)
    if (error) throw error
    const items: CajaReportRow[] = (data ?? []).map((row) => ({
      sesionId: String(row.sesion_id),
      caja: row.caja ?? '',
      fecha: row.fecha,
      abiertaPor: row.abierta_por ?? '',
      cerradaPor: row.cerrada_por,
      estado: row.estado ?? '',
      montoAperturaCents: numericToCents(num(row.monto_apertura)),
      montoCierreContadoCents: row.monto_cierre_contado === null ? null : numericToCents(num(row.monto_cierre_contado)),
      diferenciaCents: row.diferencia === null ? null : numericToCents(num(row.diferencia)),
      ingresosCents: numericToCents(num(row.ingresos)),
      egresosCents: numericToCents(num(row.egresos)),
    }))
    return { items, page: input.page.page, pageSize: input.page.pageSize, total: count ?? 0 }
  }

  async getCotizaciones(input: { dates: ReportDateRange; page: PageRequest }): Promise<Page<CotizacionReportRow>> {
    const { from, to } = range(input.page)
    const { data, error, count } = await supabase.from('v_reporte_cotizaciones').select('*', { count: 'exact' }).gte('fecha', input.dates.from).lte('fecha', input.dates.to).order('fecha', { ascending: false }).range(from, to)
    if (error) throw error
    const items: CotizacionReportRow[] = (data ?? []).map((row) => ({
      id: String(row.id),
      fecha: row.fecha,
      estado: row.estado ?? '',
      canal: row.canal ?? '',
      clienteId: row.cliente_id === null ? null : String(row.cliente_id),
      cliente: row.cliente,
      asunto: row.asunto,
      totalCents: numericToCents(num(row.total)),
      vigenciaHasta: row.vigencia_hasta,
      creadoPor: row.creado_por ?? '',
      vencida: Boolean(row.vencida),
    }))
    return { items, page: input.page.page, pageSize: input.page.pageSize, total: count ?? 0 }
  }

  // v_analitica_reorden has no date column — point-in-time stock/velocity snapshot,
  // paginated without a date filter.
  async getReorden(input: { page: PageRequest }): Promise<Page<ReordenRow>> {
    const { from, to } = range(input.page)
    const { data, error, count } = await supabase.from('v_analitica_reorden').select('*', { count: 'exact' }).order('producto_id').range(from, to)
    if (error) throw error
    const items: ReordenRow[] = (data ?? []).map((row) => ({
      productoId: String(row.producto_id),
      productoNombre: row.producto_nombre ?? '',
      skuInterno: row.sku_interno,
      unidadBase: row.unidad_base ?? '',
      stockActual: num(row.stock_actual),
      stockMin: row.stock_min === null ? null : num(row.stock_min),
      puntoReorden: row.punto_reorden === null ? null : num(row.punto_reorden),
      vendido30d: num(row.vendido_30d),
      vendido90d: num(row.vendido_90d),
      velocidadDiaria: num(row.velocidad_diaria),
      diasCobertura: row.dias_cobertura === null ? null : num(row.dias_cobertura),
      necesitaReorden: Boolean(row.necesita_reorden),
    }))
    return { items, page: input.page.page, pageSize: input.page.pageSize, total: count ?? 0 }
  }

  // v_valuacion_inventario is likewise point-in-time — same note as getReorden.
  async getValuacion(input: { page: PageRequest }): Promise<Page<ValuacionRow>> {
    const { from, to } = range(input.page)
    const { data, error, count } = await supabase.from('v_valuacion_inventario').select('*', { count: 'exact' }).order('producto_id').range(from, to)
    if (error) throw error
    const items: ValuacionRow[] = (data ?? []).map((row) => ({
      productoId: String(row.producto_id),
      productoNombre: row.producto_nombre ?? '',
      skuInterno: row.sku_interno,
      unidadBase: row.unidad_base ?? '',
      cantidadActual: num(row.cantidad_actual),
      costoPromedioCents: numericToCents(num(row.costo_promedio)),
      valorInventarioCents: numericToCents(num(row.valor_inventario)),
      precioBaseCents: numericToCents(num(row.precio_base)),
    }))
    return { items, page: input.page.page, pageSize: input.page.pageSize, total: count ?? 0 }
  }

  /**
   * Top-of-page stat tiles (total vendido, operaciones, ticket promedio, diferencia de
   * caja acumulada). Rather than reach for PostgREST's aggregate-function `.select()`
   * syntax (fragile across supabase-js versions, hard to unit-test), this computes the
   * 3 sales figures client-side from the SAME date-filtered v_reporte_ventas rows and
   * the caja figure from v_reporte_caja — fetched here in bounded 1000-row pages (not
   * a single unbounded pull) specifically to avoid PostgREST's 1000-row cap, which is
   * exactly the trap this project hit before with stock_actual. A monthly range for
   * this shop's transaction volume comfortably fits in a handful of such pages; this
   * is NOT reused for the full-catalog reports (reorden/valuación), which stay
   * strictly paginated through the UI instead.
   */
  async getSummary(dates: ReportDateRange): Promise<ReportSummary> {
    const fetchAll = async (table: string, select: string): Promise<Array<Record<string, unknown>>> => {
      const rows: Array<Record<string, unknown>> = []
      let page = 0
      const PAGE = 1000
      for (;;) {
        const { data, error } = await supabase.from(table).select(select).gte('fecha', dates.from).lte('fecha', dates.to).range(page * PAGE, page * PAGE + PAGE - 1)
        if (error) throw error
        rows.push(...((data ?? []) as unknown as Array<Record<string, unknown>>))
        if (!data || data.length < PAGE) break
        page += 1
      }
      return rows
    }
    const [ventaRows, cajaRows] = await Promise.all([
      fetchAll('v_reporte_ventas', 'total'),
      fetchAll('v_reporte_caja', 'diferencia'),
    ])
    const totalVendidoCents = ventaRows.reduce((sum, row) => sum + numericToCents(num(row.total)), 0)
    const operaciones = ventaRows.length
    const ticketPromedioCents = operaciones ? Math.round(totalVendidoCents / operaciones) : 0
    const diferenciaCajaCents = cajaRows.reduce((sum, row) => sum + numericToCents(num(row.diferencia)), 0)
    return { totalVendidoCents, operaciones, ticketPromedioCents, diferenciaCajaCents }
  }
}

export const reportsRepository = new SupabaseReportsRepository()
