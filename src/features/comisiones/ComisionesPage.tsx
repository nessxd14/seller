import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, PenLine, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { comisionesService } from '../../infrastructure/services'
import type {
  ComisionDevengoRow, ComisionEstado, ComisionLineaDevengo, ComisionLiquidacion, ComisionOrigen, ComisionProductoHuerfano,
  ComisionRegla, ComisionReglaInput, ComisionSeguimiento, ComisionVendedor,
} from '../../application/ports/comisionesRepository'
import type { ReportDateRange } from '../../application/ports/reportsRepository'
import { FeatureShell, FeatureState } from '../shared/FeatureShell'
import { formatMoney, money } from '../../domain/common/money'
import { hoyLocal, sumarDiasIso } from '../../domain/common/fechas'
import { Modal } from '../../components/Modal'
import { coincideBusqueda } from '../../domain/customers/textSearch'
import { buildCsv, downloadCsv } from '../../domain/common/csv'

type Tab = 'mias' | 'equipo' | 'liquidar' | 'reglas' | 'vendedores'
type SortKey = 'fecha' | 'monto' | 'estado'
const PAGE_SIZE = 25

const bs = (cents: number) => formatMoney(money(cents))
const fecha = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString('es-BO')
// Fase 2, 3.4: el cociente monto÷base se corre por el redondeo a centavos por documento
// (0,99%–1,05% en vez de 1%) — redondear la vista a 1 decimal alcanza mientras todas las
// reglas estén al 1%; no vale la pena mostrar el porcentaje "de la regla" por separado
// cuando un documento puede mezclar líneas con distinto % (ver comision_lineas_devengo).
const pct = (bp: number) => `${(bp / 100).toLocaleString('es-BO', { maximumFractionDigits: 1 })}%`
const diasDesdeHoy = (isoFecha: string) => Math.round((new Date(`${isoFecha}T00:00:00`).getTime() - new Date(`${hoyLocal()}T00:00:00`).getTime()) / 86400000)

// Fase 2, 3.1 — "qué falta para cobrar". Combina el estado del devengo con el RPC
// comision_seguimiento (que trae saldo/vencimiento de hermes). Vive acá y no en el
// backend porque es puro formato de presentación en español, no una regla de negocio.
function labelSeguimiento(row: ComisionDevengoRow, seg: ComisionSeguimiento | undefined): string {
  if (row.estado === 'LIQUIDADA') return row.liquidacionFecha ? `Liquidada el ${fecha(row.liquidacionFecha)}` : 'Liquidada'
  if (row.estado === 'DEVENGADA') return 'Devengada'
  if (row.estado === 'ANULADA') return 'Anulada'
  // POTENCIAL
  if (row.origen === 'VTD') return 'Pendiente'
  if (!seg || seg.partidas === 0) return 'Sin partida en cartera'
  if (seg.pendienteCents <= 0) return 'Cobrado 100% · procesando'
  if (seg.pendienteCents < seg.partidaTotalCents) {
    const cobradoPct = Math.round(((seg.partidaTotalCents - seg.pendienteCents) / seg.partidaTotalCents) * 100)
    return `Cobrado ${cobradoPct}% · faltan ${bs(seg.pendienteCents)}`
  }
  if (seg.diasVencido !== null && seg.diasVencido > 0) return `Vencido hace ${seg.diasVencido} día${seg.diasVencido === 1 ? '' : 's'}`
  if (seg.fechaVencimiento) {
    const dias = diasDesdeHoy(seg.fechaVencimiento)
    return dias >= 0 ? `Esperando cobro · vence en ${dias} día${dias === 1 ? '' : 's'}` : `Vencido hace ${-dias} día${-dias === 1 ? '' : 's'}`
  }
  return 'Esperando cobro'
}

// Fase 3, Parte 2: qué regla matcheó una línea — "limpieza · 0,5%" para el paraguas de
// limpieza, "cinta de embalaje · 1%" para una regla NOMBRE existente aplicada sobre
// texto libre, etc. Sin esto solo se ve el número, no de dónde salió — justo lo que hay
// que poder auditar antes de pagar una comisión sobre una descripción tipeada a mano.
const reglaLabel = (l: ComisionLineaDevengo): string => {
  if (!l.comisiona) return 'No'
  if (l.reglaPatron) return `Sí · ${l.reglaPatron} · ${pct(l.porcentajeBp ?? 0)}`
  return `Sí · ${pct(l.porcentajeBp ?? 0)}`
}

