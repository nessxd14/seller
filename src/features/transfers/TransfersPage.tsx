import { ArrowUpDown, Plus, X, XCircle, PackageCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { TransferEstado, TransferMotivo, TransferRecord } from '../../application/shared/models'
import { transferService, productRepository, listPresentations, authSessionProvider } from '../../infrastructure/services'
import type { Product } from '../../types'
import { FeatureShell, FeatureState, FeatureToolbar } from '../shared/FeatureShell'
import { Modal } from '../../components/Modal'

type SortKey = 'id' | 'motivo' | 'estado' | 'solicitadoEn' | 'solicitadoPor'
type SortDir = 'asc' | 'desc'

const motivoLabel: Record<TransferMotivo, string> = { VENTA_DIRECTA: 'Venta directa', REPOSICION: 'Reposición' }
const estadoLabel: Record<TransferEstado, string> = {
  SOLICITADO: 'Solicitado', EN_TRANSITO: 'En tránsito', RECIBIDO: 'Recibido', RECHAZADO: 'Rechazado', CANCELADO: 'Cancelado',
}
// Local 3-bucket mapping (ok/pending/problem) for the uppercase estado_traslado vocabulary —
// deliberately not folded into FeatureShell's shared statusChipClass sets (those are keyed to
// the lowercase QuoteWorkflowStatus/OrderWorkflowStatus vocabulary and adding uppercase
// transfer-specific keys there would be more confusing than a small local helper here).
const transferChipClass = (estado: TransferEstado): 'ok' | 'pending' | 'problem' =>
  estado === 'RECIBIDO' ? 'ok' : estado === 'RECHAZADO' || estado === 'CANCELADO' ? 'problem' : 'pending'
const fmtQty = (n: number) => n.toLocaleString('es-BO', { maximumFractionDigits: 2 })

function SortTh({ label, sortkey, activeKey, onToggle }: { label: string; sortkey: SortKey; activeKey: SortKey; onToggle: (key: SortKey) => void }) {
  return <button className={`sortable-th ${activeKey === sortkey ? 'active' : ''}`} onClick={() => onToggle(sortkey)}>{label}<ArrowUpDown size={11} /></button>
}

export interface PendingTransferRequest {
  productId: string
  productName: string
  productSku: string
  quantity: number
}

export function TransfersPage({ notify, initialRequest = null, onInitialRequestConsumed }: {
  notify: (message: string) => void
  initialRequest?: PendingTransferRequest | null
  onInitialRequestConsumed?: () => void
}) {
  const [transfers, setTransfers] = useState<TransferRecord[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | TransferEstado>('all')
  const [sortKey, setSortKey] = useState<SortKey>('solicitadoEn')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selected, setSelected] = useState<TransferRecord | null>(null)
  const [creating, setCreating] = useState(false)
  const [actorName, setActorName] = useState('')

  const load = () => { setStatus('loading'); return transferService.list().then((items) => { setTransfers(items); setStatus('ready') }).catch(() => setStatus('error')) }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount, not a derived-state sync
    void load()
  }, [])
  useEffect(() => { void authSessionProvider.getSession().then((session) => session && setActorName(session.user.name)) }, [])

  // Cart -> Traslados handoff (item 1.2): opens the create form pre-filled with the
  // shortfall line, mirroring QuotationsPage's initialDraft/onInitialDraftConsumed pattern.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs an external pending request (from CartPanel) into local UI state, then immediately notifies the parent to clear it
    if (initialRequest) { setCreating(true); onInitialRequestConsumed?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRequest])

  const toggleSort = (key: SortKey) => { if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc'); else { setSortKey(key); setSortDir('asc') } }

  const filtered = useMemo(() => {
    const list = transfers.filter((t) =>
      (filter === 'all' || t.estado === filter) &&
      `${t.referencia ?? ''} ${t.motivo} ${t.solicitadoPor}`.toLowerCase().includes(query.toLowerCase())
    )
    const dir = sortDir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case 'id': return (Number(a.id) - Number(b.id)) * dir
        case 'motivo': return a.motivo.localeCompare(b.motivo) * dir
        case 'estado': return a.estado.localeCompare(b.estado) * dir
        case 'solicitadoPor': return a.solicitadoPor.localeCompare(b.solicitadoPor) * dir
        case 'solicitadoEn': return (new Date(a.solicitadoEn).getTime() - new Date(b.solicitadoEn).getTime()) * dir
      }
    })
  }, [transfers, query, filter, sortKey, sortDir])

  const cancelTransfer = async (transfer: TransferRecord) => {
    if (!confirm(`¿Cancelar la solicitud #${transfer.id}?`)) return
    await transferService.cancel(transfer.id)
    setSelected(null)
    await load()
    notify('Solicitud de traslado cancelada')
  }

  const receiveTransfer = async (transfer: TransferRecord, lines: null | Array<{ lineaId: string; cantidadBase: number }>) => {
    await transferService.receive(transfer.id, lines)
    setSelected(null)
    await load()
    notify('Recepción registrada')
  }

  return <FeatureShell eyebrow="LOGÍSTICA" title="Traslados" subtitle="Solicitudes de traslado Almacén → Tienda" action={<button className="primary-button" onClick={() => setCreating(true)}><Plus /> Nueva solicitud</button>}>
    <FeatureToolbar query={query} onQuery={setQuery} placeholder="Buscar por referencia, motivo o solicitante...">
      <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
        <option value="all">Todos los estados</option>
        {(['SOLICITADO', 'EN_TRANSITO', 'RECIBIDO', 'RECHAZADO', 'CANCELADO'] as const).map((value) => <option key={value} value={value}>{estadoLabel[value]}</option>)}
      </select>
    </FeatureToolbar>
    {status === 'loading' ? <FeatureState type="skeleton" text="Cargando traslados" /> : status === 'error' ? <FeatureState type="error" text="No se pudieron cargar" /> : !filtered.length ? <FeatureState type={transfers.length ? 'no-results' : 'empty'} text="No hay solicitudes de traslado" /> : <div className="feature-table transfers-table sticky-head">
      <div className="table-head"><SortTh label="Nº" sortkey="id" activeKey={sortKey} onToggle={toggleSort} /><SortTh label="Motivo" sortkey="motivo" activeKey={sortKey} onToggle={toggleSort} /><SortTh label="Estado" sortkey="estado" activeKey={sortKey} onToggle={toggleSort} /><SortTh label="Fecha" sortkey="solicitadoEn" activeKey={sortKey} onToggle={toggleSort} /><SortTh label="Solicitado por" sortkey="solicitadoPor" activeKey={sortKey} onToggle={toggleSort} /></div>
      {filtered.map((transfer) => <article key={transfer.id} className="clickable-row" onClick={() => setSelected(transfer)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setSelected(transfer) }}>
        <strong>{transfer.referencia || `#${transfer.id}`}</strong>
        <span>{motivoLabel[transfer.motivo]}</span>
        <span className={`status-chip ${transferChipClass(transfer.estado)}`}>{estadoLabel[transfer.estado]}</span>
        <span>{new Date(transfer.solicitadoEn).toLocaleDateString('es-BO')}</span>
        <span>{transfer.solicitadoPor}</span>
      </article>)}
    </div>}
    {selected && (
      <TransferDetailPanel
        transfer={selected}
        canCancel={selected.estado === 'SOLICITADO' && selected.solicitadoPor === actorName}
        onClose={() => setSelected(null)}
        onCancel={() => void cancelTransfer(selected)}
        onReceive={(lines) => void receiveTransfer(selected, lines)}
      />
    )}
    {creating && (
      <CreateTransferModal
        initialRequest={initialRequest}
        onClose={() => setCreating(false)}
        onCreated={async () => { setCreating(false); await load(); notify('Solicitud de traslado creada') }}
      />
    )}
  </FeatureShell>
}

