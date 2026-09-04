import { AlertTriangle, ArrowUpDown, Copy, Eye, LoaderCircle, Plus, ShoppingCart } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { QuoteDraft, QuoteWorkflowStatus } from '../../application/shared/models'
import { orderService, quoteService, sensitiveOperations } from '../../infrastructure/services'
import { formatMoney, money } from '../../domain/common/money'
import { FeatureShell, FeatureState, FeatureToolbar, condicionPagoLabel, statusChipClass, statusLabel } from '../shared/FeatureShell'
import { DraftOrderEditor } from './DraftOrderEditor'
import { DocumentoExportable } from '../../components/DocumentoExportable'
import { Modal } from '../../components/Modal'
import { featureFlags } from '../../config/featureFlags'
import { hoyLocal, sumarDiasIso } from '../../domain/common/fechas'
import { matchesNumero } from '../../domain/documents/matchesNumero'
import { useRoute } from '../../router/useRoute'
import { navigate } from '../../router/history'
import { cotizacionPath } from '../../router/appRoute'
import { RowLink } from '../../router/RowLink'

type SortKey = 'number' | 'customerName' | 'status' | 'validUntil' | 'total' | 'createdAt'
type SortDir = 'asc' | 'desc'

const total = (quote: QuoteDraft) => quote.lines.reduce((sum, line) => sum + Math.round(line.unitPriceCents * line.quantity * (10_000 - line.discountBasisPoints) / 10_000), 0) - quote.generalDiscountCents

