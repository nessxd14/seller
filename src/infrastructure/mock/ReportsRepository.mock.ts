import type { Page, PageRequest } from '../../application/ports/repositories'
import type {
  CajaReportRow, CotizacionReportRow, ProductoVendidoRow, ReordenRow, ReportDateRange, ReportSummary,
  ReportsRepository, ValuacionRow, VentaRow,
} from '../../application/ports/reportsRepository'

// Mock mode has no real sales/caja/quote history worth aggregating into a meaningful
// report — this is the pragmatic simplification called out in the brief: mock mode was
// never meant to simulate a full transactional history, so a handful of plausible-
// looking rows (not reverse-engineered from the mock quote/order seeds) is enough for
// the Reportes page's empty/loading/populated states to be exercisable in mock mode.
const paginate = <T>(items: T[], page: PageRequest): Page<T> => {
  const from = (page.page - 1) * page.pageSize
  return { items: items.slice(from, from + page.pageSize), page: page.page, pageSize: page.pageSize, total: items.length }
}

const mockVentas: VentaRow[] = [
  { ventaId: '1', fecha: '2026-07-20', vendedor: 'Natalia Cajera', clienteId: null, cliente: null, subtotalCents: 15000, descuentoTotalCents: 0, totalCents: 15000, sesionCajaId: '1', metodos: 'EFECTIVO' },
  { ventaId: '2', fecha: '2026-07-22', vendedor: 'Andrea Admin', clienteId: 'c1', cliente: 'Librería San Marcos', subtotalCents: 42000, descuentoTotalCents: 2000, totalCents: 40000, sesionCajaId: '1', metodos: 'QR' },
]
const mockProductosVendidos: ProductoVendidoRow[] = [
  { productoId: '1', producto: 'Cuaderno TUKI 50 hojas', skuInterno: 'CUA-TUK-050', marca: 'TUKI', fecha: '2026-07-20', canal: 'retail', cantidadBase: 10, importeCents: 15000 },
]
const mockCaja: CajaReportRow[] = [
  { sesionId: '1', caja: 'Caja Tienda', fecha: '2026-07-20', abiertaPor: 'Natalia Cajera', cerradaPor: 'Natalia Cajera', estado: 'CERRADA', montoAperturaCents: 20000, montoCierreContadoCents: 55000, diferenciaCents: 0, ingresosCents: 35000, egresosCents: 0 },
]
const mockCotizaciones: CotizacionReportRow[] = [
  { id: 'q1', fecha: '2026-07-22', estado: 'approved', canal: 'institucional', clienteId: 'c2', cliente: 'Colegio Nueva Esperanza', asunto: 'Campaña escolar', totalCents: 189600, vigenciaHasta: '2026-08-10', creadoPor: 'Andrea Admin', vencida: false },
]
const mockReorden: ReordenRow[] = []
const mockValuacion: ValuacionRow[] = []

const inRange = <T extends { fecha: string }>(rows: T[], dates: ReportDateRange) => rows.filter((row) => row.fecha >= dates.from && row.fecha <= dates.to)

export class MockReportsRepository implements ReportsRepository {
  async getVentas(input: { dates: ReportDateRange; vendedor?: string; cliente?: string; metodoPago?: string; page: PageRequest }): Promise<Page<VentaRow>> {
    return paginate(inRange(mockVentas, input.dates), input.page)
  }
  async getProductosVendidos(input: { dates: ReportDateRange; canal?: string; page: PageRequest }): Promise<Page<ProductoVendidoRow>> {
    return paginate(inRange(mockProductosVendidos, input.dates), input.page)
  }
  async getCaja(input: { dates: ReportDateRange; page: PageRequest }): Promise<Page<CajaReportRow>> {
    return paginate(inRange(mockCaja, input.dates), input.page)
  }
  async getCotizaciones(input: { dates: ReportDateRange; page: PageRequest }): Promise<Page<CotizacionReportRow>> {
    return paginate(inRange(mockCotizaciones, input.dates), input.page)
  }
  async getReorden(input: { page: PageRequest }): Promise<Page<ReordenRow>> {
    return paginate(mockReorden, input.page)
  }
  async getValuacion(input: { page: PageRequest }): Promise<Page<ValuacionRow>> {
    return paginate(mockValuacion, input.page)
  }
  async getSummary(dates: ReportDateRange): Promise<ReportSummary> {
    const ventas = inRange(mockVentas, dates)
    const caja = inRange(mockCaja, dates)
    const totalVendidoCents = ventas.reduce((sum, row) => sum + row.totalCents, 0)
    const operaciones = ventas.length
    return {
      totalVendidoCents,
      operaciones,
      ticketPromedioCents: operaciones ? Math.round(totalVendidoCents / operaciones) : 0,
      diferenciaCajaCents: caja.reduce((sum, row) => sum + (row.diferenciaCents ?? 0), 0),
    }
  }
}

export const reportsRepository = new MockReportsRepository()
