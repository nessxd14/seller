import { CheckCircle2, ChevronLeft, ChevronRight, HandCoins, PackageCheck, Pencil, Trash2, Truck, XCircle, RotateCcw, ArrowUpDown, FileDown } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { OrderView, OrderWorkflowStatus } from '../../application/shared/models'
import { authSessionProvider, cashService, orderService, sensitiveOperations } from '../../infrastructure/services'
import { formatMoney, money } from '../../domain/common/money'
import { FeatureShell, FeatureState, FeatureToolbar, statusChipClass, statusLabel } from '../shared/FeatureShell'
import { Modal } from '../../components/Modal'
import { NumberField } from '../../components/NumberField'
import { DocumentoExportable } from '../../components/DocumentoExportable'
import { featureFlags } from '../../config/featureFlags'
import { useCashSession } from '../../context/CashSessionContext'
import { contarVersionesPedidos, eliminarPedido, listVersionesPedido, puedeEliminarsePedido, type PedidoVersion, type PuedeEliminarsePedido } from '../../infrastructure/supabase/OrderAdmin.supabase'
import { diffVersionLines } from '../../domain/orders/versionDiff'
import { decidirEliminacionPedido } from '../../domain/orders/deletionDecision'

type SortKey = 'number' | 'customerName' | 'channel' | 'status' | 'lines' | 'total' | 'createdAt'
type SortDir = 'asc' | 'desc'