// El total de la lista viene de cotizacion.total (ya calculado y correcto en la base),
// no de sumar `lines` en el cliente: con el tope de 1.000 filas de PostgREST, las
// cotizaciones cuyas líneas caían del lado recortado en list() mostraban Bs 0,00 aunque
// el total real fuera correcto. `total(quote)` queda solo para modo mock (totalCents
// undefined ahí, donde `lines` siempre está completo).
const listTotal = (quote: QuoteDraft) => quote.totalCents ?? total(quote)

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
  // Brief T3 Tarea 3: orden natural "lo último primero" — coincide con el cronológico
  // porque la numeración se asignó por fecha de creación.
  const [sortKey, setSortKey] = useState<SortKey>('number')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [editing, setEditing] = useState<QuoteDraft | null>(null)
  // Ronda 5 — TAREA 1: tracks whether `editing` came from an existing row in this table
  // (row-click "Editar"/"Ver") vs a brand-new draft (create(), or a cart handoff via
  // initialDraft) — this, not `editing.id`, is what DraftOrderEditor uses to decide
  // between offering "Convertir a pedido" (existing cotización) or "Crear pedido"
  // (nothing to convert yet). See DraftOrderEditor's isExistingQuote prop comment.
  const [editingIsExisting, setEditingIsExisting] = useState(false)
  // Brief: abrir /cotizaciones/:id (recarga directa o click en la fila) trae la
  // cotización fresca por su propio id en vez de reusar el objeto de `quotes` — list()
  // ya no trae líneas (tope de 1.000 filas de Supabase), así que ese objeto siempre
  // tendría lines: []. Mientras el fetch está en curso, el modal muestra un esqueleto
  // en vez de quedar cerrado o abrir el editor vacío.
  const [editingLoading, setEditingLoading] = useState(false)
  const [preview, setPreview] = useState<QuoteDraft | null>(null)
  // Brief: list() ya no trae líneas, así que la fila de la tabla siempre tiene
  // lines: [] — la vista previa/impresión necesita traer la cotización fresca por su
  // propio id (nunca sujeto al tope de 1.000 filas de Supabase) antes de mostrarla.
  // previewLoadingId solo deshabilita el botón del ojito de esa fila mientras dura
  // ese único fetch — no hace falta un estado de carga elaborado como en el editor.
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null)
  const openPreview = async (id: string) => {
    setPreviewLoadingId(id)
    try {
      const full = await quoteService.getById(id)
      if (full) setPreview(full)
    } finally {
      setPreviewLoadingId(null)
    }
  }
  const load = () => quoteService.list().then((items) => { setQuotes(items); setStatus('ready') }).catch(() => setStatus('error'))
  useEffect(() => { void load() }, [])
  // Opens a cart-panel-originated draft prefilled into the editor, then immediately
  // clears the parent's pending state so navigating away and back doesn't reopen it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs an external draft (from CartPanel) into local editor state, then immediately notifies the parent to clear it
    if (initialDraft) { setEditing(initialDraft); setEditingIsExisting(false); onInitialDraftConsumed?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDraft])
  // Brief S3 Parte A: /cotizaciones/:id — la lista nunca se desmonta (mismo criterio que
  // Pedidos), así que "Volver" (navigate('/')) conserva el filtro/orden gratis.
  const route = useRoute()
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resincroniza el editor abierto con la URL actual, no un fetch que difiera
    if (route.kind !== 'cotizacion') { setEditing((current) => current && editingIsExisting ? null : current); setEditingLoading(false); return }
    if (!route.id) return
    let cancelled = false
    setEditingIsExisting(true)
    setEditingLoading(true)
    setEditing(null)
    void quoteService.getById(route.id).then((found) => {
      if (cancelled) return
      setEditingLoading(false)
      if (found) setEditing(found)
      else { notify('Cotización no encontrada'); navigate('/') }
    })
    // Si la ruta cambia (o el componente se desmonta) antes de que el fetch resuelva,
    // cortamos el `setEditing`/`setEditingLoading` de esa promesa vieja — si no, el
    // esqueleto de carga podía quedar pegado, o una cotización distinta a la que ya
    // navegamos podía pisar el editor un instante después.
    return () => { cancelled = true; setEditingLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- editingIsExisting se lee pero no debe reprogramar el efecto en cada toggle propio
  }, [route])
  const toggleSort = (key: SortKey) => { if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc'); else { setSortKey(key); setSortDir('asc') } }
  const filtered = useMemo(() => {
    const list = quotes.filter((quote) => (filter === 'all' || quote.status === filter) && (matchesNumero(quote.number, query) || `${quote.customerName} ${quote.status}`.toLowerCase().includes(query.toLowerCase())))
    const dir = sortDir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case 'number': return a.number.localeCompare(b.number) * dir
        case 'customerName': return a.customerName.localeCompare(b.customerName) * dir
        case 'status': return a.status.localeCompare(b.status) * dir
        case 'validUntil': return a.validUntil.localeCompare(b.validUntil) * dir
        case 'total': return (listTotal(a) - listTotal(b)) * dir
        case 'createdAt': return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir
      }
    })
  }, [quotes, query, filter, sortKey, sortDir])
  // Supabase adapters use an empty id as the "not yet persisted" sentinel and mint
  // the real numeric id from crear_cotizacion's return value; the mock repository
  // still needs a client-generated id up front (it has no server round trip).
  const create = () => { if(readOnly){notify('Modo solo lectura');return} setEditingIsExisting(false); setEditing({ id: featureFlags.supabase ? '' : crypto.randomUUID(), number: '', customerId: '', customerName: '', channel: 'mayoreo', status: 'draft', validUntil: sumarDiasIso(hoyLocal(), 15), terms: 'Contado', notes: '', generalDiscountCents: 0, createdAt: new Date().toISOString(), lines: [] }) }
  // Brief S3: cerrar el editor de una cotización EXISTENTE (abierta por URL) también
  // navega a '/' — si no, la URL se queda apuntando a /cotizaciones/:id con el editor ya
  // cerrado, y el próximo re-render (p. ej. tras `load()`) lo reabriría solo.
  const closeEditor = () => { setEditing(null); if (editingIsExisting) navigate('/') }
  const save = async (quote: QuoteDraft) => { if(readOnly){notify('Modo solo lectura');return} await quoteService.save(quote); closeEditor(); await load(); notify('Cotización guardada') }
  const duplicate = async (id: string) => { if(readOnly){notify('Modo solo lectura');return} await quoteService.duplicate(id); await load(); notify('Cotización duplicada') }
  const createOrderDirect = async (quote: QuoteDraft) => {
    if(readOnly){notify('Modo solo lectura');return}
    await orderService.save({
      id: featureFlags.supabase ? '' : crypto.randomUUID(),
      number: '',
      customerId: quote.customerId,
      customerName: quote.customerName,
      channel: quote.channel,
      status: 'draft',
      createdAt: new Date().toISOString(),
      // El editor permite cargar "Descuento general (Bs)" y lo muestra en el
      // footer del total; sin esto el pedido nacía con descuento 0.
      generalDiscountCents: quote.generalDiscountCents,
      solicitanteId: quote.solicitanteId,
      conditionPago: quote.conditionPago,
      medioPago: quote.medioPago,
      lines: quote.lines.map((line) => ({ ...line, prepared: 0, allocations: [] })),
      events: [],
    })
    closeEditor()
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
    // TAREA 3 (Ronda 9): sin cliente no se puede convertir — mismo requisito que guardar.
    if(!quote.customerId){notify('Esta cotización no tiene cliente. Abrila y elegí uno en el buscador antes de convertirla.');return}
    if (!confirm(`¿Convertir ${quote.number} en pedido?`)) return
    if (featureFlags.supabase) {
      await sensitiveOperations.execute('convert_quote', quote.id, () => orderService.save({ id: '', number: '', customerName: quote.customerName, channel: quote.channel, status: 'draft', createdAt: new Date().toISOString(), sourceQuoteId: quote.id, solicitanteId: quote.solicitanteId, lines: [], events: [] }))
    } else {
      const snapshot = await sensitiveOperations.execute('convert_quote',quote.id,()=>quoteService.markConverted(quote.id, crypto.randomUUID()))
      await orderService.save({ id: snapshot.id, number: snapshot.number, customerName: snapshot.customer.name, channel: quote.channel, status: 'draft', createdAt: snapshot.createdAt, sourceQuoteId: quote.id, lines: snapshot.items.map((line) => ({ id: line.id, productId: line.product.productId, name: line.product.name, sku: line.product.sku, quantity: line.quantity, unitPriceCents: line.appliedPrice.cents, discountBasisPoints: line.discountBasisPoints, prepared: 0, allocations: [] })), events: [{ at: new Date().toLocaleString('es-BO'), label: 'Pedido creado desde cotización', detail: `Snapshots conservados desde ${quote.number}` }] })
    }
    closeEditor()
    await load()
    onOrderCreated()
    notify('Pedido creado desde cotización')
  }
  return <FeatureShell eyebrow="GESTIÓN COMERCIAL" title="Cotizaciones" subtitle="Propuestas para clientes mayoristas, institucionales y corporativos" action={<button className="primary-button" onClick={create}><Plus /> Nueva cotización</button>}>
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
          <RowLink href={cotizacionPath(quote.id)} label={`Ver cotización ${quote.number}`} />
          <div><strong className="doc-number-cell">{quote.number}</strong><small>{new Date(quote.createdAt).toLocaleDateString('es-BO')}</small></div>
          <div><strong>{quote.customerName}</strong><small className="channel-chip">{quote.channel}</small>{quote.solicitanteNombre && <small className="channel-chip">Solicitante: {quote.solicitanteNombre}</small>}</div>
          <span>{quote.asunto || '—'}</span>
          <span><span className={`status-chip ${statusChipClass(quote.status)}`}>{statusLabel[quote.status]}</span>{quote.conditionPago && <small className="channel-chip">{condicionPagoLabel[quote.conditionPago]}</small>}</span>
          <span>{nearExpiry ? <span className="vigencia-warning"><AlertTriangle />{days < 0 ? 'Vencida' : `${quote.validUntil} (${days} d)`}</span> : quote.validUntil}</span>
          <strong>{formatMoney(money(Math.max(0,listTotal(quote))))}</strong>
          <div className="row-actions"><button title="Vista previa / exportar" disabled={previewLoadingId === quote.id} onClick={() => void openPreview(quote.id)}>{previewLoadingId === quote.id ? <LoaderCircle className="spin" /> : <Eye />}</button><button title="Duplicar" onClick={() => duplicate(quote.id)}><Copy /></button><button title="Editar" onClick={() => navigate(cotizacionPath(quote.id))}>{quote.status === 'draft' ? 'Editar' : 'Ver'}</button>{quote.status === 'approved' && <button title={quote.customerId ? 'Convertir en pedido' : 'Sin cliente — abrí la cotización y elegí uno'} onClick={() => convert(quote)}><ShoppingCart /></button>}</div>
        </article>
      })}
    </div>}
    {editingLoading && <Modal title="Cargando cotización" onClose={closeEditor}><FeatureState type="skeleton" text="Cargando cotización" /></Modal>}
    {editing && <DraftOrderEditor quote={editing} isExistingQuote={editingIsExisting} onClose={closeEditor} onSave={save} onCreateOrder={createOrderDirect} onConvert={editingIsExisting ? convert : undefined} />}
    {preview && <DocumentoExportable mode="cotizacion" doc={{ number: preview.number, customerId: preview.customerId, customerName: preview.customerName, channel: preview.channel, lines: preview.lines, validUntil: preview.validUntil, conditionPago: preview.conditionPago, medioPago: preview.medioPago, asunto: preview.asunto, documentDate: preview.documentDate, generalDiscountCents: preview.generalDiscountCents, creadoPor: preview.creadoPor }} onClose={() => setPreview(null)} />}
  </FeatureShell>
}
