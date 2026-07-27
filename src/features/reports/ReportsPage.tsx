import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { reportsService } from '../../infrastructure/services'
import type {
  CajaReportRow, CotizacionReportRow, ProductoVendidoRow, ReordenRow, ReportDateRange, ReportSummary, ValuacionRow, VentaRow,
} from '../../application/ports/reportsRepository'
import { FeatureShell, FeatureState } from '../shared/FeatureShell'
import { formatMoney, money } from '../../domain/common/money'
import { buildCsv, downloadCsv, type CsvColumn } from '../../domain/common/csv'

type ReportKind = 'ventas' | 'productos' | 'caja' | 'cotizaciones' | 'reorden' | 'valuacion'

const REPORT_LABELS: Record<ReportKind, string> = {
  ventas: 'Ventas',
  productos: 'Productos vendidos',
  caja: 'Caja',
  cotizaciones: 'Cotizaciones',
  reorden: 'Analítica de reorden',
  valuacion: 'Valuación de inventario',
}

// Date-ranged reports are backed by view rows filtered/paginated server-side; reorden
// and valuación are point-in-time snapshots (no fecha column on either view, confirmed
// live) so they carry no date range at all.
const DATE_RANGED: ReportKind[] = ['ventas', 'productos', 'caja', 'cotizaciones']

const PAGE_SIZE = 25

const firstOfMonthIso = () => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10) }
const todayIso = () => new Date().toISOString().slice(0, 10)
const bs = (cents: number) => formatMoney(money(cents))
const fecha = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString('es-BO')