// El backend ya calculó pedido.total (subtotal con descuentos de línea, menos
// descuento_general). Se usa tal cual. El cálculo de abajo es solo el fallback
// para modo mock y pedidos sin precios, y ahí sí aplica discountBasisPoints —
// ignorarlo era el bug original.
const orderTotal = (order: OrderView) =>
  order.totalCents ?? order.lines.reduce(
    (sum, line) => sum + Math.round(line.unitPriceCents * line.quantity * (10_000 - line.discountBasisPoints) / 10_000),
    0
  )
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
  // Brief S11 Bloque B: conteo de versiones por pedido (para resaltar filas editadas en
  // la grilla), versiones del pedido seleccionado (navegador), y la versión que se está
  // mirando — null = la vigente.
  const [versionCounts, setVersionCounts] = useState<Record<string, number>>({})
  const [versions, setVersions] = useState<PedidoVersion[]>([])
  const [viewingVersionIndex, setViewingVersionIndex] = useState<number | null>(null)
  const [deleteCheck, setDeleteCheck] = useState<PuedeEliminarsePedido | null>(null)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const { sessionId } = useCashSession()
  const load = () => { setStatus('loading'); return orderService.list().then((items) => { setOrders(items); setStatus('ready') }).catch(() => setStatus('error')) }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount, not a derived-state sync
    void load()
  }, [])
  useEffect(() => { void (selected ? cashService.getAdvancesForOrder(selected.id) : Promise.resolve([])).then(setAdvances) }, [selected])
  useEffect(() => {
    if (!featureFlags.supabase || !orders.length) return
    const ids = orders.map((o) => Number(o.id)).filter(Number.isFinite)
    void contarVersionesPedidos(ids).then((counts) => setVersionCounts(Object.fromEntries(Array.from(counts.entries()).map(([id, n]) => [String(id), n]))))
  }, [orders])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the version browser immediately when the selected order changes, before the new fetch resolves
    setViewingVersionIndex(null)
    setVersions([])
    if (!selected || !featureFlags.supabase) return
    const id = Number(selected.id)
    if (!Number.isFinite(id)) return
    let cancelled = false
    void listVersionesPedido(id).then((v) => { if (!cancelled) setVersions(v) })
    return () => { cancelled = true }
  }, [selected])
  const viewingIndex = viewingVersionIndex ?? (versions.length ? versions.length - 1 : null)
  const viewingCurrent = viewingVersionIndex === null
  const viewedVersion = viewingIndex !== null ? versions[viewingIndex] : null
  const previousVersion = viewingIndex !== null && viewingIndex > 0 ? versions[viewingIndex - 1] : undefined
  const versionDiff = viewedVersion ? diffVersionLines(previousVersion?.lineas, viewedVersion.lineas) : null
  const removedInViewedVersion = versionDiff ? Array.from(versionDiff.values()).filter((d) => d.kind === 'removed') : []
  const openDeleteCheck = async (order: OrderView) => {
    const numId = Number(order.id)
    if (!Number.isFinite(numId)) return
    setDeleteModalOpen(true)
    setDeleteCheck(null)
    const check = await puedeEliminarsePedido(numId)
    setDeleteCheck(check)
  }
  const confirmDelete = async (motivo: string) => {
    if (!selected) return
    const actorSession = await authSessionProvider.getSession()
    const actor = actorSession?.user.email ?? actorSession?.user.name ?? 'pos'
    try {
      await eliminarPedido(Number(selected.id), motivo, actor)
      setDeleteModalOpen(false)
      setSelected(null)
      await load()
      notify(`Pedido ${selected.number} eliminado`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo eliminar el pedido')
    }
  }
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
      {filtered.map(({ order, requested, prepared, total }) => {
        // Nota del usuario (no es parte del brief original): resaltar pedidos anulados
        // (opacos, con X) y editados — más de una versión guardada — (amarillo, con lápiz)
        // para que salten a la vista en la grilla sin tener que abrir cada uno.
        const deleted = order.status === 'cancelled'
        const edited = !deleted && (versionCounts[order.id] ?? 0) > 1
        return <article key={order.id} className={`clickable-row ${deleted ? 'order-row-deleted' : edited ? 'order-row-edited' : ''}`} onClick={() => setSelected(order)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setSelected(order) }}>
          {deleted && <span className="order-row-flag order-row-flag-deleted" title="Anulado"><XCircle size={12} /></span>}
          {edited && <span className="order-row-flag order-row-flag-edited" title="Editado"><Pencil size={12} /></span>}
          <strong className="doc-number">{order.number}</strong>
          <span>{order.customerName}</span>
          <span className="channel-chip">{channelNames[order.channel] ?? order.channel}</span>
          <span className={`status-chip ${statusChipClass(order.status)}`}>{statusLabel[order.status]}</span>
          <div><div className="progress"><span style={{ width: `${requested ? prepared / requested * 100 : 0}%` }} /></div><small>{prepared}/{requested}</small></div>
          <strong>{formatMoney(money(total))}</strong>
          <span>{new Date(order.createdAt).toLocaleDateString('es-BO')}</span>
        </article>
      })}
    </div>}
    {selected && <Modal title={selected.number} subtitle={selected.customerName} onClose={() => setSelected(null)}><div className="modal-body order-detail">
      <div className="panel-top-actions"><button className="secondary-button" onClick={()=>setOrderDoc(selected)}><FileDown /> Pedido A4</button><button className="secondary-button" onClick={()=>setDeliveryNote(selected)}><FileDown /> Nota de entrega A4</button><button className="secondary-button" disabled={featureFlags.supabase && !sessionId} onClick={()=>setAdvanceOpen(true)}><HandCoins /> Registrar anticipo</button></div>
      <div className="order-status-line"><PackageCheck /><div><span>Estado actual</span><strong>{statusLabel[selected.status]}</strong></div></div>
      {/* Brief S11 Bloque B2: navegador de versiones — solo aparece si hay más de una.
          "Restaurar" queda deliberadamente sin implementar: ver una versión vieja es
          seguro, volver a ella no (¿qué pasa con lo ya despachado parcialmente?). */}
      {versions.length > 1 && viewingIndex !== null && (
        <div className="version-nav">
          <button disabled={viewingIndex <= 0} onClick={() => setViewingVersionIndex(Math.max(0, viewingIndex - 1))} aria-label="Versión anterior"><ChevronLeft /></button>
          <span>Versión {viewingIndex + 1} de {versions.length}</span>
          <button disabled={viewingIndex >= versions.length - 1} onClick={() => setViewingVersionIndex(Math.min(versions.length - 1, viewingIndex + 1))} aria-label="Versión siguiente"><ChevronRight /></button>
          {viewedVersion && <small>{viewedVersion.usuario ?? 'usuario desconocido'} · {new Date(viewedVersion.creadoEn).toLocaleString('es-BO')}{viewedVersion.motivo ? ` · "${viewedVersion.motivo}"` : ''}</small>}
        </div>
      )}
      {!viewingCurrent && (
        <p className="version-readonly-banner">Estás viendo una versión anterior — no es la vigente, solo lectura. <button type="button" onClick={() => setViewingVersionIndex(null)}>Volver a la vigente</button></p>
      )}
      {viewingCurrent ? <>
        {selected.lines.filter((line) => !line.isCustomItem).map((line) => <article key={line.id}><header><div><strong>{line.name}</strong><small>{line.sku}{line.sourceLocation ? ` · Origen: ${line.sourceLocation}` : ''}</small></div><span>{line.prepared}/{line.quantity} preparadas</span></header><div className="allocation-bars">{line.allocations.map((allocation) => <div key={allocation.location}><span>{allocation.location}</span><b>{allocation.quantity} uds.</b></div>)}</div></article>)}
        {selected.lines.some((line) => line.isCustomItem) && <><h3>Ítems especiales / a pedido</h3>{selected.lines.filter((line) => line.isCustomItem).map((line) => <article key={line.id}><header><div><strong>{line.name}</strong><small>Personalizado</small></div><span>{line.prepared}/{line.quantity} preparadas</span></header></article>)}</>}
      </> : viewedVersion && (
        <div className="version-lines">
          {viewedVersion.lineas.map((linea) => {
            const d = versionDiff?.get(linea.lineaId)
            const nombre = linea.esPersonalizado ? (linea.descripcion ?? 'Ítem personalizado') : (linea.descripcion || linea.productoNombre || 'Producto')
            const cambioTexto = d?.kind === 'changed' ? [d.cantidadCambio && 'cantidad', d.precioCambio && 'precio'].filter(Boolean).join(' y ') : ''
            return <article key={linea.lineaId} className={`version-line version-line-${d?.kind ?? 'unchanged'}`}>
              <header><div><strong>{nombre}</strong>{linea.sku && <small>{linea.sku}</small>}</div>
                {d?.kind === 'added' && <span className="version-line-badge version-line-badge-added">Agregada</span>}
                {d?.kind === 'changed' && <span className="version-line-badge version-line-badge-changed">{cambioTexto} distinto</span>}
              </header>
              <span>{linea.cantidadPresentacion ?? linea.cantidadBase} · {formatMoney(money(Math.round(linea.precioUnitario * 100)))}</span>
            </article>
          })}
          {removedInViewedVersion.map((d) => {
            const prevLinea = previousVersion?.lineas.find((l) => l.lineaId === d.lineaId)
            if (!prevLinea) return null
            const nombre = prevLinea.esPersonalizado ? (prevLinea.descripcion ?? 'Ítem personalizado') : (prevLinea.descripcion || prevLinea.productoNombre || 'Producto')
            return <article key={`removed-${d.lineaId}`} className="version-line version-line-removed"><header><div><strong>{nombre}</strong></div><span className="version-line-badge version-line-badge-removed">Quitada</span></header></article>
          })}
        </div>
      )}
      <h3>Historial</h3><div className="timeline">{selected.events.map((event,index) => <div key={`${event.at}-${index}`}><CheckCircle2 /><span><strong>{event.label}</strong><small>{event.at} · {event.detail}</small></span></div>)}</div>
      {<><h3>Anticipos</h3>{advances.length ? <div className="timeline">{advances.map((advance) => <div key={advance.id}><HandCoins /><span><strong>{formatMoney(money(advance.amountCents))} · {advance.method}</strong><small>{new Date(advance.at).toLocaleString('es-BO')}</small></span></div>)}</div> : <FeatureState type="empty" text="Sin anticipos registrados" />}{featureFlags.supabase && !sessionId && <p className="mock-note">Caja cerrada — abrí la caja para poder registrar un anticipo.</p>}</>}
    </div><footer className="modal-actions"><button className="secondary-button" onClick={()=>setOrderDoc(selected)}>Pedido A4</button><button className="secondary-button" onClick={()=>setDeliveryNote(selected)}>Nota de entrega A4</button>{selected.status === 'cancelled' ? <button className="primary-button" onClick={() => setReasonModal({ action: 'restore', order: selected })}><RotateCcw /> Restaurar</button> : <button className="danger-button" disabled={hasDispatchedLines(selected)} title={hasDispatchedLines(selected) ? 'No se puede anular: tiene líneas despachadas' : undefined} onClick={() => setReasonModal({ action: 'cancel', order: selected })}><XCircle /> Anular pedido</button>}{!featureFlags.supabase && <button className="primary-button" disabled={!['preparing','ready'].includes(selected.status)} onClick={() => dispatch(selected)}><Truck /> Despacho parcial</button>}{featureFlags.supabase && <button className="danger-button" onClick={() => void openDeleteCheck(selected)}><Trash2 /> Eliminar pedido</button>}</footer></Modal>}
    {advanceOpen && selected && <AdvanceModal onClose={()=>setAdvanceOpen(false)} onConfirm={registerAdvance}/>}
    {reasonModal && <ReasonModal action={reasonModal.action} orderNumber={reasonModal.order.number} onClose={()=>setReasonModal(null)} onConfirm={confirmReason}/>}
    {deliveryNote && <DocumentoExportable mode="nota-entrega" doc={{ number: deliveryNote.number, customerName: deliveryNote.customerName, channel: deliveryNote.channel, lines: deliveryNote.lines, generalDiscountCents: deliveryNote.generalDiscountCents }} onClose={()=>setDeliveryNote(null)} />}
    {orderDoc && <DocumentoExportable mode="pedido" doc={{ number: orderDoc.number, customerName: orderDoc.customerName, channel: orderDoc.channel, lines: orderDoc.lines, generalDiscountCents: orderDoc.generalDiscountCents }} onClose={()=>setOrderDoc(null)} />}
    {deleteModalOpen && selected && <DeletePedidoModal orderNumber={selected.number} check={deleteCheck} onClose={() => setDeleteModalOpen(false)} onConfirm={confirmDelete} />}
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
    <label className="full">Monto (Bs)<NumberField autoFocus min={0} step={0.01} value={amount/100} onCommit={(bs)=>setAmount(Math.round(bs*100))}/></label>
    <label className="full">Método<select value={method} onChange={(e)=>setMethod(e.target.value as 'cash'|'qr'|'transfer')}><option value="cash">Efectivo</option><option value="qr">QR</option><option value="transfer">Transferencia</option></select></label>
  </div><footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!valid} onClick={()=>onConfirm(amount,method)}>Confirmar</button></footer></Modal>
}

