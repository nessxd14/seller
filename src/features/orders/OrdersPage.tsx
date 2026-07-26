import { CheckCircle2, HandCoins, PackageCheck, Truck, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { OrderView, OrderWorkflowStatus } from '../../application/shared/models'
import { cashService, orderService, sensitiveOperations } from '../../infrastructure/services'
import { formatMoney, money } from '../../domain/common/money'
import { FeatureShell, FeatureState, FeatureToolbar, statusLabel } from '../shared/FeatureShell'
import { Modal } from '../../components/Modal'
import { featureFlags } from '../../config/featureFlags'
import { useCashSession } from '../../context/CashSessionContext'

export function OrdersPage({ notify, canDispatch = true, readOnly = false }: { notify: (message: string) => void; canDispatch?: boolean; readOnly?: boolean }) {
  const [orders, setOrders] = useState<OrderView[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | OrderWorkflowStatus>('all')
  const [selected, setSelected] = useState<OrderView | null>(null)
  const [advanceOpen, setAdvanceOpen] = useState(false)
  const [advances, setAdvances] = useState<Array<{ id: string; amountCents: number; method: string; note: string; at: string }>>([])
  const { sessionId } = useCashSession()
  const load = () => orderService.list().then(setOrders)
  useEffect(() => { void load() }, [])
  useEffect(() => { void (selected ? cashService.getAdvancesForOrder(selected.id) : Promise.resolve([])).then(setAdvances) }, [selected])
  const registerAdvance = async (amountCents: number, method: 'cash' | 'qr' | 'transfer') => {
    if (!selected || !sessionId) return
    await cashService.registerAdvance(selected.id, amountCents, method, sessionId)
    setAdvanceOpen(false)
    notify('Anticipo registrado')
    setAdvances(await cashService.getAdvancesForOrder(selected.id))
  }
  const filtered = useMemo(() => orders.filter((order) => (filter === 'all' || order.status === filter) && `${order.number} ${order.customerName}`.toLowerCase().includes(query.toLowerCase())), [orders, query, filter])
  const dispatch = async (order: OrderView) => { if (!canDispatch) { notify('Tu rol no permite despachar pedidos'); return } if (!confirm('¿Registrar un despacho parcial simulado? No modificará inventario.')) return; const result = await sensitiveOperations.execute('dispatch',order.id,()=>orderService.partialDispatch(order.id)); setSelected(result); await load(); notify('Despacho parcial simulado') }
  const cancel = async (order: OrderView) => { if (readOnly) { notify('Modo solo lectura'); return } if (!confirm(`¿Cancelar ${order.number}? Esta acción solo afecta datos mock.`)) return; const updated = { ...order, status: 'cancelled' as const, events: [...order.events, { at: new Date().toLocaleString('es-BO'), label: 'Pedido cancelado', detail: 'Sin movimientos reales de inventario' }] }; await orderService.save(updated); setSelected(updated); await load(); notify('Pedido cancelado') }
  return <FeatureShell eyebrow="OPERACIONES" title="Pedidos" subtitle={featureFlags.supabase ? "Pedidos confirmados desde el POS — despacho y estado se gestionan en el WMS" : "Reserva, preparación y despacho simulado"}><FeatureToolbar query={query} onQuery={setQuery} placeholder="Buscar por pedido o cliente..."><select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}><option value="all">Todos los estados</option>{['draft','confirmed','awaiting_stock','reserved','preparing','ready','dispatched','delivered','cancelled'].map((value) => <option key={value} value={value}>{statusLabel[value]}</option>)}</select></FeatureToolbar>{!filtered.length ? <FeatureState type={orders.length ? 'no-results' : 'empty'} text="No hay pedidos" /> : <div className="order-grid">{filtered.map((order) => { const requested = order.lines.reduce((sum,line)=>sum+line.quantity,0); const prepared=order.lines.reduce((sum,line)=>sum+line.prepared,0); return <button key={order.id} className="order-card" onClick={() => setSelected(order)}><header><div><strong>{order.number}</strong><span>{order.customerName}</span></div><i className={`status-chip ${order.status}`}>{statusLabel[order.status]}</i></header><div className="progress"><span style={{width:`${requested ? prepared/requested*100 : 0}%`}} /></div><div><span>{prepared} preparadas</span><span>{requested-prepared} pendientes</span></div><footer><span>{order.channel}</span><strong>{formatMoney(money(order.lines.reduce((sum,line)=>sum+line.unitPriceCents*line.quantity,0)))}</strong></footer></button>})}</div>}{selected && <Modal title={selected.number} subtitle={selected.customerName} onClose={() => setSelected(null)} wide><div className="modal-body order-detail"><div className="order-status-line"><PackageCheck /><div><span>Estado actual</span><strong>{statusLabel[selected.status]}</strong></div></div>{selected.lines.map((line) => <article key={line.id}><header><div><strong>{line.name}</strong><small>{line.sku}</small></div><span>{line.prepared}/{line.quantity} preparadas</span></header><div className="allocation-bars">{line.allocations.map((allocation) => <div key={allocation.location}><span>{allocation.location}</span><b>{allocation.quantity} uds.</b></div>)}</div></article>)}<h3>Historial</h3><div className="timeline">{selected.events.map((event,index) => <div key={`${event.at}-${index}`}><CheckCircle2 /><span><strong>{event.label}</strong><small>{event.at} · {event.detail}</small></span></div>)}</div>{<><h3>Anticipos</h3>{advances.length ? <div className="timeline">{advances.map((advance) => <div key={advance.id}><HandCoins /><span><strong>{formatMoney(money(advance.amountCents))} · {advance.method}</strong><small>{new Date(advance.at).toLocaleString('es-BO')}</small></span></div>)}</div> : <FeatureState type="empty" text="Sin anticipos registrados" />}{featureFlags.supabase && !sessionId && <p className="mock-note">Caja cerrada — abrí la caja para poder registrar un anticipo.</p>}</>}</div><footer className="modal-actions"><button className="secondary-button" onClick={()=>window.print()}>Pedido A4</button><button className="secondary-button" onClick={()=>window.print()}>Nota de entrega A4</button>{<button className="secondary-button" disabled={featureFlags.supabase && !sessionId} onClick={()=>setAdvanceOpen(true)}><HandCoins /> Registrar anticipo</button>}{!featureFlags.supabase && <button className="danger-button" disabled={['delivered','cancelled'].includes(selected.status)} onClick={() => cancel(selected)}><XCircle /> Cancelar</button>}{!featureFlags.supabase && <button className="primary-button" disabled={!['preparing','ready'].includes(selected.status)} onClick={() => dispatch(selected)}><Truck /> Despacho parcial</button>}</footer></Modal>}{advanceOpen && selected && <AdvanceModal onClose={()=>setAdvanceOpen(false)} onConfirm={registerAdvance}/>}</FeatureShell>
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