function LineasDevengo({ devengoId }: { devengoId: string }) {
  const [lineas, setLineas] = useState<ComisionLineaDevengo[] | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    void comisionesService.getLineasDevengo(devengoId).then((r) => { setLineas(r); setStatus('ready') }).catch(() => setStatus('error'))
  }, [devengoId])
  if (status === 'loading') return <div className="comision-lineas-expandidas"><FeatureState type="skeleton" text="Cargando líneas" rows={2} /></div>
  if (status === 'error' || !lineas) return <div className="comision-lineas-expandidas"><p className="settings-note">No se pudieron cargar las líneas.</p></div>
  return <div className="comision-lineas-expandidas">
    <div className="feature-table reports-table reports-table-comision-lineas">
      <div className="table-head"><span>Producto</span><span>Marca</span><span>Subtotal</span><span>Comisiona</span></div>
      {lineas.map((l, i) => <article key={l.productoId ?? `custom-${i}`} className={l.comisiona ? '' : 'comision-linea-no-comisiona'}>
        <span>{l.esPersonalizado && <span title="Ítem personalizado"><PenLine size={12} className="comision-icono-personalizado" /></span>} {l.productoNombre}</span>
        <span>{l.marca ?? '—'}</span><span>{bs(l.subtotalCents)}</span>
        <span>{reglaLabel(l)}</span>
      </article>)}
    </div>
  </div>
}

function DevengoTable({ rows, showVendedor, nombrePorEmail, seguimiento }: {
  rows: ComisionDevengoRow[]; showVendedor: boolean; nombrePorEmail: Record<string, string>; seguimiento: Record<string, ComisionSeguimiento>
}) {
  const [sortKey, setSortKey] = useState<SortKey>('fecha')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [expandido, setExpandido] = useState<string | null>(null)

  // eslint-disable-next-line react-hooks/set-state-in-effect -- resincroniza la paginación cuando cambia el conjunto de filas (nuevo filtro/fecha), no un fetch que difiera
  useEffect(() => { setPage(1) }, [rows])

  const sorted = useMemo(() => {
    const factor = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      if (sortKey === 'fecha') return factor * a.fecha.localeCompare(b.fecha)
      if (sortKey === 'monto') return factor * (a.montoCents - b.montoCents)
      return factor * a.estado.localeCompare(b.estado)
    })
  }, [rows, sortKey, sortDir])

  const totalEstado = (estado: ComisionEstado) => rows.filter((r) => r.estado === estado).reduce((sum, r) => sum + r.montoCents, 0)
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }
  const sortIcon = (key: SortKey) => sortKey !== key ? null : sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />

  return <>
    <div className="management-stats commission-stats">
      <div><span>Potencial</span><strong>{bs(totalEstado('POTENCIAL'))}</strong><small>Pendiente de cumplir las condiciones de cobro</small></div>
      <div><span>Disponible para liquidar</span><strong>{bs(totalEstado('DEVENGADA'))}</strong><small>Comisiones devengadas</small></div>
      <div><span>Ya liquidado</span><strong>{bs(totalEstado('LIQUIDADA'))}</strong><small>Liquidaciones registradas</small></div>
    </div>
    <div className="management-list-heading"><h2>Detalle de comisiones</h2><span>{rows.length} documentos · Selecciona una fila para ver sus productos</span></div>
    <div className={`feature-table reports-table${showVendedor ? ' reports-table-comisiones-equipo' : ' reports-table-comisiones'}`}>
      <div className="table-head">
        {showVendedor && <span>Vendedor</span>}
        <span>Origen</span><span>Documento</span><span>Cliente</span>
        <button className="table-head-sort" onClick={() => toggleSort('fecha')}>Fecha {sortIcon('fecha')}</button>
        <span>Base</span><span>%</span>
        <button className="table-head-sort" onClick={() => toggleSort('monto')}>Comisión {sortIcon('monto')}</button>
        <button className="table-head-sort" onClick={() => toggleSort('estado')}>Qué falta para cobrar {sortIcon('estado')}</button>
      </div>
      {pageRows.map((row) => <div key={row.id} className="comision-fila-expandible">
        <article role="button" tabIndex={0} aria-expanded={expandido === row.id} aria-label={`Ver productos de ${row.documentoId}`} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandido(expandido === row.id ? null : row.id) } }} className={row.estado === 'POTENCIAL' ? 'comision-potencial clickable-row' : 'clickable-row'} onClick={() => setExpandido(expandido === row.id ? null : row.id)}>
          {showVendedor && <span>{nombrePorEmail[row.vendedorEmail] ?? row.vendedorEmail}</span>}
          <span>{row.origen === 'PEDIDO' ? 'Pedido' : 'Venta directa'}</span>
          <span>{row.documentoId}{row.tienePersonalizadoComisionable && <span title="Tiene líneas personalizadas que comisionan — conviene revisar antes de liquidar"><PenLine size={12} className="comision-icono-personalizado" /></span>}</span>
          <span>{row.clienteNombre ?? '—'}</span><span>{fecha(row.fecha)}</span><span>{bs(row.baseComisionableCents)}</span>
          <span>{pct(row.porcentajeBp)}</span><span>{bs(row.montoCents)}</span>
          <span className="commission-status-cell"><b className={`commission-status state-${row.estado.toLowerCase()}`}>{({ POTENCIAL: 'Potencial', DEVENGADA: 'Devengada', LIQUIDADA: 'Liquidada', ANULADA: 'Anulada' })[row.estado]}</b><small>{labelSeguimiento(row, seguimiento[row.id])}</small></span>
        </article>
        {expandido === row.id && <LineasDevengo devengoId={row.id} />}
      </div>)}
    </div>
    <div className="pagination-bar"><span>Página {page} de {totalPages} · {sorted.length} registros</span>
      <button aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}><ChevronLeft size={14} /></button>
      <button aria-label="Página siguiente" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}><ChevronRight size={14} /></button>
    </div>
  </>
}