export function ReportsPage({ notify }: { notify: (message: string) => void }) {
  const [kind, setKind] = useState<ReportKind>('ventas')
  const [from, setFrom] = useState(firstOfMonthIso())
  const [to, setTo] = useState(todayIso())
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [summary, setSummary] = useState<ReportSummary | null>(null)

  const [ventas, setVentas] = useState<{ items: VentaRow[]; total: number }>({ items: [], total: 0 })
  const [productos, setProductos] = useState<{ items: ProductoVendidoRow[]; total: number }>({ items: [], total: 0 })
  const [caja, setCaja] = useState<{ items: CajaReportRow[]; total: number }>({ items: [], total: 0 })
  const [cotizaciones, setCotizaciones] = useState<{ items: CotizacionReportRow[]; total: number }>({ items: [], total: 0 })
  const [reorden, setReorden] = useState<{ items: ReordenRow[]; total: number }>({ items: [], total: 0 })
  const [valuacion, setValuacion] = useState<{ items: ValuacionRow[]; total: number }>({ items: [], total: 0 })

  const dates: ReportDateRange = useMemo(() => ({ from, to }), [from, to])
  const pageRequest = useMemo(() => ({ page, pageSize: PAGE_SIZE }), [page])

  // Every setState call below happens inside a .then()/.finally() callback, never
  // synchronously during the effect's call stack — required by the
  // react-hooks/set-state-in-effect lint rule (same pattern as
  // CashSessionContext.refresh()).
  useEffect(() => { void Promise.resolve().then(() => setPage(1)) }, [kind, from, to])

  useEffect(() => {
    void Promise.resolve().then(() => setStatus('loading'))
    const load = kind === 'ventas' ? reportsService.getVentas({ dates, page: pageRequest }).then((result) => setVentas(result))
      : kind === 'productos' ? reportsService.getProductosVendidos({ dates, page: pageRequest }).then((result) => setProductos(result))
      : kind === 'caja' ? reportsService.getCaja({ dates, page: pageRequest }).then((result) => setCaja(result))
      : kind === 'cotizaciones' ? reportsService.getCotizaciones({ dates, page: pageRequest }).then((result) => setCotizaciones(result))
      : kind === 'reorden' ? reportsService.getReorden({ page: pageRequest }).then((result) => setReorden(result))
      : reportsService.getValuacion({ page: pageRequest }).then((result) => setValuacion(result))
    load.then(() => setStatus('ready')).catch(() => setStatus('error'))
  }, [kind, dates, pageRequest])

  useEffect(() => { void reportsService.getSummary(dates).then(setSummary).catch(() => setSummary(null)) }, [dates])

  const exportCsv = () => {
    const build = <T,>(rows: T[], columns: Array<CsvColumn<T>>) => downloadCsv(`reporte-${kind}-${from}_${to}.csv`, buildCsv(rows, columns))
    if (kind === 'ventas') build(ventas.items, [
      { header: 'Venta', value: (r) => r.ventaId }, { header: 'Fecha', value: (r) => r.fecha }, { header: 'Vendedor', value: (r) => r.vendedor },
      { header: 'Cliente', value: (r) => r.cliente ?? '' }, { header: 'Subtotal', value: (r) => (r.subtotalCents / 100).toFixed(2) },
      { header: 'Descuento', value: (r) => (r.descuentoTotalCents / 100).toFixed(2) }, { header: 'Total', value: (r) => (r.totalCents / 100).toFixed(2) },
      { header: 'Métodos', value: (r) => r.metodos },
    ])
    else if (kind === 'productos') build(productos.items, [
      { header: 'Producto', value: (r) => r.producto }, { header: 'SKU', value: (r) => r.skuInterno ?? '' }, { header: 'Marca', value: (r) => r.marca ?? '' },
      { header: 'Fecha', value: (r) => r.fecha }, { header: 'Canal', value: (r) => r.canal }, { header: 'Cantidad', value: (r) => r.cantidadBase },
      { header: 'Importe', value: (r) => (r.importeCents / 100).toFixed(2) },
    ])
    else if (kind === 'caja') build(caja.items, [
      { header: 'Sesión', value: (r) => r.sesionId }, { header: 'Caja', value: (r) => r.caja }, { header: 'Fecha', value: (r) => r.fecha },
      { header: 'Abierta por', value: (r) => r.abiertaPor }, { header: 'Cerrada por', value: (r) => r.cerradaPor ?? '' }, { header: 'Estado', value: (r) => r.estado },
      { header: 'Apertura', value: (r) => (r.montoAperturaCents / 100).toFixed(2) }, { header: 'Cierre contado', value: (r) => r.montoCierreContadoCents === null ? '' : (r.montoCierreContadoCents / 100).toFixed(2) },
      { header: 'Diferencia', value: (r) => r.diferenciaCents === null ? '' : (r.diferenciaCents / 100).toFixed(2) },
      { header: 'Ingresos', value: (r) => (r.ingresosCents / 100).toFixed(2) }, { header: 'Egresos', value: (r) => (r.egresosCents / 100).toFixed(2) },
    ])
    else if (kind === 'cotizaciones') build(cotizaciones.items, [
      { header: 'Cotización', value: (r) => r.id }, { header: 'Fecha', value: (r) => r.fecha }, { header: 'Estado', value: (r) => r.estado },
      { header: 'Canal', value: (r) => r.canal }, { header: 'Cliente', value: (r) => r.cliente ?? '' }, { header: 'Asunto', value: (r) => r.asunto ?? '' },
      { header: 'Total', value: (r) => (r.totalCents / 100).toFixed(2) }, { header: 'Vigencia', value: (r) => r.vigenciaHasta ?? '' }, { header: 'Creado por', value: (r) => r.creadoPor },
    ])
    else if (kind === 'reorden') build(reorden.items, [
      { header: 'Producto', value: (r) => r.productoNombre }, { header: 'SKU', value: (r) => r.skuInterno ?? '' }, { header: 'Unidad', value: (r) => r.unidadBase },
      { header: 'Stock actual', value: (r) => r.stockActual }, { header: 'Stock mínimo', value: (r) => r.stockMin ?? '' }, { header: 'Punto de reorden', value: (r) => r.puntoReorden ?? '' },
      { header: 'Vendido 30d', value: (r) => r.vendido30d }, { header: 'Vendido 90d', value: (r) => r.vendido90d }, { header: 'Velocidad diaria', value: (r) => r.velocidadDiaria },
      { header: 'Días de cobertura', value: (r) => r.diasCobertura ?? '' }, { header: 'Necesita reorden', value: (r) => r.necesitaReorden ? 'Sí' : 'No' },
    ])
    else build(valuacion.items, [
      { header: 'Producto', value: (r) => r.productoNombre }, { header: 'SKU', value: (r) => r.skuInterno ?? '' }, { header: 'Unidad', value: (r) => r.unidadBase },
      { header: 'Cantidad actual', value: (r) => r.cantidadActual }, { header: 'Costo promedio', value: (r) => (r.costoPromedioCents / 100).toFixed(2) },
      { header: 'Valor de inventario', value: (r) => (r.valorInventarioCents / 100).toFixed(2) }, { header: 'Precio base', value: (r) => (r.precioBaseCents / 100).toFixed(2) },
    ])
    notify('CSV exportado')
  }

  const currentTotal = kind === 'ventas' ? ventas.total : kind === 'productos' ? productos.total : kind === 'caja' ? caja.total : kind === 'cotizaciones' ? cotizaciones.total : kind === 'reorden' ? reorden.total : valuacion.total
  const totalPages = Math.max(1, Math.ceil(currentTotal / PAGE_SIZE))
  const hasRows = kind === 'ventas' ? ventas.items.length : kind === 'productos' ? productos.items.length : kind === 'caja' ? caja.items.length : kind === 'cotizaciones' ? cotizaciones.items.length : kind === 'reorden' ? reorden.items.length : valuacion.items.length

  return <FeatureShell eyebrow="ANALÍTICA" title="Reportes" subtitle="Ventas, productos, caja, cotizaciones e inventario"
    action={<button className="secondary-button" onClick={exportCsv} disabled={!hasRows}><Download size={14} /> Exportar CSV</button>}>
    <div className="feature-toolbar reports-toolbar">
      <select value={kind} onChange={(e) => setKind(e.target.value as ReportKind)}>
        {(Object.keys(REPORT_LABELS) as ReportKind[]).map((key) => <option key={key} value={key}>{REPORT_LABELS[key]}</option>)}
      </select>
      {DATE_RANGED.includes(kind) && <>
        <label className="reports-date-label">Desde<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="reports-date-label">Hasta<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </>}
    </div>

    <div className="reports-stat-tiles">
      <div><span>Total vendido</span><strong>{summary ? bs(summary.totalVendidoCents) : '—'}</strong></div>
      <div><span>Operaciones</span><strong>{summary ? summary.operaciones : '—'}</strong></div>
      <div><span>Ticket promedio</span><strong>{summary ? bs(summary.ticketPromedioCents) : '—'}</strong></div>
      <div><span>Diferencia de caja</span><strong>{summary ? bs(summary.diferenciaCajaCents) : '—'}</strong></div>
    </div>

    {kind === 'reorden' && <div className="reports-banner">Los mínimos de stock (stock_min) aún no están cargados — los indicadores de reorden pueden no ser confiables hasta entonces.</div>}

    {status === 'loading' ? <FeatureState type="skeleton" text="Cargando reporte" /> : status === 'error' ? <FeatureState type="error" text="No se pudo cargar el reporte" /> : !hasRows ? <FeatureState type="empty" text="No hay datos para el período seleccionado" /> : <>
      {kind === 'ventas' && <div className="feature-table reports-table reports-table-ventas"><div className="table-head"><span>Fecha</span><span>Vendedor</span><span>Cliente</span><span>Subtotal</span><span>Descuento</span><span>Total</span><span>Métodos</span></div>
        {ventas.items.map((row) => <article key={row.ventaId}><span>{fecha(row.fecha)}</span><span>{row.vendedor}</span><span>{row.cliente ?? '—'}</span><span>{bs(row.subtotalCents)}</span><span>{bs(row.descuentoTotalCents)}</span><span>{bs(row.totalCents)}</span><span>{row.metodos}</span></article>)}
      </div>}
      {kind === 'productos' && <div className="feature-table reports-table reports-table-productos"><div className="table-head"><span>Producto</span><span>SKU</span><span>Marca</span><span>Fecha</span><span>Canal</span><span>Cantidad</span><span>Importe</span></div>
        {productos.items.map((row) => <article key={`${row.productoId}-${row.fecha}`}><span>{row.producto}</span><span>{row.skuInterno ?? '—'}</span><span>{row.marca ?? '—'}</span><span>{fecha(row.fecha)}</span><span>{row.canal}</span><span>{row.cantidadBase}</span><span>{bs(row.importeCents)}</span></article>)}
      </div>}
      {kind === 'caja' && <div className="feature-table reports-table reports-table-caja"><div className="table-head"><span>Fecha</span><span>Caja</span><span>Estado</span><span>Apertura</span><span>Cierre</span><span>Diferencia</span></div>
        {caja.items.map((row) => <article key={row.sesionId}><span>{fecha(row.fecha)}</span><span>{row.caja}</span><span>{row.estado}</span><span>{bs(row.montoAperturaCents)}</span><span>{row.montoCierreContadoCents === null ? '—' : bs(row.montoCierreContadoCents)}</span><span>{row.diferenciaCents === null ? '—' : bs(row.diferenciaCents)}</span></article>)}
      </div>}
      {kind === 'cotizaciones' && <div className="feature-table reports-table reports-table-cotizaciones"><div className="table-head"><span>Fecha</span><span>Cliente</span><span>Canal</span><span>Estado</span><span>Total</span><span>Vigencia</span></div>
        {cotizaciones.items.map((row) => <article key={row.id}><span>{fecha(row.fecha)}</span><span>{row.cliente ?? '—'}</span><span>{row.canal}</span><span>{row.estado}{row.vencida ? ' (vencida)' : ''}</span><span>{bs(row.totalCents)}</span><span>{row.vigenciaHasta ? fecha(row.vigenciaHasta) : '—'}</span></article>)}
      </div>}
      {kind === 'reorden' && <div className="feature-table reports-table reports-table-reorden"><div className="table-head"><span>Producto</span><span>SKU</span><span>Stock actual</span><span>Vendido 30d</span><span>Días cobertura</span><span>Reorden</span></div>
        {reorden.items.map((row) => <article key={row.productoId}><span>{row.productoNombre}</span><span>{row.skuInterno ?? '—'}</span><span>{row.stockActual}</span><span>{row.vendido30d}</span><span>{row.diasCobertura ?? '—'}</span><span className={`status-chip ${row.necesitaReorden ? 'problem' : 'ok'}`}>{row.necesitaReorden ? 'Sí' : 'No'}</span></article>)}
      </div>}
      {kind === 'valuacion' && <div className="feature-table reports-table reports-table-valuacion"><div className="table-head"><span>Producto</span><span>SKU</span><span>Cantidad</span><span>Costo promedio</span><span>Valor inventario</span></div>
        {valuacion.items.map((row) => <article key={row.productoId}><span>{row.productoNombre}</span><span>{row.skuInterno ?? '—'}</span><span>{row.cantidadActual}</span><span>{bs(row.costoPromedioCents)}</span><span>{bs(row.valorInventarioCents)}</span></article>)}
      </div>}
      <div className="pagination-bar"><span>Página {page} de {totalPages} · {currentTotal} registros</span><button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}><ChevronLeft size={14} /></button><button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}><ChevronRight size={14} /></button></div>
    </>}
  </FeatureShell>
}
