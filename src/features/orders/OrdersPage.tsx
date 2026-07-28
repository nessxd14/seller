import { CheckCircle2, HandCoins, PackageCheck, Truck, XCircle, RotateCcw, ArrowUpDown, FileDown } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { OrderView, OrderWorkflowStatus } from '../../application/shared/models'
import { cashService, orderService, sensitiveOperations } from '../../infrastructure/services'
import { formatMoney, money } from '../../domain/common/money'
import { FeatureShell, FeatureState, FeatureToolbar, statusChipClass, statusLabel } from '../shared/FeatureShell'
import { Modal } from '../../components/Modal'
import { DocumentoExportable } from '../../components/DocumentoExportable'
import { featureFlags } from '../../config/featureFlags'
import { useCashSession } from '../../context/CashSessionContext'

type SortKey = 'number' | 'customerName' | 'channel' | 'status' | 'lines' | 'total' | 'createdAt'
type SortDir = 'asc' | 'desc'

const orderTotal = (order: OrderView) => order.lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0)
const channelNames: Record<string, string> = { mayoreo: 'Mayoreo', institucional: 'Institucional', municipal: 'Municipal' }

function SortTh({ label, sortkey, activeKey, onToggle }: { label: string; sortkey: SortKey; activeKey: SortKey; onToggle: (key: SortKey) => void }) {
  return <button className={`sortable-th ${activeKey === sortkey ? 'active' : ''}`} onClick={() => onToggle(sortkey)}>{label}<ArrowUpDown size={11} /></button>
}