function EquipoTotales({ rows, nombrePorEmail }: { rows: ComisionDevengoRow[]; nombrePorEmail: Record<string, string> }) {
  const porVendedor = new Map<string, { documentos: number; base: number; comision: number }>()
  for (const row of rows) {
    const actual = porVendedor.get(row.vendedorEmail) ?? { documentos: 0, base: 0, comision: 0 }
    actual.documentos += 1; actual.base += row.baseComisionableCents; actual.comision += row.montoCents
    porVendedor.set(row.vendedorEmail, actual)
  }
  const entries = [...porVendedor.entries()].sort((a, b) => b[1].comision - a[1].comision)
  return <details className="commission-team-summary"><summary>Resumen por vendedor <span>{entries.length} vendedores · incluye todos los estados filtrados</span></summary><div className="feature-table reports-table commission-team-table">
    <div className="table-head"><span>Vendedor</span><span>Documentos</span><span>Base comisionable</span><span>Comisión</span></div>
    {entries.map(([email, t]) => <article key={email}><span>{nombrePorEmail[email] ?? email}</span><span>{t.documentos}</span><span>{bs(t.base)}</span><span>{bs(t.comision)}</span></article>)}
  </div></details>
}

const emptyReglaForm: ComisionReglaInput = { tipo: 'MARCA', patron: '', accion: 'INCLUIR', porcentajeBp: 100, prioridad: 100, activo: true, nota: null, creadoPor: null }

