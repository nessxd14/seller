import { useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import { comisionesService } from '../../infrastructure/services'
import type {
  ComisionDevengoRow, ComisionProductoHuerfano, ComisionRegla, ComisionReglaInput, ComisionVendedor,
} from '../../application/ports/comisionesRepository'
import type { ReportDateRange } from '../../application/ports/reportsRepository'
import { FeatureShell, FeatureState } from '../shared/FeatureShell'
import { formatMoney, money } from '../../domain/common/money'
import { hoyLocal, sumarDiasIso } from '../../domain/common/fechas'

type Tab = 'mias' | 'equipo' | 'reglas' | 'vendedores'

const bs = (cents: number) => formatMoney(money(cents))
const fecha = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString('es-BO')
const pct = (bp: number) => `${(bp / 100).toLocaleString('es-BO', { maximumFractionDigits: 2 })}%`

function DevengoTable({ rows, showVendedor }: { rows: ComisionDevengoRow[]; showVendedor: boolean }) {
  const totalBase = rows.reduce((sum, r) => sum + r.baseComisionableCents, 0)
  const totalComision = rows.reduce((sum, r) => sum + r.montoCents, 0)
  return <>
    <div className="reports-stat-tiles">
      <div><span>Documentos</span><strong>{rows.length}</strong></div>
      <div><span>Base comisionable</span><strong>{bs(totalBase)}</strong></div>
      <div><span>Comisión</span><strong>{bs(totalComision)}</strong></div>
    </div>
    <p className="settings-note">Las filas en azul (POTENCIAL) todavía no son cobrables — pasan a devengadas cuando la partida del documento se cobra al 100%.</p>
    <div className={`feature-table reports-table${showVendedor ? ' reports-table-comisiones-equipo' : ' reports-table-comisiones'}`}>
      <div className="table-head">
        {showVendedor && <span>Vendedor</span>}
        <span>Origen</span><span>Documento</span><span>Fecha</span><span>Base</span><span>%</span><span>Comisión</span><span>Estado</span>
      </div>
      {rows.map((row) => <article key={row.id} className={row.estado === 'POTENCIAL' ? 'comision-potencial' : ''}>
        {showVendedor && <span>{row.vendedorEmail}</span>}
        <span>{row.origen === 'PEDIDO' ? 'Pedido' : 'Venta directa'}</span>
        <span>{row.documentoId}</span><span>{fecha(row.fecha)}</span><span>{bs(row.baseComisionableCents)}</span>
        <span>{pct(row.porcentajeBp)}</span><span>{bs(row.montoCents)}</span><span>{row.estado}</span>
      </article>)}
    </div>
  </>
}

function EquipoTotales({ rows }: { rows: ComisionDevengoRow[] }) {
  const porVendedor = new Map<string, { documentos: number; base: number; comision: number }>()
  for (const row of rows) {
    const actual = porVendedor.get(row.vendedorEmail) ?? { documentos: 0, base: 0, comision: 0 }
    actual.documentos += 1; actual.base += row.baseComisionableCents; actual.comision += row.montoCents
    porVendedor.set(row.vendedorEmail, actual)
  }
  const entries = [...porVendedor.entries()].sort((a, b) => b[1].comision - a[1].comision)
  return <div className="feature-table reports-table">
    <div className="table-head"><span>Vendedor</span><span>Documentos</span><span>Base comisionable</span><span>Comisión</span></div>
    {entries.map(([email, t]) => <article key={email}><span>{email}</span><span>{t.documentos}</span><span>{bs(t.base)}</span><span>{bs(t.comision)}</span></article>)}
  </div>
}

const emptyReglaForm: ComisionReglaInput = { tipo: 'MARCA', patron: '', accion: 'INCLUIR', porcentajeBp: 100, prioridad: 100, activo: true, nota: null, creadoPor: null }

function ReglasTab({ notify }: { notify: (message: string) => void }) {
  const [reglas, setReglas] = useState<ComisionRegla[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [form, setForm] = useState<ComisionReglaInput | null>(null)
  const [dates, setDates] = useState<ReportDateRange>({ from: sumarDiasIso(hoyLocal(), -30), to: hoyLocal() })
  const [huerfanos, setHuerfanos] = useState<ComisionProductoHuerfano[]>([])
  const [huerfanosStatus, setHuerfanosStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const [editingId, setEditingId] = useState<string | null>(null)

  const load = () => { setStatus('loading'); void comisionesService.listReglas().then((r) => { setReglas(r); setStatus('ready') }).catch(() => setStatus('error')) }
  useEffect(() => { void Promise.resolve().then(load) }, [])
  useEffect(() => {
    void Promise.resolve().then(() => setHuerfanosStatus('loading'))
    void comisionesService.getProductosHuerfanos(dates).then((r) => { setHuerfanos(r); setHuerfanosStatus('ready') }).catch(() => setHuerfanosStatus('error'))
  }, [dates])

  const save = async () => {
    if (!form || !form.patron.trim()) return
    try {
      await (editingId ? comisionesService.updateRegla(editingId, form) : comisionesService.createRegla(form))
      notify(editingId ? 'Regla actualizada' : 'Regla creada')
      setForm(null); setEditingId(null); load()
    } catch { notify('No se pudo guardar la regla') }
  }
  const editRegla = (r: ComisionRegla) => { setEditingId(r.id); setForm({ tipo: r.tipo, patron: r.patron, accion: r.accion, porcentajeBp: r.porcentajeBp, prioridad: r.prioridad, activo: r.activo, nota: r.nota, creadoPor: r.creadoPor }) }
  const removeRegla = async (id: string) => { if (!confirm('¿Eliminar esta regla?')) return; try { await comisionesService.deleteRegla(id); notify('Regla eliminada'); load() } catch { notify('No se pudo eliminar') } }

  return <>
    <div className="feature-toolbar">
      <button className="secondary-button" onClick={() => { setEditingId(null); setForm(emptyReglaForm) }}><Plus size={14} /> Nueva regla</button>
    </div>
    {form && <div className="modal-body form-grid">
      <label>Tipo<select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as ComisionReglaInput['tipo'] })}><option value="MARCA">Marca</option><option value="NOMBRE">Nombre</option></select></label>
      <label>Acción<select value={form.accion} onChange={(e) => setForm({ ...form, accion: e.target.value as ComisionReglaInput['accion'] })}><option value="INCLUIR">Incluir</option><option value="EXCLUIR">Excluir</option></select></label>
      <label>Patrón<input value={form.patron} onChange={(e) => setForm({ ...form, patron: e.target.value })} placeholder={form.tipo === 'MARCA' ? 'Ej. ROARI' : 'Ej. clip'} /></label>
      <label>Porcentaje<input type="number" step="0.01" value={form.porcentajeBp / 100} onChange={(e) => setForm({ ...form, porcentajeBp: Math.round(Number(e.target.value) * 100) })} /></label>
      <label>Prioridad<input type="number" value={form.prioridad} onChange={(e) => setForm({ ...form, prioridad: Number(e.target.value) })} /></label>
      <label>Activa<input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} /></label>
      <label className="full">Nota<input value={form.nota ?? ''} onChange={(e) => setForm({ ...form, nota: e.target.value || null })} /></label>
      <div className="modal-actions"><button className="secondary-button" onClick={() => { setForm(null); setEditingId(null) }}>Cancelar</button><button className="primary-button" onClick={save}>Guardar</button></div>
    </div>}
    {status === 'loading' ? <FeatureState type="skeleton" text="Cargando reglas" /> : status === 'error' ? <FeatureState type="error" text="No se pudieron cargar las reglas" /> : <div className="feature-table reports-table">
      <div className="table-head"><span>Tipo</span><span>Patrón</span><span>Acción</span><span>%</span><span>Prioridad</span><span>Activa</span><span></span></div>
      {reglas.map((r) => <article key={r.id}><span>{r.tipo}</span><span>{r.patron}</span><span>{r.accion}</span><span>{pct(r.porcentajeBp)}</span><span>{r.prioridad}</span><span className={`status-chip ${r.activo ? 'ok' : 'problem'}`}>{r.activo ? 'Sí' : 'No'}</span>
        <span><button className="icon-button" onClick={() => editRegla(r)} title="Editar">✎</button><button className="icon-button" onClick={() => void removeRegla(r.id)} title="Eliminar"><Trash2 size={14} /></button></span>
      </article>)}
    </div>}

    <section className="settings-section">
      <header><h2>Productos huérfanos</h2><p>Productos con ventas en el período que no matchean ninguna regla</p></header>
      <div className="feature-toolbar reports-toolbar">
        <label className="reports-date-label">Desde<input type="date" value={dates.from} onChange={(e) => setDates({ ...dates, from: e.target.value })} /></label>
        <label className="reports-date-label">Hasta<input type="date" value={dates.to} onChange={(e) => setDates({ ...dates, to: e.target.value })} /></label>
      </div>
      {huerfanosStatus === 'loading' ? <FeatureState type="skeleton" text="Buscando productos huérfanos" /> : huerfanosStatus === 'error' ? <FeatureState type="error" text="No se pudo calcular" /> : !huerfanos.length ? <FeatureState type="empty" text="Ningún producto vendido en el período quedó sin regla" /> : <div className="feature-table reports-table">
        <div className="table-head"><span>Producto</span><span>Marca</span><span>Monto vendido</span></div>
        {huerfanos.map((h) => <article key={h.productoId}><span>{h.productoNombre}</span><span>{h.marca ?? '—'}</span><span>{bs(h.montoVendidoCents)}</span></article>)}
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
      <select value={seleccion} onChange={(e) => setSeleccion(e.target.value)}>
        <option value="">Agregar vendedor…</option>
        {disponibles.map((p) => <option key={p.id} value={p.id}>{p.nombre} ({p.email})</option>)}
      </select>
      <button className="secondary-button" onClick={() => void agregar()} disabled={!seleccion}><Plus size={14} /> Agregar</button>
    </div>
    <div className="feature-table reports-table">
      <div className="table-head"><span>Nombre</span><span>Email</span><span>Desde</span><span>Activo</span><span></span></div>
      {vendedores.map((v) => <article key={v.perfilId}><span>{v.nombre}</span><span>{v.email}</span><span>{fecha(v.desde)}</span><span className={`status-chip ${v.activo ? 'ok' : 'problem'}`}>{v.activo ? 'Sí' : 'No'}</span>
        <span><button className="secondary-button" onClick={() => void toggle(v.perfilId, !v.activo)}>{v.activo ? 'Dar de baja' : 'Reactivar'}</button></span>
      </article>)}
    </div>
  </>
}