export function OrdersPage({ notify, canDispatch = true, readOnly = false }: { notify: (message: string) => void; canDispatch?: boolean; readOnly?: boolean }) {
  const [orders, setOrders] = useState<OrderView[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | OrderWorkflowStatus>('all')
  const [channelFilter, setChannelFilter] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selected, setSelected] = useState<OrderView | null>(null)
  const [deliveryNote, setDeliveryNote] = useState<OrderView | null>(null)
  const [orderDoc, setOrderDoc] = useState<OrderView | null>(null)
  const [advanceOpen, setAdvanceOpen] = useState(false)
  const [advances, setAdvances] = useState<Array<{ id: string; amountCents: number; method: string; note: string; at: string }>>([])
  const [reasonModal, setReasonModal] = useState<{ action: 'cancel' | 'restore'; order: OrderView } | null>(null)
  const { sessionId } = useCashSession()
  const load = () => { setStatus('loading'); return orderService.list().then((items) => { setOrders(items); setStatus('ready') }).catch(() => setStatus('error')) }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount, not a derived-state sync
    void load()
  }, [])
  useEffect(() => { void (selected ? cashService.getAdvancesForOrder(selected.id) : Promise.resolve([])).then(setAdvances) }, [selected])
  const registerAdvance = async (amountCents: number, method: 'cash' | 'qr' | 'transfer') => {
    if (!selected || !sessionId) return
    await cashService.registerAdvance(selected.id, amountCents, method, sessionId)
    setAdvanceOpen(false)
    notify('Anticipo registrado')
    setAdvances(await cashService.getAdvancesForOrder(selected.id))
  }
  const toggleSort = (key: SortKey) => { if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc'); else { setSortKey(key); setSortDir('asc') } }
  const filtered = useMemo(() => {
    const list = orders.filter((order) =>
      (filter === 'all' || order.status === filter) &&
      (channelFilter === 'all' || order.channel === channelFilter) &&
      `${order.number} ${order.customerName}`.toLowerCase().includes(query.toLowerCase())
    )
    const dir = sortDir === 'asc' ? 1 : -1
    const withStats = list.map((order) => ({
      order,
      requested: order.lines.reduce((sum, line) => sum + line.quantity, 0),
      prepared: order.lines.reduce((sum, line) => sum + line.prepared, 0),
      total: orderTotal(order),
    }))
    withStats.sort((a, b) => {
      switch (sortKey) {
        case 'number': return a.order.number.localeCompare(b.order.number) * dir
        case 'customerName': return a.order.customerName.localeCompare(b.order.customerName) * dir
        case 'channel': return a.order.channel.localeCompare(b.order.channel) * dir
        case 'status': return a.order.status.localeCompare(b.order.status) * dir
        case 'lines': return ((a.requested ? a.prepared / a.requested : 0) - (b.requested ? b.prepared / b.requested : 0)) * dir
        case 'total': return (a.total - b.total) * dir
        case 'createdAt': return (new Date(a.order.createdAt).getTime() - new Date(b.order.createdAt).getTime()) * dir
      }
    })
    return withStats
  }, [orders, query, filter, channelFilter, sortKey, sortDir])
  const dispatch = async (order: OrderView) => { if (!canDispatch) { notify('Tu rol no permite despachar pedidos'); return } if (!confirm('¿Registrar un despacho parcial simulado? No modificará inventario.')) return; const result = await sensitiveOperations.execute('dispatch',order.id,()=>orderService.partialDispatch(order.id)); setSelected(result); await load(); notify('Despacho parcial simulado') }
  // TAREA 2 (Ronda 9): anular/restaurar, siempre con motivo obligatorio y confirmación.
  // Decisión confirmada con Ness: solo se anulan pedidos sin líneas despachadas.
  const hasDispatchedLines = (order: OrderView) => order.lines.some((line) => line.prepared > 0)
  const confirmReason = async (motivo: string) => {
    if (readOnly || !reasonModal) { notify('Modo solo lectura'); return }
    const { action, order } = reasonModal
    try {
      const updated = action === 'cancel' ? await orderService.cancel(order.id, motivo) : await orderService.restore(order.id, motivo)
      setReasonModal(null)
      setSelected(updated)
      await load()
      notify(action === 'cancel' ? 'Pedido anulado' : 'Pedido restaurado')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo completar la acción')
    }
  }
  return <FeatureShell eyebrow="OPERACIONES" title="Pedidos" subtitle={featureFlags.supabase ? "Pedidos confirmados desde el POS — despacho y estado se gestionan en el WMS" : "Reserva, preparación y despacho simulado"}>
    <FeatureToolbar query={query} onQuery={setQuery} placeholder="Buscar por pedido o cliente...">
      <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}><option value="all">Todos los estados</option>{['draft','confirmed','awaiting_stock','reserved','preparing','ready','dispatched','delivered','cancelled'].map((value) => <option key={value} value={value}>{statusLabel[value]}</option>)}</select>
      <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)}><option value="all">Todos los canales</option>{Object.entries(channelNames).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
    </FeatureToolbar>
    {status === 'loading' ? <FeatureState type="skeleton" text="Cargando pedidos" /> : status === 'error' ? <FeatureState type="error" text="No se pudieron cargar" /> : !filtered.length ? <FeatureState type={orders.length ? 'no-results' : 'empty'} text="No hay pedidos" /> : <div className="feature-table orders-table sticky-head">
      <div className="table-head"><SortTh label="Nº" sortkey="number" activeKey={sortKey} onToggle={toggleSort} /><SortTh label="Cliente" sortkey="customerName" activeKey={sortKey} onToggle={toggleSort} /><SortTh label="Canal" sortkey="channel" activeKey={sortKey} onToggle={toggleSort} /><SortTh label="Estado" sortkey="status" activeKey={sortKey} onToggle={toggleSort} /><SortTh label="Líneas" sortkey="lines" activeKey={sortKey} onToggle={toggleSort} /><SortTh label="Total" sortkey="total" activeKey={sortKey} onToggle={toggleSort} /><SortTh label="Fecha" sortkey="createdAt" activeKey={sortKey} onToggle={toggleSort} /></div>
      {filtered.map(({ order, requested, prepared, total }) => <article key={order.id} className="clickable-row" onClick={() => setSelected(order)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setSelected(order) }}>
        <strong>{order.number}</strong>
        <span>{order.customerName}</span>
        <span className="channel-chip">{channelNames[order.channel] ?? order.channel}</span>
        <span className={`status-chip ${statusChipClass(order.status)}`}>{statusLabel[order.status]}</span>
        <div><div className="progress"><span style={{ width: `${requested ? prepared / requested * 100 : 0}%` }} /></div><small>{prepared}/{requested}</small></div>
        <strong>{formatMoney(money(total))}</strong>
        <span>{new Date(order.createdAt).toLocaleDateString('es-BO')}</span>
      </article>)}
    </div>}
    {selected && <Modal title={selected.number} subtitle={selected.customerName} onClose={() => setSelected(null)} side wide><div className="modal-body order-detail">
      <div className="panel-top-actions"><button className="secondary-button" onClick={()=>setOrderDoc(selected)}><FileDown /> Pedido A4</button><button className="secondary-button" onClick={()=>setDeliveryNote(selected)}><FileDown /> Nota de entrega A4</button><button className="secondary-button" disabled={featureFlags.supabase && !sessionId} onClick={()=>setAdvanceOpen(true)}><HandCoins /> Registrar anticipo</button></div>
      <div className="order-status-line"><PackageCheck /><div><span>Estado actual</span><strong>{statusLabel[selected.status]}</strong></div></div>
      {selected.lines.filter((line) => !line.isCustomItem).map((line) => <article key={line.id}><header><div><strong>{line.name}</strong><small>{line.sku}{line.sourceLocation ? ` · Origen: ${line.sourceLocation}` : ''}</small></div><span>{line.prepared}/{line.quantity} preparadas</span></header><div className="allocation-bars">{line.allocations.map((allocation) => <div key={allocation.location}><span>{allocation.location}</span><b>{allocation.quantity} uds.</b></div>)}</div></article>)}
      {selected.lines.some((line) => line.isCustomItem) && <><h3>Ítems especiales / a pedido</h3>{selected.lines.filter((line) => line.isCustomItem).map((line) => <article key={line.id}><header><div><strong>{line.name}</strong><small>Personalizado</small></div><span>{line.prepared}/{line.quantity} preparadas</span></header></article>)}</>}
      <h3>Historial</h3><div className="timeline">{selected.events.map((event,index) => <div key={`${event.at}-${index}`}><CheckCircle2 /><span><strong>{event.label}</strong><small>{event.at} · {event.detail}</small></span></div>)}</div>
      {<><h3>Anticipos</h3>{advances.length ? <div className="timeline">{advances.map((advance) => <div key={advance.id}><HandCoins /><span><strong>{formatMoney(money(advance.amountCents))} · {advance.method}</strong><small>{new Date(advance.at).toLocaleString('es-BO')}</small></span></div>)}</div> : <FeatureState type="empty" text="Sin anticipos registrados" />}{featureFlags.supabase && !sessionId && <p className="mock-note">Caja cerrada — abrí la caja para poder registrar un anticipo.</p>}</>}
    </div><footer className="modal-actions"><button className="secondary-button" onClick={()=>setOrderDoc(selected)}>Pedido A4</button><button className="secondary-button" onClick={()=>setDeliveryNote(selected)}>Nota de entrega A4</button>{selected.status === 'cancelled' ? <button className="primary-button" onClick={() => setReasonModal({ action: 'restore', order: selected })}><RotateCcw /> Restaurar</button> : <button className="danger-button" disabled={hasDispatchedLines(selected)} title={hasDispatchedLines(selected) ? 'No se puede anular: tiene líneas despachadas' : undefined} onClick={() => setReasonModal({ action: 'cancel', order: selected })}><XCircle /> Anular pedido</button>}{!featureFlags.supabase && <button className="primary-button" disabled={!['preparing','ready'].includes(selected.status)} onClick={() => dispatch(selected)}><Truck /> Despacho parcial</button>}</footer></Modal>}
    {advanceOpen && selected && <AdvanceModal onClose={()=>setAdvanceOpen(false)} onConfirm={registerAdvance}/>}
    {reasonModal && <ReasonModal action={reasonModal.action} orderNumber={reasonModal.order.number} onClose={()=>setReasonModal(null)} onConfirm={confirmReason}/>}
    {deliveryNote && <DocumentoExportable mode="nota-entrega" doc={{ number: deliveryNote.number, customerName: deliveryNote.customerName, channel: deliveryNote.channel, lines: deliveryNote.lines }} onClose={()=>setDeliveryNote(null)} />}
    {orderDoc && <DocumentoExportable mode="pedido" doc={{ number: orderDoc.number, customerName: orderDoc.customerName, channel: orderDoc.channel, lines: orderDoc.lines }} onClose={()=>setOrderDoc(null)} />}
  </FeatureShell>
}