function ReglasTab({ notify }: { notify: (message: string) => void }) {
  const [reglas, setReglas] = useState<ComisionRegla[]>([])
  const [conteo, setConteo] = useState<Record<string, number>>({})
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [form, setForm] = useState<ComisionReglaInput | null>(null)
  const [dates, setDates] = useState<ReportDateRange>({ from: sumarDiasIso(hoyLocal(), -30), to: hoyLocal() })
  const [huerfanos, setHuerfanos] = useState<ComisionProductoHuerfano[]>([])
  const [huerfanosStatus, setHuerfanosStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  const load = () => {
    setStatus('loading')
    void Promise.all([comisionesService.listReglas(), comisionesService.getReglaConteo()])
      .then(([r, c]) => { setReglas(r); setConteo(c); setStatus('ready') }).catch(() => setStatus('error'))
  }
  useEffect(() => { void Promise.resolve().then(load) }, [])
  useEffect(() => {
    void Promise.resolve().then(() => setHuerfanosStatus('loading'))
    void comisionesService.getProductosHuerfanos(dates).then((r) => { setHuerfanos(r); setHuerfanosStatus('ready') }).catch(() => setHuerfanosStatus('error'))
  }, [dates])

  const save = async () => {
    if (!form || !form.patron.trim() || saving) return
    setSaving(true); setSaveError('')
    try {
      await (editingId ? comisionesService.updateRegla(editingId, form) : comisionesService.createRegla(form))
      notify(editingId ? 'Regla actualizada' : 'Regla creada')
      setForm(null); setEditingId(null); load()
    } catch { setSaveError('No se pudo guardar la regla. Revisa los datos e intenta nuevamente.') } finally { setSaving(false) }
  }
  const editRegla = (r: ComisionRegla) => { setSaveError(''); setEditingId(r.id); setForm({ tipo: r.tipo, patron: r.patron, accion: r.accion, porcentajeBp: r.porcentajeBp, prioridad: r.prioridad, activo: r.activo, nota: r.nota, creadoPor: r.creadoPor }) }
  const removeRegla = async (id: string) => { if (!confirm('¿Eliminar esta regla?')) return; try { await comisionesService.deleteRegla(id); notify('Regla eliminada'); load() } catch { notify('No se pudo eliminar') } }
  // Fase 2, 3.8: atajo desde un huérfano — precarga el formulario con MARCA=esa marca,
  // en vez de mandar al gerente a tipearla a mano en un formulario vacío.
  const crearReglaParaMarca = (marca: string) => { setSaveError(''); setEditingId(null); setForm({ ...emptyReglaForm, tipo: 'MARCA', patron: marca }) }

  return <>
    <div className="management-list-heading"><div><h2>Reglas de comisión</h2><p>Define qué productos participan y el porcentaje que les corresponde.</p></div></div>
    <div className="feature-toolbar">
      <button className="secondary-button" onClick={() => { setSaveError(''); setEditingId(null); setForm(emptyReglaForm) }}><Plus size={14} /> Nueva regla</button>
    </div>
    {form && <Modal title={editingId ? 'Editar regla' : 'Nueva regla de comisión'} subtitle="Configura la coincidencia y su participación en las comisiones." className="commercial-modal commission-rule-modal" wide onClose={() => { if (!saving) setForm(null) }}><form id="commission-rule" className="modal-body" onSubmit={(e) => { e.preventDefault(); void save() }}><section className="commercial-section"><div className="commercial-section-heading"><div><h3>Coincidencia y cálculo</h3><p>El patrón se aplica al campo seleccionado.</p></div></div><div className="form-grid">
      <label>Tipo<select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as ComisionReglaInput['tipo'] })}><option value="MARCA">Marca</option><option value="NOMBRE">Nombre</option><option value="DESCRIPCION">Descripción (líneas personalizadas)</option></select></label>
      <label>Acción<select value={form.accion} onChange={(e) => setForm({ ...form, accion: e.target.value as ComisionReglaInput['accion'] })}><option value="INCLUIR">Incluir</option><option value="EXCLUIR">Excluir</option></select></label>
      <label>Patrón *<input autoFocus required value={form.patron} onChange={(e) => setForm({ ...form, patron: e.target.value })} placeholder={form.tipo === 'MARCA' ? 'Ej. ROARI' : form.tipo === 'DESCRIPCION' ? 'Ej. limpieza' : 'Ej. clip'} /></label>
      <label>Porcentaje (%)<input required min="0" max="100" disabled={form.accion === 'EXCLUIR'} type="number" step="0.01" value={form.porcentajeBp / 100} onChange={(e) => setForm({ ...form, porcentajeBp: Math.round(Number(e.target.value) * 100) })} /></label>
      <label>Prioridad<input required type="number" value={form.prioridad} onChange={(e) => setForm({ ...form, prioridad: Number(e.target.value) })} /></label>
      <label className="management-checkbox">Regla activa<input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} /></label>
      <label className="full">Nota interna<input placeholder="Describe el motivo o alcance de esta regla" value={form.nota ?? ''} onChange={(e) => setForm({ ...form, nota: e.target.value || null })} /></label>
      </div></section><p className="commission-rule-preview">{form.accion === 'EXCLUIR' ? 'Los productos que coincidan quedarán excluidos de comisión.' : 'Comisión del ' + pct(form.porcentajeBp) + ' para las coincidencias de esta regla.'}</p>{saveError && <p className="field-error" role="alert">{saveError}</p>}</form><footer className="modal-actions"><button className="secondary-button" disabled={saving} onClick={() => { setForm(null); setEditingId(null) }}>Cancelar</button><button form="commission-rule" type="submit" className="primary-button" disabled={saving || !form.patron.trim()}>{saving ? 'Guardando…' : 'Guardar regla'}</button></footer>
    </Modal>}
    {status === 'loading' ? <FeatureState type="skeleton" text="Cargando reglas" /> : status === 'error' ? <FeatureState type="error" text="No se pudieron cargar las reglas" /> : <div className="feature-table reports-table reports-table-comision-reglas">
      <div className="table-head"><span>Tipo</span><span>Patrón</span><span>Acción</span><span>%</span><span>Prioridad</span><span>Coincidencias</span><span>Activa</span><span></span></div>
      {reglas.map((r) => {
        const n = conteo[r.id] ?? 0
        return <article key={r.id}><span>{r.tipo}</span><span>{r.patron}</span><span>{r.accion}</span><span>{pct(r.porcentajeBp)}</span><span>{r.prioridad}</span>
          <span className={n === 0 ? 'comision-regla-sin-match' : ''}>{n === 0 ? '0 · revisar' : n}</span>
          <span className={`status-chip ${r.activo ? 'ok' : 'problem'}`}>{r.activo ? 'Sí' : 'No'}</span>
          <span><button className="icon-button" onClick={() => editRegla(r)} title="Editar">✎</button><button className="icon-button" onClick={() => void removeRegla(r.id)} title="Eliminar"><Trash2 size={14} /></button></span>
        </article>
      })}
    </div>}

    <section className="settings-section">
      <header><h2>Productos sin regla</h2><p>Revisa los productos vendidos en el período que todavía no coinciden con una regla.</p></header>
      <div className="feature-toolbar reports-toolbar">
        <label className="reports-date-label">Desde<input type="date" value={dates.from} onChange={(e) => setDates({ ...dates, from: e.target.value })} /></label>
        <label className="reports-date-label">Hasta<input type="date" value={dates.to} onChange={(e) => setDates({ ...dates, to: e.target.value })} /></label>
      </div>
      {huerfanosStatus === 'loading' ? <FeatureState type="skeleton" text="Buscando productos huérfanos" /> : huerfanosStatus === 'error' ? <FeatureState type="error" text="No se pudo calcular" /> : !huerfanos.length ? <FeatureState type="empty" text="Ningún producto vendido en el período quedó sin regla" /> : <div className="feature-table reports-table reports-table-comision-huerfanos">
        <div className="table-head"><span>Producto</span><span>Marca</span><span>Monto vendido</span><span></span></div>
        {huerfanos.map((h) => <article key={h.productoId}><span>{h.productoNombre}</span><span>{h.marca ?? '—'}</span><span>{bs(h.montoVendidoCents)}</span>
          <span>{h.marca && <button className="secondary-button" onClick={() => crearReglaParaMarca(h.marca!)}><Plus size={12} /> Regla para {h.marca}</button>}</span>
        </article>)}
      </div>}
    </section>
  </>
}

