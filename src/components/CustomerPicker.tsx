import { ChevronDown, CircleUserRound, Search, UserPlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { customerService } from '../infrastructure/services'
import { featureFlags } from '../config/featureFlags'
import type { CustomerRecord } from '../application/shared/models'
import { usePos } from '../context/PosContext'
import { requiereConfirmacion } from '../domain/customers/duplicateWarning'
import type { ClienteSimilar } from '../infrastructure/supabase/CustomerSimilarity.supabase'
import { DuplicateCustomerPanel } from './DuplicateCustomerPanel'

const emptyForm = { name: '', businessName: '', document: '', phone: '', email: '' }

/**
 * TAREA 4 — inline (not modal) customer picker for the cart. Search-first: most sales
 * are to an existing customer, so the search box is the very first thing shown, not a
 * blank "new customer" form. Mirrors DraftOrderEditor's 250ms product-search debounce
 * convention for the customer query.
 */
// Channel display-name lookup — mirrors CartPanel.tsx's existing channelNames constant
// exactly (kept as a local duplicate rather than importing it, since CartPanel imports
// this component, not the other way around — see report for why this wasn't hoisted).
const channelNames = { retail: 'Retail', mayoreo: 'Mayoreo', institucional: 'Institucional', corporativo: 'Corporativo' }
// Brief's exact announcement copy pattern: "Canal cambiado a Mayoreo (cliente mayorista)" —
// the parenthetical names the CUSTOMER TYPE, not the channel again.
const customerTypeLabel = (channel: 'retail' | 'mayoreo' | 'institucional' | 'corporativo') =>
  ({ retail: 'cliente minorista', mayoreo: 'cliente mayorista', institucional: 'cliente institución / gobierno', corporativo: 'cliente corporativo' })[channel]

export function CustomerPicker({ channel, notify }: { channel: 'retail' | 'mayoreo' | 'institucional' | 'corporativo'; notify?: (message: string) => void }) {
  const { customer, selectCustomer, setChannel } = usePos()
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CustomerRecord[]>([])
  const [searching, setSearching] = useState(false)
  const [creating, setCreating] = useState<{ id?: string } & typeof emptyForm | null>(null)
  const [editingBase, setEditingBase] = useState<CustomerRecord | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [duplicadoDoc, setDuplicadoDoc] = useState<CustomerRecord | null>(null)
  const [candidatosSimilares, setCandidatosSimilares] = useState<ClienteSimilar[]>([])
  const rootRef = useRef<HTMLDivElement>(null)

  const closeAll = () => { setExpanded(false); setCreating(null); setEditingBase(null); setQuery(''); setError(''); setDuplicadoDoc(null); setCandidatosSimilares([]) }

  useEffect(() => {
    if (!expanded) return
    const onClickOutside = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) closeAll() }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [expanded])

  useEffect(() => {
    if (!expanded || creating) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors DraftOrderEditor's debounced search: the loading flag must flip the instant the query changes, before the debounce timer resolves
    setSearching(true)
    const handle = setTimeout(() => {
      void customerService.list({ query, page: { page: 1, pageSize: 10 } }).then((list) => { if (!cancelled) { setResults(list); setSearching(false) } })
    }, 280)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [expanded, creating, query])

  // TAREA B — "channel follows the customer": picking a customer auto-sets the active
  // channel to their usualChannel (a smart default, not a lock — the seller can still
  // change it manually afterward). Guarded so we don't re-announce/re-trigger when the
  // customer's channel already matches what's active.
  const pick = (record: CustomerRecord) => {
    selectCustomer({ id: record.id, name: record.name, documento: record.document || undefined })
    if (record.usualChannel !== channel) {
      setChannel(record.usualChannel)
      notify?.(`Canal cambiado a ${channelNames[record.usualChannel]} (${customerTypeLabel(record.usualChannel)})`)
    }
    closeAll()
  }
  // "Cliente de mostrador" is the normal baseline, not a surprising change — reset the
  // channel back to retail silently (no announcement), same non-duplicate-trigger guard.
  const pickCounter = () => {
    selectCustomer(null)
    if (channel !== 'retail') setChannel('retail')
    closeAll()
  }

  const startNew = () => { setEditingBase(null); setCreating({ ...emptyForm }) }
  const startEdit = () => {
    if (!customer?.id) { startNew(); return }
    void customerService.list({ query: customer.name, page: { page: 1, pageSize: 10 } }).then((list) => {
      const existing = list.find((c) => c.id === customer.id)
      setEditingBase(existing ?? null)
      setCreating(existing
        ? { id: existing.id, name: existing.name, businessName: existing.businessName ?? '', document: existing.document, phone: existing.phone, email: existing.email }
        : { id: customer.id, name: customer.name, businessName: '', document: customer.documento ?? '', phone: '', email: '' })
    })
  }

  // Brief T2 Tarea 1: `!creating.id` es la señal correcta de "es alta nueva" — no el
  // formato del id (ver comentario de más abajo sobre el sentinel vacío/UUID). startNew()
  // nunca setea id; startEdit() siempre lo setea (del registro existente o de customer.id),
  // incluso en el caso borde donde editingBase queda null porque la búsqueda no lo encontró.
  const isNewCustomer = !creating?.id

  const confirmCreate = async () => {
    if (!creating || !creating.name.trim()) { setError('El nombre es obligatorio'); return }
    if (isNewCustomer && requiereConfirmacion(candidatosSimilares) && !confirm('Se encontraron clientes parecidos. ¿Crear uno nuevo de todos modos?')) return
    setSaving(true)
    setError('')
    setDuplicadoDoc(null)
    try {
      // Editing an existing customer: merge onto the record we read back, preserving
      // fields this small form doesn't expose (type, address, etc.) instead of
      // clobbering them. A genuinely new customer gets a fresh record with sane
      // defaults — id is the Supabase "not yet persisted" empty-string sentinel
      // (see QuoteRepository.supabase.ts's save-with-empty-id convention) in Supabase
      // mode, or a client-generated id in mock mode (LocalStorageRepository has no
      // server round trip to mint one).
      const record: CustomerRecord = editingBase
        ? { ...editingBase, name: creating.name.trim(), businessName: creating.businessName.trim() || undefined, document: creating.document.trim(), phone: creating.phone.trim(), email: creating.email.trim() }
        : {
            id: creating.id ?? (featureFlags.supabase ? '' : crypto.randomUUID()),
            name: creating.name.trim(),
            // Brief S-D: se invierte el mapeo de Brief M, que producía exactamente el
            // problema que este brief corrige — el sistema sugería "Municipal" para todo
            // cliente de gobierno (tipo_precio = 'institucion'), y el 100% de los 30
            // documentos históricos con categoría MUNICIPAL eran clientes reales de
            // gobierno. Ahora la pestaña coincide con el nombre: parado en Institucional
            // se da de alta como Institución/gobierno; parado en Corporativo, como
            // empresa privada.
            type: channel === 'mayoreo' ? 'wholesale' : channel === 'institucional' ? 'institutional' : channel === 'corporativo' ? 'corporate' : 'retail',
            // Brief S-B: el documento nunca bloquea el guardado, alta nueva o edición —
            // sigue siendo uno de los dos mecanismos de detección de duplicados (junto con
            // la similitud por nombre), pero cargarlo es opcional en todos los casos.
            document: creating.document.trim(),
            phone: creating.phone.trim(),
            email: creating.email.trim(),
            address: '',
            usualChannel: channel,
            paymentTerms: 'Contado',
            creditLimitCents: 0,
            pendingBalanceCents: 0,
            businessName: creating.businessName.trim() || undefined,
          }
      const saved = await customerService.save(record)
      selectCustomer({ id: saved.id, name: saved.name, documento: saved.document || undefined })
      closeAll()
    } catch (err) {
      const pgError = err as { code?: string; message?: string }
      if (pgError?.code === '23505' && featureFlags.supabase) {
        const doc = creating.document.trim()
        const matches = await customerService.list({ query: doc, page: { page: 1, pageSize: 5 } })
        const existing = matches.find((c) => c.id !== editingBase?.id && c.document.trim().toUpperCase() === doc.toUpperCase())
        setDuplicadoDoc(existing ?? null)
        setError('Ya existe un cliente con ese documento')
      } else {
        setError(err instanceof Error ? err.message : 'No se pudo guardar el cliente')
      }
    } finally {
      setSaving(false)
    }
  }

  const label = customer ? (customer.name) : 'Cliente de mostrador'
  const sub = customer?.documento ? customer.documento : undefined

  return <div className="customer-picker" ref={rootRef}>
    <button type="button" className={`customer-select ${channel !== 'retail' && !customer ? 'required' : ''}`} onClick={() => setExpanded((v) => !v)}>
      <CircleUserRound /><span><small>CLIENTE</small><strong>{label}{sub ? ` · ${sub}` : ''}</strong></span><ChevronDown className={expanded ? 'chevron-open' : ''} />
    </button>
    {expanded && <div className="customer-picker-panel">
      {creating ? <div className="customer-new-form">
        <div className="form-grid">
          <label>Nombre<input value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} autoFocus /></label>
          <label>Razón social<input value={creating.businessName} onChange={(e) => setCreating({ ...creating, businessName: e.target.value })} /></label>
          <label>NIT / Documento<input value={creating.document} onChange={(e) => setCreating({ ...creating, document: e.target.value })} /></label>
          <label>Teléfono<input value={creating.phone} onChange={(e) => setCreating({ ...creating, phone: e.target.value })} /></label>
          <label className="full">Email<input value={creating.email} onChange={(e) => setCreating({ ...creating, email: e.target.value })} /></label>
        </div>
        {isNewCustomer && featureFlags.supabase && (
          <DuplicateCustomerPanel nombre={creating.name} documento={creating.document} onCandidatesChange={setCandidatosSimilares} onUseCustomer={(candidate) => { selectCustomer({ id: String(candidate.id), name: candidate.nombre, documento: candidate.documento ?? undefined }); closeAll() }} />
        )}
        {error && <div className="mock-note payment-error">
          <p>{error}</p>
          {duplicadoDoc && <button type="button" className="field-error-link" onClick={() => { selectCustomer({ id: duplicadoDoc.id, name: duplicadoDoc.name, documento: duplicadoDoc.document || undefined }); closeAll() }}>Usar a {duplicadoDoc.name}</button>}
        </div>}
        <div className="customer-picker-actions">
          <button type="button" className="secondary-button" onClick={() => setCreating(null)}>Cancelar</button>
          <button type="button" className="primary-button" disabled={saving} onClick={() => void confirmCreate()}>{saving ? 'Guardando…' : 'Guardar cliente'}</button>
        </div>
      </div> : <>
        <div className="customer-search-box"><Search /><input placeholder="Buscar por nombre o NIT…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus /></div>
        <div className="customer-picker-quick">
          <button type="button" onClick={pickCounter}>Cliente de mostrador</button>
          <button type="button" onClick={startNew}><UserPlus /> Cliente nuevo</button>
          {customer?.id && <button type="button" onClick={startEdit}>Editar cliente actual</button>}
        </div>
        <div className="customer-results">
          {searching
            ? <p className="product-info-empty">Buscando…</p>
            : results.length
              ? results.map((record) => <button type="button" key={record.id} className="customer-result-row" onClick={() => pick(record)}>
                  <strong>{record.name}</strong>
                  <small>{[record.businessName, record.document].filter(Boolean).join(' · ') || 'Sin NIT registrado'}</small>
                </button>)
              : <p className="product-info-empty">Sin resultados{query ? ` para "${query}"` : ''}.</p>}
        </div>
      </>}
    </div>}
  </div>
}