function TransferDetailPanel({ transfer, canCancel, onClose, onCancel, onReceive }: {
  transfer: TransferRecord
  canCancel: boolean
  onClose: () => void
  onCancel: () => void
  onReceive: (lines: null | Array<{ lineaId: string; cantidadBase: number }>) => void
}) {
  const [receivedByLine, setReceivedByLine] = useState<Record<string, number>>(() =>
    Object.fromEntries(transfer.lines.map((line) => [line.id, line.cantidadDespachada ?? line.cantidadBase])))
  const canReceive = transfer.estado === 'EN_TRANSITO'
  const confirmReceive = () => {
    const changed = transfer.lines.filter((line) => (receivedByLine[line.id] ?? 0) !== (line.cantidadDespachada ?? line.cantidadBase))
    onReceive(changed.length ? changed.map((line) => ({ lineaId: line.id, cantidadBase: receivedByLine[line.id] })) : null)
  }
  return <Modal title={transfer.referencia || `Traslado #${transfer.id}`} subtitle={motivoLabel[transfer.motivo]} onClose={onClose} side wide>
    <div className="modal-body transfer-detail">
      <div className="order-status-line"><PackageCheck /><div><span>Estado actual</span><strong>{estadoLabel[transfer.estado]}</strong></div></div>
      <p><b>Solicitado por:</b> {transfer.solicitadoPor} · {new Date(transfer.solicitadoEn).toLocaleString('es-BO')}</p>
      {transfer.despachadoPor && <p><b>Despachado por:</b> {transfer.despachadoPor} · {transfer.despachadoEn && new Date(transfer.despachadoEn).toLocaleString('es-BO')}</p>}
      {transfer.recibidoPor && <p><b>Recibido por:</b> {transfer.recibidoPor} · {transfer.recibidoEn && new Date(transfer.recibidoEn).toLocaleString('es-BO')}</p>}
      {transfer.nota && <p><b>Nota:</b> {transfer.nota}</p>}
      <h3>Líneas</h3>
      <div className="feature-table transfer-lines-table">
        <div className="table-head"><span>Producto</span><span>Solicitado</span><span>Despachado</span><span>{canReceive ? 'Recibido (editable)' : 'Recibido'}</span></div>
        {transfer.lines.map((line) => {
          const despachada = line.cantidadDespachada ?? line.cantidadBase
          // TAREA 4: receive in the unit it was requested in. `factor` is derived from the
          // line's own requested ratio (cantidadBase = cantidadPresentacion × factor at
          // creation time — see TransferRepository.supabase.ts / crear_solicitud_traslado),
          // never re-fetched. receive() itself is unchanged: it always sends cantidad_base.
          const factor = line.presentacionId != null && line.cantidadPresentacion ? line.cantidadBase / line.cantidadPresentacion : 1
          const receivedBase = receivedByLine[line.id] ?? despachada
          const short = canReceive && receivedBase < despachada
          const receivedInUnit = receivedBase / factor
          const despachadaInUnit = despachada / factor
          const onChangeReceived = (raw: string) => {
            const entered = Number(raw)
            const nextBase = Number.isFinite(entered) ? Math.max(0, Math.min(despachada, entered * factor)) : 0
            setReceivedByLine((prev) => ({ ...prev, [line.id]: nextBase }))
          }
          return <article key={line.id}>
            <span><strong>{line.name}</strong><small>{line.sku}</small></span>
            <span>{line.presentacionNombre ? `${line.cantidadPresentacion} ${line.presentacionNombre}` : line.cantidadBase}</span>
            <span>{line.cantidadDespachada ?? '—'}</span>
            {canReceive ? (
              <div>
                <input type="number" min="0" max={despachadaInUnit} step="any" value={receivedInUnit} onChange={(e) => onChangeReceived(e.target.value)} />
                {factor !== 1 && <small className="line-equivalence">{line.presentacionNombre} = {fmtQty(receivedBase)} u</small>}
                {short && <small className="line-stock-error">La diferencia ({fmtQty(despachada - receivedBase)}) se registrará como faltante en Tienda</small>}
              </div>
            ) : <span>{line.cantidadRecibida ?? '—'}</span>}
          </article>
        })}
      </div>
    </div>
    <footer className="modal-actions">
      {canCancel && <button className="danger-button" onClick={onCancel}><XCircle /> Cancelar solicitud</button>}
      {canReceive && <button className="primary-button" onClick={confirmReceive}><PackageCheck /> Confirmar recepción</button>}
    </footer>
  </Modal>
}