function VendedoresTab({ notify }: { notify: (message: string) => void }) {
  const [vendedores, setVendedores] = useState<ComisionVendedor[]>([])
  const [disponibles, setDisponibles] = useState<Array<{ id: string; nombre: string; email: string }>>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [seleccion, setSeleccion] = useState('')

  const load = () => {
    setStatus('loading')
    void Promise.all([comisionesService.listVendedores(), comisionesService.listPerfilesDisponibles()])
      .then(([v, d]) => { setVendedores(v); setDisponibles(d); setStatus('ready') }).catch(() => setStatus('error'))
  }
  useEffect(() => { void Promise.resolve().then(load) }, [])

  const toggle = async (perfilId: string, activo: boolean) => { try { await comisionesService.setVendedorActivo(perfilId, activo); notify(activo ? 'Vendedor activado' : 'Vendedor dado de baja'); load() } catch { notify('No se pudo actualizar') } }
  const agregar = async () => { if (!seleccion) return; try { await comisionesService.addVendedor(seleccion); notify('Vendedor agregado'); setSeleccion(''); load() } catch { notify('No se pudo agregar') } }

  if (status === 'loading') return <FeatureState type="skeleton" text="Cargando vendedores" />
  if (status === 'error') return <FeatureState type="error" text="No se pudieron cargar los vendedores" />
  return <>
    <div className="feature-toolbar">
      <select aria-label="Agregar vendedor" value={seleccion} onChange={(e) => setSeleccion(e.target.value)}>
        <option value="">Agregar vendedor…</option>
        {disponibles.map((p) => <option key={p.id} value={p.id}>{p.nombre} ({p.email})</option>)}
      </select>
      <button className="secondary-button" onClick={() => void agregar()} disabled={!seleccion}><Plus size={14} /> Agregar</button>
    </div>
    <div className="feature-table reports-table commission-vendors-table">
      <div className="table-head"><span>Nombre</span><span>Email</span><span>Desde</span><span>Activo</span><span></span></div>
      {vendedores.map((v) => <article key={v.perfilId}><span>{v.nombre}</span><span>{v.email}</span><span>{fecha(v.desde)}</span><span className={`status-chip ${v.activo ? 'ok' : 'problem'}`}>{v.activo ? 'Sí' : 'No'}</span>
        <span><button className="secondary-button" onClick={() => void toggle(v.perfilId, !v.activo)}>{v.activo ? 'Dar de baja' : 'Reactivar'}</button></span>
      </article>)}
    </div>
  </>
}