export function ComisionesPage({ notify, vendedorEmail, esGerente }: { notify: (message: string) => void; vendedorEmail: string; esGerente: boolean }) {
  const [tab, setTab] = useState<Tab>('mias')
  const [from, setFrom] = useState(sumarDiasIso(hoyLocal(), -30))
  const [to, setTo] = useState(hoyLocal())
  const [rows, setRows] = useState<ComisionDevengoRow[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const dates: ReportDateRange = useMemo(() => ({ from, to }), [from, to])

  const refresh = () => {
    if (tab !== 'mias' && tab !== 'equipo') return
    setStatus('loading')
    const load = tab === 'mias' ? comisionesService.getMisComisiones({ vendedorEmail, dates }) : comisionesService.getEquipo({ dates })
    void load.then((result) => { setRows(result); setStatus('ready') }).catch(() => setStatus('error'))
  }
  // Fase 1: refetch al montar/cambiar filtros + botón manual, sin suscripción realtime
  // todavía (ver brief) — anotado como deuda: Supabase Realtime sobre comision_devengo
  // filtrado por vendedor_email queda para cuando el volumen lo justifique.
  useEffect(() => { void Promise.resolve().then(refresh) }, [tab, dates, vendedorEmail])

  return <FeatureShell eyebrow="COMERCIAL" title="Comisiones" subtitle="Comisión potencial por vendedor, sobre pedidos y ventas directas ya completados">
    <div className="feature-toolbar">
      <button className={tab === 'mias' ? 'active' : ''} onClick={() => setTab('mias')}>Mis comisiones</button>
      {esGerente && <button className={tab === 'equipo' ? 'active' : ''} onClick={() => setTab('equipo')}>Equipo</button>}
      {esGerente && <button className={tab === 'reglas' ? 'active' : ''} onClick={() => setTab('reglas')}>Reglas</button>}
      {esGerente && <button className={tab === 'vendedores' ? 'active' : ''} onClick={() => setTab('vendedores')}>Vendedores</button>}
    </div>

    {(tab === 'mias' || tab === 'equipo') && <>
      <div className="feature-toolbar reports-toolbar">
        <label className="reports-date-label">Desde<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="reports-date-label">Hasta<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="secondary-button" onClick={refresh}><RefreshCw size={14} /> Refrescar</button>
      </div>
      {status === 'loading' ? <FeatureState type="skeleton" text="Cargando comisiones" /> : status === 'error' ? <FeatureState type="error" text="No se pudieron cargar las comisiones" /> : !rows.length ? <FeatureState type="empty" text="Sin comisiones en el período seleccionado" /> : tab === 'mias' ? <DevengoTable rows={rows} showVendedor={false} /> : <>
        <EquipoTotales rows={rows} />
        <DevengoTable rows={rows} showVendedor />
      </>}
    </>}
    {tab === 'reglas' && esGerente && <ReglasTab notify={notify} />}
    {tab === 'vendedores' && esGerente && <VendedoresTab notify={notify} />}
  </FeatureShell>
}
