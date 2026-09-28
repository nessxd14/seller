import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpDown, Download, ExternalLink } from 'lucide-react'
import { historialPrecios, resumenPreciosProducto, type HistorialPrecioRow, type ResumenPreciosProducto } from '../../infrastructure/supabase/PreciosRepository.supabase'
import { useEChart, type PriceChartOption } from '../../hooks/useEChart'
import { categoriaColor, categoriaLabel, categoriaToListaKey, listaPrecioLabel, type ListaPrecioKey, type PrecioFuente } from '../../domain/pricing/categoriaPrecio'
import { rollingMedian } from '../../domain/pricing/median'
import { buildCsv, downloadCsv } from '../../domain/common/csv'
import { navigate } from '../../router/history'
import { pedidoPath, cotizacionPath, ventaPath } from '../../router/appRoute'
import { FeatureState } from '../shared/FeatureShell'

const bs = (value: number) => `Bs ${value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' })

const WINDOW_OPTIONS: { label: string; dias: number }[] = [
  { label: '30 días', dias: 30 },
  { label: '90 días', dias: 90 },
  { label: '180 días', dias: 180 },
  { label: 'Todo', dias: 3650 },
]

const openDocument = (fuente: PrecioFuente, documentoId: number) => {
  const path = fuente === 'PEDIDO' ? pedidoPath(String(documentoId)) : fuente === 'COTIZACION' ? cotizacionPath(String(documentoId)) : ventaPath(String(documentoId))
  navigate(path)
}

const symbolFor = (fuente: PrecioFuente): string => (fuente === 'VENTA' ? 'diamond' : fuente === 'COTIZACION' ? 'emptyCircle' : 'circle')
// Symbol used for atípicos (grey ✕), independent of categoría/fuente.
const CROSS_SYMBOL = 'path://M4,4 L26,26 M26,4 L4,26'

// idx (posición en el resultado de la RPC) hace la key única cuando un mismo documento
// repite producto_id en más de una línea (p. ej. unidad + CAJA en el mismo pedido) —
// fuente+documentoId solo no alcanza ahí.
const rowKey = (row: HistorialPrecioRow) => `${row.fuente}-${row.documentoId}-${row.idx}`

type SortKey = 'fecha' | 'cliente' | 'categoria' | 'precioUnitario' | 'precioUnidadBase' | 'vsLista'
type ChartDatum = { value: [number, number]; symbol: string; symbolSize: number; itemStyle: { color: string; opacity: number; borderColor?: string; borderWidth?: number }; row: HistorialPrecioRow }

export function PreciosTab({ productId, productName }: { productId: number; productName: string }) {
  const [dias, setDias] = useState(90)
  const [resumen, setResumen] = useState<ResumenPreciosProducto | null>(null)
  const [resumenStatus, setResumenStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [historial, setHistorial] = useState<HistorialPrecioRow[]>([])
  const [historialStatus, setHistorialStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const [showPedidos, setShowPedidos] = useState(true)
  const [showVentas, setShowVentas] = useState(true)
  const [showCotizaciones, setShowCotizaciones] = useState(false)
  const [showAtipicos, setShowAtipicos] = useState(false)
  const [clienteQuery, setClienteQuery] = useState('')
  const [clienteFiltro, setClienteFiltro] = useState<string | null>(null)
  const [showClienteDropdown, setShowClienteDropdown] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [zoomPercent, setZoomPercent] = useState<[number, number]>([0, 100])
  const [sortKey, setSortKey] = useState<SortKey>('fecha')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const chartHostRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Record<string, HTMLElement | null>>({})

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reinicia el estado de carga en cuanto cambian productId/dias, sin esperar la respuesta de la RPC
    setResumenStatus('loading')
    void resumenPreciosProducto(productId, dias)
      .then((r) => { if (!cancelled) { setResumen(r); setResumenStatus('ready') } })
      .catch(() => { if (!cancelled) setResumenStatus('error') })
    return () => { cancelled = true }
  }, [productId, dias])

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reinicia el estado de carga en cuanto cambia productId, sin esperar la respuesta de la RPC
    setHistorialStatus('loading')
    void historialPrecios(productId)
      .then((rows) => { if (!cancelled) { setHistorial(rows); setHistorialStatus('ready') } })
      .catch(() => { if (!cancelled) setHistorialStatus('error') })
    return () => { cancelled = true }
  }, [productId])

  const clientesPresentes = useMemo(() => {
    const names = new Set<string>()
    historial.forEach((r) => { if (r.cliente) names.add(r.cliente) })
    return [...names].sort((a, b) => a.localeCompare(b, 'es'))
  }, [historial])

  const clienteMatches = useMemo(
    () => clientesPresentes.filter((n) => n.toLowerCase().includes(clienteQuery.toLowerCase())).slice(0, 8),
    [clientesPresentes, clienteQuery],
  )

  const chipFilteredRows = useMemo(() => historial.filter((r) => {
    if (r.atipico && !showAtipicos) return false
    if (r.fuente === 'PEDIDO' && !showPedidos) return false
    if (r.fuente === 'VENTA' && !showVentas) return false
    if (r.fuente === 'COTIZACION' && !showCotizaciones) return false
    return true
  }), [historial, showPedidos, showVentas, showCotizaciones, showAtipicos])

  const dateRange = useMemo<[number, number] | null>(() => {
    const times = historial.map((r) => new Date(r.fecha).getTime())
    return times.length ? [Math.min(...times), Math.max(...times)] : null
  }, [historial])

  const zoomedRows = useMemo(() => {
    if (!dateRange) return chipFilteredRows
    const [min, max] = dateRange
    const span = Math.max(1, max - min)
    const from = min + span * (zoomPercent[0] / 100)
    const to = min + span * (zoomPercent[1] / 100)
    return chipFilteredRows.filter((r) => { const t = new Date(r.fecha).getTime(); return t >= from && t <= to })
  }, [chipFilteredRows, dateRange, zoomPercent])

  const tableRows = useMemo(
    () => (clienteFiltro ? zoomedRows.filter((r) => r.cliente === clienteFiltro) : zoomedRows),
    [zoomedRows, clienteFiltro],
  )

  const sortedTableRows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    const vsLista = (r: HistorialPrecioRow) => (r.precioListaUnidadBase ? (r.precioUnidadBase / r.precioListaUnidadBase - 1) * 100 : -Infinity)
    return [...tableRows].sort((a, b) => {
      switch (sortKey) {
        case 'fecha': return dir * a.fecha.localeCompare(b.fecha)
        case 'cliente': return dir * (a.cliente ?? '').localeCompare(b.cliente ?? '')
        case 'categoria': return dir * a.categoria.localeCompare(b.categoria)
        case 'precioUnitario': return dir * (a.precioUnitario - b.precioUnitario)
        case 'precioUnidadBase': return dir * (a.precioUnidadBase - b.precioUnidadBase)
        case 'vsLista': return dir * (vsLista(a) - vsLista(b))
      }
    })
  }, [tableRows, sortKey, sortDir])

  const categoriasPresentes = useMemo(() => {
    const set = new Set<string>()
    chipFilteredRows.forEach((r) => { if (!r.atipico) set.add(r.categoria) })
    return [...set]
  }, [chipFilteredRows])

  const chartOption = useMemo<PriceChartOption | null>(() => {
    if (historialStatus !== 'ready' || historial.length === 0) return null
    const maxQty = Math.max(1, ...chipFilteredRows.map((r) => r.cantidadBase))
    const sizeFor = (qty: number) => Math.min(28, Math.max(6, Math.sqrt(qty / maxQty) * 28))
    const opacityFor = (r: HistorialPrecioRow) => (clienteFiltro && r.cliente !== clienteFiltro ? 0.15 : 0.85)

    const categoriaSeries = categoriasPresentes.map((categoria) => {
      const rows = chipFilteredRows.filter((r) => r.categoria === categoria && !r.atipico)
      const data: ChartDatum[] = rows.map((r) => ({
        value: [new Date(r.fecha).getTime(), r.precioUnidadBase],
        symbol: symbolFor(r.fuente),
        symbolSize: sizeFor(r.cantidadBase),
        itemStyle: { color: categoriaColor(categoria), opacity: opacityFor(r) },
        row: r,
      }))
      return { name: categoriaLabel(categoria), type: 'scatter' as const, data, color: categoriaColor(categoria) }
    })

    const medianLines = categoriasPresentes.map((categoria) => {
      const points = chipFilteredRows
        .filter((r) => r.categoria === categoria && r.fuente !== 'COTIZACION' && !r.atipico)
        .map((r) => ({ x: new Date(r.fecha).getTime(), y: r.precioUnidadBase }))
      const rolling = rollingMedian(points, 7)
      return {
        name: categoriaLabel(categoria),
        type: 'line' as const,
        showSymbol: false,
        data: rolling.map((p) => [p.x, p.y] as [number, number]),
        lineStyle: { color: categoriaColor(categoria), width: 1.5 },
        color: categoriaColor(categoria),
        z: 3,
        tooltip: { show: false },
        legendHoverLink: false,
      }
    })

    const outlierSeries = showAtipicos ? [{
      name: 'Atípicos',
      type: 'scatter' as const,
      data: chipFilteredRows.filter((r) => r.atipico).map((r): ChartDatum => ({
        value: [new Date(r.fecha).getTime(), r.precioUnidadBase],
        symbol: CROSS_SYMBOL,
        symbolSize: 14,
        // El path de la ✕ son dos trazos abiertos (M...L... M...L..., sin closepath) —
        // rellenarlos con `color` no dibuja nada (área de relleno nula). Se traza con
        // borderColor/borderWidth en su lugar, que sí sigue el trazo aunque esté abierto.
        itemStyle: { color: 'transparent', borderColor: '#94a3b8', borderWidth: 2, opacity: opacityFor(r) },
        row: r,
      })),
      color: '#94a3b8',
    }] : []

    const listaKeysVisible = [...new Set(categoriasPresentes.map(categoriaToListaKey).filter((k): k is ListaPrecioKey => k !== null))]
    const markLineData = resumen ? listaKeysVisible
      .map((key) => {
        const value = resumen.lista[key]
        if (value == null) return null
        return { name: listaPrecioLabel(key), yAxis: value, label: { formatter: listaPrecioLabel(key), position: 'insideEndTop' as const }, lineStyle: { type: 'dashed' as const, color: '#94a3b8' } }
      })
      .filter((v): v is NonNullable<typeof v> => v !== null) : []

    const listaSeries = [{
      name: '__listas__',
      type: 'line' as const,
      data: [],
      silent: true,
      tooltip: { show: false },
      markLine: { silent: true, symbol: 'none' as const, data: markLineData },
    }]

    const legendNames = [...categoriasPresentes.map(categoriaLabel), ...(showAtipicos ? ['Atípicos'] : [])]

    const option: PriceChartOption = {
      grid: { left: 56, right: 24, top: 40, bottom: 74 },
      xAxis: { type: 'time' },
      yAxis: { type: 'value', name: `Bs por ${resumen?.lista.unidadBase ?? 'unidad'}`, nameLocation: 'middle', nameGap: 44 },
      legend: { data: legendNames, top: 0, type: 'scroll' },
      tooltip: {
        trigger: 'item',
        formatter: (params) => {
          const p = params as unknown as { data?: ChartDatum }
          const row = p.data?.row
          if (!row) return ''
          const vsLista = row.precioListaUnidadBase ? `${(((row.precioUnidadBase / row.precioListaUnidadBase) - 1) * 100).toFixed(1)}%` : '—'
          return [
            `<strong>${fmtDate(row.fecha)}</strong> · ${row.numero}`,
            `${row.cliente ?? 'Cliente de mostrador'} · ${categoriaLabel(row.categoria)} · ${row.fuente}`,
            `${row.cantidadBase.toLocaleString('es-BO')} ${row.presentacion}`,
            `Bs/${resumen?.lista.unidadBase ?? 'unidad'}: <strong>${bs(row.precioUnidadBase)}</strong> · cobrado: ${bs(row.precioUnitario)}/${row.presentacion}`,
            row.modificado ? '<em>Precio modificado a mano</em>' : '',
            row.precioListaUnidadBase != null ? `Lista: ${bs(row.precioListaUnidadBase)} (${vsLista})` : '',
          ].filter(Boolean).join('<br/>')
        },
      },
      dataZoom: [
        { type: 'slider', xAxisIndex: 0, height: 18, bottom: 36, start: zoomPercent[0], end: zoomPercent[1] },
        { type: 'inside', xAxisIndex: 0 },
      ],
      series: [...categoriaSeries, ...medianLines, ...outlierSeries, ...listaSeries],
    }
    return option
    // eslint-disable-next-line react-hooks/exhaustive-deps -- zoomPercent is read but intentionally not a trigger for full option rebuilds beyond the dataZoom start/end passthrough
  }, [historial, historialStatus, chipFilteredRows, categoriasPresentes, clienteFiltro, showAtipicos, resumen])

  const handleChartClick = useMemo(() => (params: { data?: unknown }) => {
    const data = params.data as ChartDatum | undefined
    if (!data?.row) return
    const key = rowKey(data.row)
    setSelectedKey(key)
    rowRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  const chartRef = useEChart(chartHostRef, chartOption, { click: handleChartClick as never })

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const handler = (params: unknown) => {
      const evt = params as { batch?: Array<{ start?: number; end?: number }>; start?: number; end?: number }
      const batch = evt.batch?.[0] ?? evt
      if (typeof batch.start === 'number' && typeof batch.end === 'number') setZoomPercent([batch.start, batch.end])
    }
    chart.on('datazoom', handler)
    return () => { chart.off('datazoom', handler) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once after chart mount, picks up chartRef.current set by useEChart's own mount effect
  }, [])

  const quickRange = (months: number | null) => {
    const chart = chartRef.current
    if (!chart || !dateRange) return
    const [, max] = dateRange
    if (months === null) { chart.dispatchAction({ type: 'dataZoom', start: 0, end: 100 }); return }
    const start = new Date(max)
    start.setMonth(start.getMonth() - months)
    const [min] = dateRange
    const span = Math.max(1, max - min)
    const startPct = Math.max(0, ((start.getTime() - min) / span) * 100)
    chart.dispatchAction({ type: 'dataZoom', start: startPct, end: 100 })
  }

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); return }
    setSortKey(key)
    setSortDir(key === 'fecha' ? 'desc' : 'asc')
  }

  const exportCsv = () => {
    const csv = buildCsv(sortedTableRows, [
      { header: 'Fecha', value: (r) => fmtDate(r.fecha) },
      { header: 'Documento', value: (r) => r.numero },
      { header: 'Cliente', value: (r) => r.cliente ?? 'Mostrador' },
      { header: 'Categoría', value: (r) => categoriaLabel(r.categoria) },
      { header: 'Fuente', value: (r) => r.fuente },
      { header: 'Cantidad', value: (r) => r.cantidadBase },
      { header: 'Presentación', value: (r) => r.presentacion },
      { header: 'Precio cobrado', value: (r) => r.precioUnitario },
      { header: 'Bs/unidad base', value: (r) => r.precioUnidadBase },
      { header: 'vs lista (%)', value: (r) => (r.precioListaUnidadBase ? (((r.precioUnidadBase / r.precioListaUnidadBase) - 1) * 100).toFixed(1) : '') },
    ])
    downloadCsv(`historial-precios-${productName.replace(/\s+/g, '_')}.csv`, csv)
  }

  const hasAnyHistory = historial.length > 0

  // resumen_precios_producto's `ultimo` has no documento_id (see the RPC's jsonb_build_object) —
  // resolve it by número against the already-loaded full-range historial instead of a second query.
  const findByNumero = (numero: string) => historial.find((r) => r.numero === numero)

  return <div className="precios-tab">
    <div className="precios-header">
      <div className="precios-window-selector">
        {WINDOW_OPTIONS.map((opt) => <button key={opt.dias} type="button" className={dias === opt.dias ? 'active' : ''} onClick={() => setDias(opt.dias)}>{opt.label}</button>)}
      </div>
      {resumenStatus === 'loading' ? <FeatureState type="loading" text="Cargando resumen" /> : resumenStatus === 'error' ? <FeatureState type="error" text="No se pudo cargar el resumen" /> : !resumen?.categorias.length ? <span className="empty-hint">Sin ventas ni pedidos cobrados en esta ventana.</span> : <div className="precios-cards">
        {resumen.categorias.map((cat) => {
          const listaKey = categoriaToListaKey(cat.categoria)
          const listaValue = listaKey ? resumen.lista[listaKey] : null
          const delta = listaValue ? ((cat.mediana / listaValue) - 1) * 100 : null
          const ultimoRow = findByNumero(cat.ultimo.numero)
          return <div key={cat.categoria} className="precios-card" style={{ borderTopColor: categoriaColor(cat.categoria) }}>
            <strong>{categoriaLabel(cat.categoria)}</strong>
            <button type="button" className="precios-card-ultimo" disabled={!ultimoRow} onClick={() => ultimoRow && openDocument(ultimoRow.fuente, ultimoRow.documentoId)} title={ultimoRow ? 'Abrir documento' : undefined}>
              <span>Último</span>
              <span className="precios-card-ultimo-value">{bs(cat.ultimo.precio)} · {cat.ultimo.cliente ?? 'Mostrador'} · {cat.ultimo.numero}</span>
            </button>
            <div className="precios-card-stats">
              <span>Mediana <strong>{bs(cat.mediana)}</strong></span>
              <span>{bs(cat.minimo)} – {bs(cat.maximo)}</span>
              <span>{cat.lineas} línea{cat.lineas === 1 ? '' : 's'} · {cat.unidades.toLocaleString('es-BO')} unidades</span>
            </div>
            {delta !== null && <span className={`precios-delta-chip ${delta >= 0 ? 'positive' : 'negative'}`}>{delta >= 0 ? '+' : ''}{delta.toFixed(0)}% sobre lista {categoriaLabel(listaKey ?? '')}</span>}
          </div>
        })}
      </div>}
    </div>

    <div className="precios-chart-controls">
      <div className="precios-chips">
        <button type="button" className={showPedidos ? 'active' : ''} onClick={() => setShowPedidos((v) => !v)}>Pedidos</button>
        <button type="button" className={showVentas ? 'active' : ''} onClick={() => setShowVentas((v) => !v)}>Ventas</button>
        <button type="button" className={showCotizaciones ? 'active' : ''} onClick={() => setShowCotizaciones((v) => !v)}>Cotizaciones</button>
        <button type="button" className={showAtipicos ? 'active atipicos' : 'atipicos'} onClick={() => setShowAtipicos((v) => !v)}>Mostrar atípicos</button>
      </div>
      <div className="precios-quick-range">
        <button type="button" onClick={() => quickRange(1)}>1M</button>
        <button type="button" onClick={() => quickRange(3)}>3M</button>
        <button type="button" onClick={() => quickRange(6)}>6M</button>
        <button type="button" onClick={() => quickRange(null)}>Todo</button>
      </div>
      <div className="precios-cliente-filter">
        <input
          value={clienteFiltro ?? clienteQuery}
          placeholder="Filtrar por cliente..."
          onFocus={() => setShowClienteDropdown(true)}
          onChange={(e) => { setClienteFiltro(null); setClienteQuery(e.target.value); setShowClienteDropdown(true) }}
        />
        {showClienteDropdown && <div className="precios-cliente-dropdown">
          {clienteMatches.map((name) => <button type="button" key={name} onClick={() => { setClienteFiltro(name); setClienteQuery(''); setShowClienteDropdown(false) }}>{name}</button>)}
          {clienteFiltro && <button type="button" className="clear" onClick={() => { setClienteFiltro(null); setClienteQuery(''); setShowClienteDropdown(false) }}>Quitar filtro</button>}
          <button type="button" className="close-picker" onClick={() => setShowClienteDropdown(false)}>Cerrar</button>
        </div>}
      </div>
    </div>

    {historialStatus === 'loading' ? <FeatureState type="loading" text="Cargando historial" /> : historialStatus === 'error' ? <FeatureState type="error" text="No se pudo cargar el historial" /> : !hasAnyHistory ? <FeatureState type="empty" text="Este producto todavía no tiene pedidos, cotizaciones ni ventas con precio." /> : <>
      <div className="precios-chart-host" ref={chartHostRef} />

      <div className="precios-table-toolbar">
        <span>{sortedTableRows.length} línea{sortedTableRows.length === 1 ? '' : 's'}</span>
        <button type="button" onClick={exportCsv}><Download size={14} /> Exportar CSV</button>
      </div>
      <div className="feature-table precios-table">
        <div className="table-head">
          {([['fecha', 'Fecha'], ['categoria', 'Categoría'], ['cliente', 'Cliente'], ['precioUnitario', 'Precio cobrado'], ['precioUnidadBase', 'Bs/unidad base'], ['vsLista', 'vs lista']] as [SortKey, string][]).map(([key, label]) => (
            <span key={key} className="precios-sortable" onClick={() => toggleSort(key)}>{label} <ArrowUpDown size={11} /></span>
          ))}
          <span>Documento</span><span>Fuente</span><span>Cantidad</span><span>Presentación</span><span></span>
        </div>
        {sortedTableRows.map((r) => {
          const key = rowKey(r)
          const vsLista = r.precioListaUnidadBase ? (((r.precioUnidadBase / r.precioListaUnidadBase) - 1) * 100) : null
          return <article key={key} ref={(el) => { rowRefs.current[key] = el }} className={`${r.atipico ? 'precios-row-outlier' : ''} ${selectedKey === key ? 'precios-row-selected' : ''}`}>
            <span>{fmtDate(r.fecha)}</span>
            <span>{categoriaLabel(r.categoria)}</span>
            <span>{r.cliente ?? 'Mostrador'}</span>
            <span>{bs(r.precioUnitario)}</span>
            <span>{bs(r.precioUnidadBase)}</span>
            <span>{vsLista !== null ? `${vsLista >= 0 ? '+' : ''}${vsLista.toFixed(0)}%` : '—'}</span>
            <span>{r.numero}</span>
            <span>{r.fuente}</span>
            <span>{r.cantidadBase.toLocaleString('es-BO')}</span>
            <span>{r.presentacion}</span>
            <span><button type="button" className="precios-open-link" onClick={() => openDocument(r.fuente, r.documentoId)}><ExternalLink size={12} /> Abrir</button></span>
          </article>
        })}
      </div>
    </>}
  </div>
}

export default PreciosTab