// Brief S11 Bloque B3: consultar puede_eliminarse_pedido PRIMERO y mostrar el resultado
// antes de pedir confirmación — si no se puede borrar, ni se ofrece la opción (un botón
// que siempre falla es peor que no tenerlo). check === null mientras se está consultando.
function DeletePedidoModal({ orderNumber, check, onClose, onConfirm }: { orderNumber: string; check: PuedeEliminarsePedido | null; onClose: () => void; onConfirm: (motivo: string) => void | Promise<void> }) {
  const [motivo, setMotivo] = useState('')
  const [saving, setSaving] = useState(false)
  if (!check) return <Modal title="Eliminar pedido" subtitle={orderNumber} onClose={onClose}><div className="modal-body"><FeatureState type="loading" text="Consultando si se puede eliminar" /></div></Modal>
  // domain/orders/deletionDecision.ts: mismo mapeo jsonb -> decisión de UI que se testea
  // sin red — acá solo se renderiza el resultado.
  const decision = decidirEliminacionPedido(check)
  if (decision.kind === 'blocked') {
    return <Modal title="No se puede eliminar" subtitle={orderNumber} onClose={onClose}>
      <div className="modal-body"><p>{decision.reason}</p></div>
      <footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cerrar</button></footer>
    </Modal>
  }
  const valid = motivo.trim().length > 0
  const submit = async () => { setSaving(true); try { await onConfirm(motivo.trim()) } finally { setSaving(false) } }
  return <Modal title="Eliminar pedido" subtitle={orderNumber} onClose={onClose}>
    <div className="modal-body form-grid">
      <p className="full">Se va a eliminar el pedido {orderNumber} ({check.lineas} línea{check.lineas === 1 ? '' : 's'}, sin despachos). Esta acción no se puede deshacer.</p>
      <label className="full">Motivo<textarea rows={3} autoFocus placeholder="Ej. pedido duplicado por error" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></label>
    </div>
    <footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="danger-button" disabled={!valid || saving} onClick={() => void submit()}>{saving ? 'Eliminando...' : 'Eliminar pedido'}</button></footer>
  </Modal>
}