function CreateTransferModal({ initialRequest, onClose, onCreated }: {
  initialRequest?: PendingTransferRequest | null
  onClose: () => void
  onCreated: () => void | Promise<void>
}) {
  const [motivo, setMotivo] = useState<TransferMotivo>(initialRequest ? 'VENTA_DIRECTA' : 'REPOSICION')
  const [referencia, setReferencia] = useState('')
  const [nota, setNota] = useState('')
  const [lines, setLines] = useState<Array<{ productId: string; name: string; sku: string; presentacionId?: number; presentacionNombre?: string; quantity: number; nota?: string }>>(
    initialRequest ? [{ productId: initialRequest.productId, name: initialRequest.productName, sku: initialRequest.productSku, quantity: initialRequest.quantity }] : []
  )
  const [productQuery, setProductQuery] = useState('')
  const [productResults, setProductResults] = useState<Product[]>([])
  const [presentationsByProduct, setPresentationsByProduct] = useState<Record<string, Array<{ id: number; nombre: string; factorUnidadBase: number; esBase: boolean }>>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    const handle = setTimeout(() => {
      if (!productQuery.trim()) { setProductResults([]); return }
      void productRepository.search({ query: productQuery, active: true, page: { page: 1, pageSize: 20 } }).then((page) => { if (!cancelled) setProductResults(page.items) })
    }, 250)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [productQuery])

  const addProduct = (product: Product) => {
    if (lines.some((line) => line.productId === String(product.id))) { setProductQuery(''); setProductResults([]); return }
    setLines((prev) => [...prev, { productId: String(product.id), name: product.nombre, sku: product.sku, quantity: 1 }])
    void listPresentations(product.id).then((list) => setPresentationsByProduct((prev) => ({ ...prev, [String(product.id)]: list })))
    setProductQuery('')
    setProductResults([])
  }

  const updateLine = (productId: string, patch: Partial<{ quantity: number; presentacionId?: number; presentacionNombre?: string; nota?: string }>) =>
    setLines((prev) => prev.map((line) => (line.productId === productId ? { ...line, ...patch } : line)))

  const removeLine = (productId: string) => setLines((prev) => prev.filter((line) => line.productId !== productId))

  const valid = lines.length > 0 && lines.every((line) => line.quantity > 0)

  const submit = async () => {
    if (!valid || saving) return
    setSaving(true)
    try {
      await transferService.create({
        motivo,
        referencia: referencia || undefined,
        nota: nota || undefined,
        sucursalOrigenId: 1,
        sucursalDestinoId: 2,
        lines: lines.map((line) => ({
          productId: line.productId,
          nota: line.nota,
          ...(line.presentacionId != null ? { presentacionId: line.presentacionId, cantidadPresentacion: line.quantity } : { cantidadBase: line.quantity }),
        })),
      })
      await onCreated()
    } finally {
      setSaving(false)
    }
  }

  return <Modal title="Nueva solicitud de traslado" subtitle="Almacén → Tienda" onClose={onClose} wide>
    <div className="modal-body form-grid">
      <label>Motivo<select value={motivo} onChange={(e) => setMotivo(e.target.value as TransferMotivo)}><option value="VENTA_DIRECTA">Venta directa</option><option value="REPOSICION">Reposición</option></select></label>
      <label>Referencia (opcional)<input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Ej. TR-0005" /></label>
      <label className="full">Nota (opcional)<input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Motivo del traslado, notas para almacén..." /></label>
      <div className="full line-add-controls">
        <input value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="Buscar producto por nombre, código o SKU..." />
        {productResults.length > 0 && (
          <div className="product-search-results">
            {productResults.map((product) => <button type="button" key={product.id} onClick={() => addProduct(product)}><strong>{product.nombre}</strong><small>{product.sku}</small></button>)}
          </div>
        )}
      </div>
      <div className="full editor-lines draft-lines">
        <header><strong>Productos a solicitar</strong></header>
        {lines.map((line) => {
          const presentations = presentationsByProduct[line.productId] ?? []
          return <div key={line.productId} className="draft-line-row presentation-line-row">
            <div className="draft-line-top">
              <span><strong>{line.name}</strong><small>{line.sku}</small></span>
              <input aria-label={`Cantidad ${line.name}`} type="number" min="1" value={line.quantity} onChange={(e) => updateLine(line.productId, { quantity: Math.max(1, Number(e.target.value)) })} />
              {presentations.length > 0 && (
                <select
                  aria-label={`Presentación ${line.name}`}
                  value={line.presentacionId ?? presentations.find((p) => p.esBase)?.id ?? presentations[0]?.id}
                  onChange={(e) => {
                    const chosen = presentations.find((p) => p.id === Number(e.target.value))
                    if (chosen) updateLine(line.productId, { presentacionId: chosen.esBase ? undefined : chosen.id, presentacionNombre: chosen.esBase ? undefined : chosen.nombre })
                  }}
                >
                  {presentations.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              )}
              <button type="button" onClick={() => removeLine(line.productId)}><X /></button>
            </div>
          </div>
        })}
        {!lines.length && <div className="empty-hint" style={{ padding: '10px 12px' }}>Busca y agrega productos a la solicitud.</div>}
      </div>
    </div>
    <footer className="modal-actions">
      <button className="secondary-button" onClick={onClose}>Cancelar</button>
      <button className="primary-button" disabled={!valid || saving} onClick={() => void submit()}>Crear solicitud</button>
    </footer>
  </Modal>
}