// Fase 2, Parte 2 — liquidación por lotes. El gerente filtra por vendedor, ve la cola de
// DEVENGADA sin liquidar, tilda ("seleccionar todos" incluido), ve el total y confirma.
function LiquidarTab({ notify, vendedores }: { notify: (message: string) => void; vendedores: ComisionVendedor[] }) {
  const [vendedorEmail, setVendedorEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const queueRequest = useRef(0)
  const submitting = useRef(false)
  const [cola, setCola] = useState<ComisionDevengoRow[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [form, setForm] = useState({ medioPago: '', referencia: '', comprobanteUrl: '', nota: '' })
  const [historial, setHistorial] = useState<ComisionLiquidacion[]>([])
  const [historialStatus, setHistorialStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const cargarCola = (email: string) => {
    const request = ++queueRequest.current
    setSeleccion(new Set()); setCola([])
    if (!email) { setCola([]); setStatus('idle'); return }
    setStatus('loading')
    void comisionesService.getEquipo({ dates: { from: '2000-01-01', to: hoyLocal() }, filtros: { vendedorEmail: email, estado: 'DEVENGADA' } })
      .then((rows) => { if (request === queueRequest.current) { setCola(rows); setStatus('ready') } }).catch(() => { if (request === queueRequest.current) setStatus('error') })
  }
  const cargarHistorial = () => {
    setHistorialStatus('loading')
    void comisionesService.listLiquidaciones().then((r) => { setHistorial(r); setHistorialStatus('ready') }).catch(() => setHistorialStatus('error'))
  }
  useEffect(() => { void Promise.resolve().then(cargarHistorial) }, [])

  const toggleFila = (id: string) => setSeleccion((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const toggleTodos = () => setSeleccion((prev) => (prev.size === cola.length ? new Set() : new Set(cola.map((r) => r.id))))
  const totalSeleccionado = cola.filter((r) => seleccion.has(r.id)).reduce((sum, r) => sum + r.montoCents, 0)

  const confirmar = async () => {
    if (!seleccion.size || status !== 'ready' || submitting.current) return
    submitting.current = true; setSaving(true)
    try {
      await comisionesService.crearLiquidacion({
        vendedorEmail, devengoIds: [...seleccion],
        medioPago: form.medioPago || undefined, referencia: form.referencia || undefined,
        comprobanteUrl: form.comprobanteUrl || undefined, nota: form.nota || undefined,
      })
      notify('Liquidación registrada')
      setForm({ medioPago: '', referencia: '', comprobanteUrl: '', nota: '' })
      cargarCola(vendedorEmail); cargarHistorial()
    } catch { notify('No se pudo registrar la liquidación') } finally { submitting.current = false; setSaving(false) }
  }
  const anular = async (id: string) => {
    if (!confirm('¿Anular esta liquidación? Sus devengos vuelven a la cola.')) return
    try { await comisionesService.anularLiquidacion(id, 'Anulada desde Comisiones'); notify('Liquidación anulada'); cargarHistorial(); if (vendedorEmail) cargarCola(vendedorEmail) }
    catch { notify('No se pudo anular') }
  }

  return <>
    <div className="management-list-heading"><div><h2>Preparar liquidación</h2><p>Elige un vendedor y selecciona las comisiones devengadas que vas a liquidar.</p></div></div>
    <div className="feature-toolbar">
      <select aria-label="Vendedor a liquidar" disabled={saving} value={vendedorEmail} onChange={(e) => { setVendedorEmail(e.target.value); cargarCola(e.target.value) }}>
        <option value="">Elegí un vendedor…</option>
        {vendedores.map((v) => <option key={v.perfilId} value={v.email}>{v.nombre} ({v.email})</option>)}
      </select>
    </div>
    {status === 'idle' && <FeatureState type="empty" text="Selecciona un vendedor para comenzar" />}
    {status === 'loading' && <FeatureState type="skeleton" text="Cargando devengos" />}
    {status === 'error' && <FeatureState type="error" text="No se pudo cargar la cola" />}
    {status === 'ready' && (!cola.length ? <FeatureState type="empty" text="Este vendedor no tiene devengos pendientes de liquidar" /> : <>
      <div className="feature-table reports-table reports-table-liquidar">
        <div className="table-head"><span><input aria-label="Seleccionar todas las comisiones" disabled={saving} type="checkbox" checked={seleccion.size === cola.length} onChange={toggleTodos} /></span><span>Origen</span><span>Documento</span><span>Fecha</span><span>Comisión</span></div>
        {cola.map((row) => <article key={row.id}><span><input aria-label={`Seleccionar ${row.documentoId}`} disabled={saving} type="checkbox" checked={seleccion.has(row.id)} onChange={() => toggleFila(row.id)} /></span>
          <span>{row.origen === 'PEDIDO' ? 'Pedido' : 'Venta directa'}</span><span>{row.documentoId}</span><span>{fecha(row.fecha)}</span><span>{bs(row.montoCents)}</span>
        </article>)}
      </div>
      <div className="commission-payment-panel"><div className="commission-payment-summary"><span>Importe seleccionado</span><strong>{bs(totalSeleccionado)}</strong><small>{seleccion.size} de {cola.length} documentos</small></div><fieldset disabled={saving} className="form-grid">
        <label>Medio de pago<input value={form.medioPago} onChange={(e) => setForm({ ...form, medioPago: e.target.value })} placeholder="Ej. TRANSFERENCIA" /></label>
        <label>Referencia<input value={form.referencia} onChange={(e) => setForm({ ...form, referencia: e.target.value })} /></label>
        <label className="full">Nota<input value={form.nota} onChange={(e) => setForm({ ...form, nota: e.target.value })} /></label>
        <div className="modal-actions full"><button className="primary-button" disabled={!seleccion.size || saving} onClick={confirmar}>{saving ? 'Registrando…' : 'Confirmar liquidación'}</button></div></fieldset>
      </div>
    </>)}

    <section className="settings-section">
      <header><h2>Historial de liquidaciones</h2></header>
      {historialStatus === 'loading' ? <FeatureState type="skeleton" text="Cargando historial" /> : historialStatus === 'error' ? <FeatureState type="error" text="No se pudo cargar" /> : !historial.length ? <FeatureState type="empty" text="Todavía no se registraron liquidaciones" /> : <div className="feature-table reports-table commission-history-table">
        <div className="table-head"><span>Vendedor</span><span>Fecha</span><span>Monto</span><span>Medio</span><span>Estado</span><span></span></div>
        {historial.map((l) => <article key={l.id}><span>{l.vendedorEmail}</span><span>{fecha(l.creadoEn.slice(0, 10))}</span><span>{bs(l.montoTotalCents)}</span><span>{l.medioPago ?? '—'}</span>
          <span className={`status-chip ${l.anuladoEn ? 'problem' : 'ok'}`}>{l.anuladoEn ? 'Anulada' : 'Vigente'}</span>
          <span>{!l.anuladoEn && <button className="secondary-button" onClick={() => void anular(l.id)}>Anular</button>}</span>
        </article>)}
      </div>}
    </section>
  </>
}

export function ComisionesPage({ notify, vendedorEmail, esGerente }: { notify: (message: string) => void; vendedorEmail: string; esGerente: boolean }) {
  const [tab, setTab] = useState<Tab>('mias')
  const [from, setFrom] = useState(sumarDiasIso(hoyLocal(), -30))
  const [to, setTo] = useState(hoyLocal())
  const [filtroEstado, setFiltroEstado] = useState<ComisionEstado | ''>('')
  const [filtroOrigen, setFiltroOrigen] = useState<ComisionOrigen | ''>('')
  const [filtroVendedor, setFiltroVendedor] = useState('')
  const [filtroCliente, setFiltroCliente] = useState('')
  const [rows, setRows] = useState<ComisionDevengoRow[]>([])
  const [seguimiento, setSeguimiento] = useState<Record<string, ComisionSeguimiento>>({})
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [vendedores, setVendedores] = useState<ComisionVendedor[]>([])
  const reportRequest = useRef(0)
  const dates: ReportDateRange = useMemo(() => ({ from, to }), [from, to])

  useEffect(() => { void comisionesService.listVendedores().then(setVendedores).catch(() => setVendedores([])) }, [])
  const nombrePorEmail = useMemo(() => Object.fromEntries(vendedores.map((v) => [v.email, v.nombre])), [vendedores])

  const refresh = useCallback(() => {
    const request = ++reportRequest.current
    if (tab !== 'mias' && tab !== 'equipo') return
    if (!from || !to || from > to) { setStatus('error'); return }
    setStatus('loading')
    const filtros = { estado: filtroEstado || undefined, origen: filtroOrigen || undefined, vendedorEmail: tab === 'equipo' ? (filtroVendedor || undefined) : undefined }
    const load = tab === 'mias' ? comisionesService.getMisComisiones({ vendedorEmail, dates, filtros }) : comisionesService.getEquipo({ dates, filtros })
    void Promise.all([load, comisionesService.getSeguimiento(dates)])
      .then(([result, seg]) => {
        if (request !== reportRequest.current) return
        setRows(result)
        setSeguimiento(Object.fromEntries(seg.map((s) => [s.devengoId, s])))
        setStatus('ready')
      }).catch(() => { if (request === reportRequest.current) setStatus('error') })
  }, [tab, from, to, filtroEstado, filtroOrigen, filtroVendedor, vendedorEmail, dates])
  // Fase 2: sigue sin realtime (fuera de alcance) — refetch al montar/cambiar filtros +
  // botón manual de refrescar.
  useEffect(() => { void Promise.resolve().then(refresh); return () => { reportRequest.current += 1 } }, [refresh])

  const rowsFiltradas = filtroCliente.trim()
    ? rows.filter((r) => coincideBusqueda([r.clienteNombre, r.documentoId, nombrePorEmail[r.vendedorEmail], r.vendedorEmail].filter(Boolean).join(' '), filtroCliente))
    : rows

  const exportCsv = () => {
    downloadCsv(`comisiones-${tab}-${from}_${to}.csv`, buildCsv(rowsFiltradas, [
      { header: 'Vendedor', value: (r) => nombrePorEmail[r.vendedorEmail] ?? r.vendedorEmail },
      { header: 'Origen', value: (r) => r.origen }, { header: 'Documento', value: (r) => r.documentoId },
      { header: 'Cliente', value: (r) => r.clienteNombre ?? '' }, { header: 'Fecha', value: (r) => r.fecha },
      { header: 'Base comisionable', value: (r) => (r.baseComisionableCents / 100).toFixed(2) },
      { header: 'Porcentaje', value: (r) => (r.porcentajeBp / 100).toFixed(2) },
      { header: 'Comisión', value: (r) => (r.montoCents / 100).toFixed(2) },
      { header: 'Estado', value: (r) => r.estado },
      { header: 'Qué falta para cobrar', value: (r) => labelSeguimiento(r, seguimiento[r.id]) },
    ]))
    notify('CSV exportado')
  }

  return <FeatureShell className="management-page commissions-page" eyebrow="GESTIÓN COMERCIAL" title="Comisiones" subtitle="Sigue cada comisión, revisa sus productos y organiza las liquidaciones."
    action={(tab === 'mias' || tab === 'equipo') ? <button className="secondary-button" onClick={exportCsv} disabled={status !== 'ready' || !rowsFiltradas.length}><Download size={14} /> Exportar CSV</button> : undefined}>
    <div className="commission-tabs" role="group" aria-label="Secciones de comisiones">
      <button className={tab === 'mias' ? 'active' : ''} aria-pressed={tab === 'mias'} onClick={() => setTab('mias')}>Mis comisiones</button>
      {esGerente && <button className={tab === 'equipo' ? 'active' : ''} aria-pressed={tab === 'equipo'} onClick={() => setTab('equipo')}>Equipo</button>}
      {esGerente && <button className={tab === 'liquidar' ? 'active' : ''} aria-pressed={tab === 'liquidar'} onClick={() => setTab('liquidar')}>Liquidar</button>}
      {esGerente && <button className={tab === 'reglas' ? 'active' : ''} aria-pressed={tab === 'reglas'} onClick={() => setTab('reglas')}>Reglas</button>}
      {esGerente && <button className={tab === 'vendedores' ? 'active' : ''} aria-pressed={tab === 'vendedores'} onClick={() => setTab('vendedores')}>Vendedores</button>}
    </div>

    {(tab === 'mias' || tab === 'equipo') && <>
      <div className="feature-toolbar reports-toolbar">
        <label className="reports-date-label">Desde<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="reports-date-label">Hasta<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <select aria-label="Estado de comisión" value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value as ComisionEstado | '')}>
          <option value="">Todos los estados</option>
          <option value="POTENCIAL">Potencial</option><option value="DEVENGADA">Devengada</option><option value="LIQUIDADA">Liquidada</option><option value="ANULADA">Anulada</option>
        </select>
        <select aria-label="Origen del documento" value={filtroOrigen} onChange={(e) => setFiltroOrigen(e.target.value as ComisionOrigen | '')}>
          <option value="">Pedido y venta directa</option>
          <option value="PEDIDO">Pedido</option><option value="VTD">Venta directa</option>
        </select>
        {tab === 'equipo' && <select aria-label="Filtrar vendedor" value={filtroVendedor} onChange={(e) => setFiltroVendedor(e.target.value)}>
          <option value="">Todos los vendedores</option>
          {vendedores.map((v) => <option key={v.perfilId} value={v.email}>{v.nombre}</option>)}
        </select>}
        <label className="reports-date-label"><input aria-label="Buscar cliente, documento o vendedor" placeholder="Cliente, documento o vendedor…" value={filtroCliente} onChange={(e) => setFiltroCliente(e.target.value)} /></label>
        <button className="secondary-button" disabled={status === 'loading'} onClick={refresh}><RefreshCw size={14} /> Refrescar</button>
      </div>
      {status === 'loading' ? <FeatureState type="skeleton" text="Cargando comisiones" /> : status === 'error' ? <FeatureState type="error" text={from && to && from <= to ? "No se pudieron cargar las comisiones" : "Revisa las fechas: Desde debe ser anterior o igual a Hasta"} /> : !rowsFiltradas.length ? <FeatureState type="empty" text="Sin comisiones para los filtros seleccionados" /> : tab === 'mias' ? <DevengoTable rows={rowsFiltradas} showVendedor={false} nombrePorEmail={nombrePorEmail} seguimiento={seguimiento} /> : <>
        <EquipoTotales rows={rowsFiltradas} nombrePorEmail={nombrePorEmail} />
        <DevengoTable rows={rowsFiltradas} showVendedor nombrePorEmail={nombrePorEmail} seguimiento={seguimiento} />
      </>}
    </>}
    {tab === 'liquidar' && esGerente && <LiquidarTab notify={notify} vendedores={vendedores} />}
    {tab === 'reglas' && esGerente && <ReglasTab notify={notify} />}
    {tab === 'vendedores' && esGerente && <VendedoresTab notify={notify} />}
  </FeatureShell>
}
