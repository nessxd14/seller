import type { Page, PageRequest } from './repositories'

// Standalone port for Parte 2's Reportes page — one method per read-only report view
// (v_reporte_ventas / v_reporte_productos_vendidos / v_reporte_caja /
// v_reporte_cotizaciones / v_analitica_reorden / v_valuacion_inventario), all
// server-filtered + paginated (never pulling a whole view — PostgREST's 1000-row cap
// already burned this project once, in earlier briefs' stock_actual handling).
export interface ReportDateRange { from: string; to: string }

export interface VentaRow {
  ventaId: string
  fecha: string
  vendedor: string
  clienteId: string | null
  cliente: string | null
  subtotalCents: number
  descuentoTotalCents: number
  totalCents: number
  sesionCajaId: string | null
  metodos: string
}
export interface ProductoVendidoRow {
  productoId: string
  producto: string
  skuInterno: string | null
  marca: string | null
  fecha: string
  canal: string
  cantidadBase: number
  importeCents: number
}
export interface CajaReportRow {
  sesionId: string
  caja: string
  fecha: string
  abiertaPor: string
  cerradaPor: string | null
  estado: string
  montoAperturaCents: number
  montoCierreContadoCents: number | null
  diferenciaCents: number | null
  ingresosCents: number
  egresosCents: number
}
export interface CotizacionReportRow {
  id: string
  fecha: string
  estado: string
  canal: string
  clienteId: string | null
  cliente: string | null
  asunto: string | null
  totalCents: number
  vigenciaHasta: string | null
  creadoPor: string
  vencida: boolean
}
export interface ReordenRow {
  productoId: string
  productoNombre: string
  skuInterno: string | null
  unidadBase: string
  stockActual: number
  stockMin: number | null
  puntoReorden: number | null
  vendido30d: number
  vendido90d: number
  velocidadDiaria: number
  diasCobertura: number | null
  necesitaReorden: boolean
}
export interface ValuacionRow {
  productoId: string
  productoNombre: string
  skuInterno: string | null
  unidadBase: string
  cantidadActual: number
  costoPromedioCents: number
  valorInventarioCents: number
  precioBaseCents: number
}

export interface ReportSummary {
  totalVendidoCents: number
  operaciones: number
  ticketPromedioCents: number
  diferenciaCajaCents: number
}

export interface ReportsRepository {
  getVentas(input: { dates: ReportDateRange; vendedor?: string; cliente?: string; metodoPago?: string; page: PageRequest }): Promise<Page<VentaRow>>
  getProductosVendidos(input: { dates: ReportDateRange; canal?: string; page: PageRequest }): Promise<Page<ProductoVendidoRow>>
  getCaja(input: { dates: ReportDateRange; page: PageRequest }): Promise<Page<CajaReportRow>>
  getCotizaciones(input: { dates: ReportDateRange; page: PageRequest }): Promise<Page<CotizacionReportRow>>
  getReorden(input: { page: PageRequest }): Promise<Page<ReordenRow>>
  getValuacion(input: { page: PageRequest }): Promise<Page<ValuacionRow>>
  getSummary(dates: ReportDateRange): Promise<ReportSummary>
}
