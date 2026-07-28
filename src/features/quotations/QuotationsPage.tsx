import { AlertTriangle, ArrowUpDown, Copy, Eye, Plus, ShoppingCart } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { QuoteDraft, QuoteWorkflowStatus } from '../../application/shared/models'
import { orderService, quoteService, sensitiveOperations } from '../../infrastructure/services'
import { formatMoney, money } from '../../domain/common/money'
import { FeatureShell, FeatureState, FeatureToolbar, statusChipClass, statusLabel } from '../shared/FeatureShell'
import { DraftOrderEditor } from './DraftOrderEditor'
import { DocumentoExportable } from '../../components/DocumentoExportable'
import { featureFlags } from '../../config/featureFlags'

type SortKey = 'number' | 'customerName' | 'status' | 'validUntil' | 'total' | 'createdAt'
type SortDir = 'asc' | 'desc'

const total = (quote: QuoteDraft) => quote.lines.reduce((sum, line) => sum + Math.round(line.unitPriceCents * line.quantity * (10_000 - line.discountBasisPoints) / 10_000), 0) - quote.generalDiscountCents

const DAY_MS = 86_400_000
// Days until validUntil is reached; negative once past. Used to flag near/past expiry.
const daysUntil = (validUntil: string) => Math.ceil((new Date(validUntil).getTime() - Date.now()) / DAY_MS)

function SortTh({ label, sortkey, activeKey, onToggle }: { label: string; sortkey: SortKey; activeKey: SortKey; onToggle: (key: SortKey) => void }) {
  return <button className={`sortable-th ${activeKey === sortkey ? 'active' : ''}`} onClick={() => onToggle(sortkey)}>{label}<ArrowUpDown size={11} /></button>
}