// TAREA 2 (Ronda 9): motivo obligatorio + confirmación explícita antes de anular o
// restaurar — la bitácora sin motivo responde quién y cuándo, pero no por qué.
function ReasonModal({ action, orderNumber, onClose, onConfirm }: { action: 'cancel' | 'restore'; orderNumber: string; onClose: () => void; onConfirm: (motivo: string) => void | Promise<void> }) {
  const [motivo, setMotivo] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const title = action === 'cancel' ? 'Anular pedido' : 'Restaurar pedido'
  const valid = motivo.trim().length > 0 && confirmed
  const submit = async () => { setSaving(true); try { await onConfirm(motivo.trim()) } finally { setSaving(false) } }
  return <Modal title={title} subtitle={orderNumber} onClose={onClose}><div className="modal-body form-grid">
    <label className="full">Motivo<textarea rows={3} autoFocus placeholder={action === 'cancel' ? 'Ej. cliente canceló el pedido' : 'Ej. anulación por error, se repone'} value={motivo} onChange={(e)=>setMotivo(e.target.value)}/></label>
    <label className="full custom-modal-add-another"><input type="checkbox" checked={confirmed} onChange={(e)=>setConfirmed(e.target.checked)}/> {action === 'cancel' ? `Confirmo que quiero anular ${orderNumber}` : `Confirmo que quiero restaurar ${orderNumber}`}</label>
  </div><footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className={action === 'cancel' ? 'danger-button' : 'primary-button'} disabled={!valid || saving} onClick={()=>void submit()}>{title}</button></footer></Modal>
}

function AdvanceModal({onClose,onConfirm}:{onClose:()=>void;onConfirm:(amountCents:number,method:'cash'|'qr'|'transfer')=>void}) {
  const [amount,setAmount]=useState(0)
  const [method,setMethod]=useState<'cash'|'qr'|'transfer'>('cash')
  const valid = amount > 0
  return <Modal title="Registrar anticipo" onClose={onClose}><div className="modal-body form-grid">
    <label className="full">Monto (Bs)<input autoFocus type="number" min="0" step="0.01" value={amount/100 || ''} onChange={(e)=>setAmount(Math.max(0,Math.round(Number(e.target.value)*100)))}/></label>
    <label className="full">Método<select value={method} onChange={(e)=>setMethod(e.target.value as 'cash'|'qr'|'transfer')}><option value="cash">Efectivo</option><option value="qr">QR</option><option value="transfer">Transferencia</option></select></label>
  </div><footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!valid} onClick={()=>onConfirm(amount,method)}>Confirmar</button></footer></Modal>
}