export function QuotationsPage({ notify, onOrderCreated, readOnly = false, initialDraft = null, onInitialDraftConsumed }: { notify: (message: string) => void; onOrderCreated: () => void; readOnly?: boolean; initialDraft?: QuoteDraft | null; onInitialDraftConsumed?: () => void }) {
  const [quotes, setQuotes] = useState<QuoteDraft[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | QuoteWorkflowStatus>('all')
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [editing, setEditing] = useState<QuoteDraft | null>(null)
  // Ronda 5 — TAREA 1: tracks whether `editing` came from an existing row in this table
  // (row-click "Editar"/"Ver") vs a brand-new draft (create(), or a cart handoff via
  // initialDraft) — this, not `editing.id`, is what DraftOrderEditor uses to decide
  // between offering "Convertir a pedido" (existing cotización) or "Crear pedido"
  // (nothing to convert yet). See DraftOrderEditor's isExistingQuote prop comment.
  const [editingIsExisting, setEditingIsExisting] = useState(false)
  const [preview, setPreview] = useState<QuoteDraft | null>(null)
  const load = () => quoteService.list().then((items) => { setQuotes(items); setStatus('ready') }).catch(() => setStatus('error'))
  useEffect(() => { void load() }, [])
  // Opens a cart-panel-originated draft prefilled into the editor, then immediately
  // clears the parent's pending state so navigating away and back doesn't reopen it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs an external draft (from CartPanel) into local editor state, then immediately notifies the parent to clear it
    if (initialDraft) { setEditing(initialDraft); setEditingIsExisting(false); onInitialDraftConsumed?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDraft])
  const toggleSort = (key: SortKey) => { if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc'); else { setSortKey(key); setSortDir('asc') } }
  const filtered = useMemo(() => {
    const list = quotes.filter((quote) => (filter === 'all' || quote.status === filter) && `${quote.number} ${quote.customerName} ${quote.status}`.toLowerCase().includes(query.toLowerCase()))
    const dir = sortDir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case 'number': return a.number.localeCompare(b.number) * dir
        case 'customerName': return a.customerName.localeCompare(b.customerName) * dir
        case 'status': return a.status.localeCompare(b.status) * dir
        case 'validUntil': return a.validUntil.localeCompare(b.validUntil) * dir
        case 'total': return (total(a) - total(b)) * dir
        case 'createdAt': return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir
      }
    })
  }, [quotes, query, filter, sortKey, sortDir])
  // Supabase adapters use an empty id as the "not yet persisted" sentinel and mint
  // the real numeric id from crear_cotizacion's return value; the mock repository
  // still needs a client-generated id up front (it has no server round trip).
  const create = () => { if(readOnly){notify('Modo solo lectura');return} setEditingIsExisting(false); setEditing({ id: featureFlags.supabase ? '' : crypto.randomUUID(), number: '', customerId: '', customerName: '', channel: 'mayoreo', status: 'draft', validUntil: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10), terms: 'Contado', notes: '', generalDiscountCents: 0, createdAt: new Date().toISOString(), lines: [] }) }
  const save = async (quote: QuoteDraft) => { if(readOnly){notify('Modo solo lectura');return} await quoteService.save(quote); setEditing(null); await load(); notify('Cotización guardada') }
  const duplicate = async (id: string) => { if(readOnly){notify('Modo solo lectura');return} await quoteService.duplicate(id); await load(); notify('Cotización duplicada') }
  const createOrderDirect = async (quote: QuoteDraft) => {
    if(readOnly){notify('Modo solo lectura');return}
    await orderService.save({ id: featureFlags.supabase ? '' : crypto.randomUUID(), number: '', customerId: quote.customerId, customerName: quote.customerName, channel: quote.channel, status: 'draft', createdAt: new Date().toISOString(), lines: quote.lines.map((line) => ({ ...line, prepared: 0, allocations: [] })), events: [] })
    setEditing(null)
    onOrderCreated()
    notify('Pedido creado')
  }
  // In mock mode, converting a quote is a two-step client flow (mark the quote
  // converted, then persist a new order snapshot). Against Supabase, the
  // convertir_cotizacion_a_pedido RPC does both atomically, so we branch here —
  // this is the "minimal adjustment" to the calling convention mentioned in the
  // adapter design: the Supabase orderService.save() path is triggered by passing
  // `sourceQuoteId`, and no separate quoteService.markConverted() call is made.
  const convert = async (quote: QuoteDraft) => {
    if(readOnly){notify('Modo solo lectura');return}
    if (!confirm(`¿Convertir ${quote.number} en pedido?`)) return
    if (featureFlags.supabase) {
      await sensitiveOperations.execute('convert_quote', quote.id, () => orderService.save({ id: '', number: '', customerName: quote.customerName, channel: quote.channel, status: 'draft', createdAt: new Date().toISOString(), sourceQuoteId: quote.id, lines: [], events: [] }))
    } else {
      const snapshot = await sensitiveOperations.execute('convert_quote',quote.id,()=>quoteService.markConverted(quote.id, crypto.randomUUID()))
      await orderService.save({ id: snapshot.id, number: snapshot.number, customerName: snapshot.customer.name, channel: quote.channel, status: 'draft', createdAt: snapshot.createdAt, sourceQuoteId: quote.id, lines: snapshot.items.map((line) => ({ id: line.id, productId: line.product.productId, name: line.product.name, sku: line.product.sku, quantity: line.quantity, unitPriceCents: line.appliedPrice.cents, discountBasisPoints: line.discountBasisPoints, prepared: 0, allocations: [] })), events: [{ at: new Date().toLocaleString('es-BO'), label: 'Pedido creado desde cotización', detail: `Snapshots conservados desde ${quote.number}` }] })
    }
    setEditing(null)
    await load()
    onOrderCreated()
    notify('Pedido creado desde cotización')
  }
  return <FeatureShell eyebrow="GESTIÓN COMERCIAL" title="Cotizaciones" subtitle="Propuestas para clientes mayoristas, institucionales y municipales" action={<button className="primary-button" onClick={create}><Plus /> Nueva cotización</button>}>
    <FeatureToolbar query={query} onQuery={setQuery} placeholder="Buscar por número, cliente o estado...">
      <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}><option value="all">Todos los estados</option>{['draft','sent','negotiating','approved','rejected','expired','converted'].map((value) => <option key={value} value={value}>{statusLabel[value]}</option>)}</select>
      <input type="date" aria-label="Filtrar por fecha" />
    </FeatureToolbar>
    {status === 'loading' ? <FeatureState type="skeleton" text="Cargando cotizaciones" /> : status === 'error' ? <FeatureState type="error" text="No se pudieron cargar" /> : !filtered.length ? <FeatureState type={quotes.length ? 'no-results' : 'empty'} text="No hay cotizaciones" /> : <div className="feature-table quotations-table sticky-head">
      <div className="table-head"><SortTh label="Número / fecha" sortkey="number" activeKey={sortKey} onToggle={toggleSort} /><SortTh label="Cliente" sortkey="customerName" activeKey={sortKey} onToggle={toggleSort} /><span>Asunto</span><SortTh label="Estado" sortkey="status" activeKey={sortKey} onToggle={toggleSort} /><SortTh label="Vigencia" sortkey="validUntil" activeKey={sortKey} onToggle={toggleSort} /><SortTh label="Total" sortkey="total" activeKey={sortKey} onToggle={toggleSort} /><span>Acciones</span></div>
      {filtered.map((quote) => {
        const days = daysUntil(quote.validUntil)
        const nearExpiry = days <= 7 && !['expired', 'rejected', 'converted'].includes(quote.status)
        return <article key={quote.id}>
          <div><strong>{quote.number}</strong><small>{new Date(quote.createdAt).toLocaleDateString('es-BO')}</small></div>
          <div><strong>{quote.customerName}</strong><small className="channel-chip">{quote.channel}</small></div>
          <span>{quote.asunto || '—'}</span>
          <span className={`status-chip ${statusChipClass(quote.status)}`}>{statusLabel[quote.status]}</span>
          <span>{nearExpiry ? <span className="vigencia-warning"><AlertTriangle />{days < 0 ? 'Vencida' : `${quote.validUntil} (${days} d)`}</span> : quote.validUntil}</span>
          <strong>{formatMoney(money(Math.max(0,total(quote))))}</strong>
          <div className="row-actions"><button title="Vista previa / exportar" onClick={() => setPreview(quote)}><Eye /></button><button title="Duplicar" onClick={() => duplicate(quote.id)}><Copy /></button><button title="Editar" onClick={() => { setEditingIsExisting(true); setEditing(quote) }}>{quote.status === 'draft' ? 'Editar' : 'Ver'}</button>{quote.status === 'approved' && <button title="Convertir en pedido" onClick={() => convert(quote)}><ShoppingCart /></button>}</div>
        </article>
      })}
    </div>}
    {editing && <DraftOrderEditor quote={editing} isExistingQuote={editingIsExisting} onClose={() => setEditing(null)} onSave={save} onCreateOrder={createOrderDirect} onConvert={editingIsExisting ? convert : undefined} />}
    {preview && <DocumentoExportable mode="cotizacion" doc={{ number: preview.number, customerId: preview.customerId, customerName: preview.customerName, channel: preview.channel, lines: preview.lines, validUntil: preview.validUntil, conditionPago: preview.conditionPago, asunto: preview.asunto, documentDate: preview.documentDate }} onClose={() => setPreview(null)} />}
  </FeatureShell>
}
