import { Building2, Mail, MapPin, Pencil, Phone, Plus, Trash2, UserRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { CustomerRecord } from '../../application/shared/models'
import { authSessionProvider, customerService } from '../../infrastructure/services'
import { formatMoney, money } from '../../domain/common/money'
import { FeatureShell, FeatureState, FeatureToolbar } from '../shared/FeatureShell'
import { Modal } from '../../components/Modal'
import { SaldoBadge } from '../../components/SaldoBadge'
import { NumberField } from '../../components/NumberField'
import { consultarSaldos, verificarClienteEnHermes, type SaldoClienteLote } from '../../infrastructure/hermes/client'
import { featureFlags } from '../../config/featureFlags'
import { eliminarCliente, puedeEliminarseCliente } from '../../infrastructure/supabase/CustomerAdmin.supabase'
import { decidirEliminacionCliente as decidirEliminacionClientePura, type DeleteClienteDecision as DeleteClienteDecisionPura } from '../../domain/customers/deletionDecision'
import { coincideBusqueda } from '../../domain/customers/textSearch'
import { requiereConfirmacion } from '../../domain/customers/duplicateWarning'
import { customerRepository } from '../../infrastructure/supabase/CustomerRepository.supabase'
import type { ClienteSimilar } from '../../infrastructure/supabase/CustomerSimilarity.supabase'
import { DuplicateCustomerPanel } from '../../components/DuplicateCustomerPanel'

const customerTypeLabel: Record<CustomerRecord['type'], string> = { retail: 'Minorista', wholesale: 'Mayorista', institutional: 'Institución / Gobierno', corporate: 'Corporativo' }

const usualChannelLabel: Record<string, string> = { retail: 'Retail', mayoreo: 'Mayoreo', institucional: 'Institucional', corporativo: 'Corporativo' }

// Brief S11 Bloque B4: puede_eliminarse_cliente (lado Cation) -> verificar Hermes ->
// eliminar_cliente. Orden estricto, no se puede saltear — si el puente de Hermes falla o
// no responde, se bloquea igual (decisión de Ness: más seguro no borrar que borrar algo
// que estaba en Hermes). La decisión en sí (domain/customers/deletionDecision.ts) es pura
// y testeable sin red; esto solo orquesta las dos llamadas async y le agrega el estado
// transitorio "loading" que el modal necesita mientras esas llamadas resuelven.
type DeleteClienteDecision = { kind: 'loading' } | DeleteClienteDecisionPura

async function decidirEliminacionCliente(clienteId: number): Promise<DeleteClienteDecision> {
  const local = await puedeEliminarseCliente(clienteId)
  if (!local.existe || !local.puedeBorrarse) return decidirEliminacionClientePura(local, null)
  const hermes = await verificarClienteEnHermes(clienteId)
  return decidirEliminacionClientePura(local, hermes.estado)
}

function DeleteClienteModal({ customerName, decision, onClose, onConfirm }: { customerName: string; decision: DeleteClienteDecision; onClose: () => void; onConfirm: (motivo: string) => void | Promise<void> }) {
  const [motivo, setMotivo] = useState('')
  const [saving, setSaving] = useState(false)
  if (decision.kind === 'loading') return <Modal title="Eliminar cliente" subtitle={customerName} onClose={onClose}><div className="modal-body"><FeatureState type="loading" text="Verificando si se puede eliminar" /></div></Modal>
  if (decision.kind === 'blocked') return <Modal title="No se puede eliminar" subtitle={customerName} onClose={onClose}>
    <div className="modal-body"><p>{decision.reason}</p></div>
    <footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cerrar</button></footer>
  </Modal>
  const valid = motivo.trim().length > 0
  const submit = async () => { setSaving(true); try { await onConfirm(motivo.trim()) } finally { setSaving(false) } }
  return <Modal title="Eliminar cliente" subtitle={customerName} onClose={onClose}>
    <div className="modal-body form-grid">
      <p className="full">Se va a eliminar a {customerName}. No tiene ventas, pedidos, cotizaciones ni movimientos de caja, y no existe en Hermes. Esta acción no se puede deshacer.</p>
      <label className="full">Motivo<textarea rows={3} autoFocus placeholder="Ej. cliente duplicado" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></label>
    </div>
    <footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="danger-button" disabled={!valid || saving} onClick={() => void submit()}>{saving ? 'Eliminando...' : 'Eliminar cliente'}</button></footer>
  </Modal>
}

// Saldo de la tarjeta: cuatro estados posibles, ninguno es "Bs 0,00" salvo que Hermes
// devuelva exactamente cero. `saldos === null` es todavía no se consultó;
// `saldos.mapa === null` es puente caído; `saldos.mapa.get(id) === undefined` es
// cliente sin cuenta corriente en Hermes.
function SaldoFooter({ customerId, saldos }: { customerId: string; saldos: { mapa: Map<number, SaldoClienteLote> | null } | null }) {
  if (!saldos) return <span>Consultando saldo…</span>
  if (!saldos.mapa) return <span>Saldo no disponible</span>
  const s = saldos.mapa.get(Number(customerId))
  if (!s) return <span className="saldo-sin-cuenta">Sin cuenta en Hermes</span>
  if (s.saldoConfirmado === 0) return <span className="saldo-al-dia">Al día</span>
  const debe = s.saldoConfirmado > 0
  return <><span className={debe ? 'saldo-deudor' : 'saldo-acreedor'}>{debe ? 'Debe' : 'Saldo a favor'}</span><strong>{formatMoney(money(Math.round(Math.abs(s.saldoConfirmado) * 100)))}</strong></>
}

export function CustomersPage({ notify }: { notify: (message: string) => void }) {
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selected, setSelected] = useState<CustomerRecord | null>(null)
  const [editing, setEditing] = useState<CustomerRecord | null>(null)
  // Brief T2 Tarea 1: "nuevo" no se infiere del shape del id (formatos distintos entre
  // Supabase/mock, ver comentario en CustomerPicker.tsx) — cada llamador de setEditing ya
  // sabe si viene de "Nuevo cliente" o de "Editar", así que se pasa explícito.
  const [editingIsNew, setEditingIsNew] = useState(false)
  // Tres estados en una sola variable, para que el tipo obligue a distinguirlos:
  //   null            → todavía no se consultó
  //   { mapa: null }  → se consultó y el puente falló
  //   { mapa: Map }   → datos reales; un id ausente del Map es "sin cuenta en Hermes"
  // Con dos booleanos separados hacía falta un setState sincrónico dentro del
  // efecto (react-hooks/set-state-in-effect) para marcar "cargando".
  const [saldos, setSaldos] = useState<{ mapa: Map<number, SaldoClienteLote> | null } | null>(null)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteDecision, setDeleteDecision] = useState<DeleteClienteDecision>({ kind: 'loading' })
  const load = () => customerService.list().then((rows) => { setCustomers(rows); setStatus('ready') }).catch(() => setStatus('error'))
  useEffect(() => { void load() }, [])
  useEffect(() => {
    if (!featureFlags.supabase || !customers.length) return
    const ids = customers.filter(c => c.type !== 'retail').map((c) => Number(c.id)).filter(Number.isFinite)
    if (!ids.length) return
    let cancelado = false
    void consultarSaldos(ids).then((mapa) => { if (!cancelado) setSaldos({ mapa }) })
    return () => { cancelado = true }
  }, [customers])
  const filtered = useMemo(() => customers.filter((customer) => (!typeFilter || customer.type === typeFilter) && coincideBusqueda([customer.name, customer.businessName, customer.document, customer.email, customer.phone, customer.city].filter(Boolean).join(' '), query)), [customers, query, typeFilter])
  const create = () => { setEditingIsNew(true); setEditing({ id: crypto.randomUUID(), name: '', type: 'wholesale', document: '', phone: '', email: '', address: '', usualChannel: 'mayoreo', paymentTerms: 'Contado', creditLimitCents: 0, pendingBalanceCents: 0 }) }
  const save = async (customer: CustomerRecord) => { await customerService.save(customer); setEditing(null); await load(); notify('Cliente guardado') }
  const selectedSaldo = selected ? saldos?.mapa?.get(Number(selected.id)) : undefined
  const openDeleteCheck = async (customer: CustomerRecord) => {
    setDeleteModalOpen(true)
    setDeleteDecision({ kind: 'loading' })
    const numId = Number(customer.id)
    if (!Number.isFinite(numId)) { setDeleteDecision({ kind: 'blocked', reason: 'Cliente inválido' }); return }
    setDeleteDecision(await decidirEliminacionCliente(numId))
  }
  const confirmDeleteCustomer = async (motivo: string) => {
    if (!selected) return
    const actorSession = await authSessionProvider.getSession()
    const actor = actorSession?.user.email ?? actorSession?.user.name ?? 'pos'
    try {
      await eliminarCliente(Number(selected.id), motivo, actor)
      setDeleteModalOpen(false)
      setSelected(null)
      await load()
      notify(`Cliente ${selected.name} eliminado`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo eliminar el cliente')
    }
  }
  return <FeatureShell className="management-page customers-page" eyebrow="RELACIONES COMERCIALES" title="Clientes" subtitle="Toda la información de tus clientes, en un solo lugar." action={<button className="primary-button" onClick={create}><Plus /> Nuevo cliente</button>}>
    <div className="management-stats">
      <div><span>Directorio</span><strong>{customers.length}</strong><small>clientes registrados</small></div>
      <div><span>Mayoristas</span><strong>{customers.filter((c) => c.type === 'wholesale').length}</strong><small>relaciones de mayoreo</small></div>
      <div><span>Instituciones y empresas</span><strong>{customers.filter((c) => c.type === 'institutional' || c.type === 'corporate').length}</strong><small>cuentas comerciales</small></div>
    </div>
    <FeatureToolbar query={query} onQuery={setQuery} placeholder="Buscar nombre, NIT, teléfono o correo…">
      <select aria-label="Tipo de cliente" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}><option value="">Todos los tipos</option>{Object.entries(customerTypeLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      {(query || typeFilter) && <button className="secondary-button" onClick={() => { setQuery(''); setTypeFilter('') }}>Limpiar filtros</button>}
    </FeatureToolbar>
    <div className="management-list-heading"><h2>Directorio de clientes</h2><span aria-live="polite">{filtered.length} de {customers.length} clientes</span></div>
    {status === 'loading' ? <FeatureState type="skeleton" text="Cargando clientes" /> : status === 'error' ? <><FeatureState type="error" text="No se pudieron cargar los clientes" /><button className="secondary-button" onClick={() => { setStatus('loading'); void load() }}>Reintentar</button></> : !filtered.length ? <FeatureState type={customers.length ? 'no-results' : 'empty'} text={customers.length ? 'No encontramos coincidencias' : 'Tu directorio está listo para el primer cliente'} /> : <div className="customer-grid">{filtered.map((customer) => <button className="customer-card" key={customer.id} onClick={() => setSelected(customer)}>
      <div className="customer-card-heading"><div className="customer-avatar">{customer.type === 'institutional' || customer.type === 'corporate' ? <Building2 /> : <UserRound />}</div><div><strong>{customer.name}</strong><span>{customerTypeLabel[customer.type]}</span></div><span className="customer-card-arrow">↗</span></div>
      <div className="customer-card-contact"><span><UserRound /> {customer.document || 'Sin documento'}</span><span><Phone /> {customer.phone || 'Sin teléfono'}</span><span><Mail /> {customer.email || 'Sin correo'}</span></div>
      <div className="customer-card-tags"><span>{usualChannelLabel[customer.usualChannel] ?? customer.usualChannel}</span><span>{customer.paymentTerms || 'Sin condiciones'}</span><span>{customer.origin === 'shopify' ? 'Shopify' : 'Manual'}</span></div>
      <footer>{featureFlags.supabase ? customer.type === 'retail' ? <span>Retail · seguimiento en Seller</span> : <SaldoFooter customerId={customer.id} saldos={saldos} /> : <><span>{(customer.pendingBalanceCents ?? 0) < 0 ? 'Saldo a favor' : 'Saldo pendiente'}</span><strong>{formatMoney(money(Math.abs(customer.pendingBalanceCents ?? 0)))}</strong></>}</footer>
    </button>)}</div>}
    {selected && <Modal title="Ficha del cliente" subtitle="Datos de contacto y condiciones comerciales" className="commercial-modal customer-modal" onClose={() => setSelected(null)} wide>
      <div className="modal-body">
        <div className="customer-profile-hero"><div className="customer-avatar"><UserRound /></div><div><span className="summary-eyebrow">{customerTypeLabel[selected.type]}</span><h3>{selected.name}</h3><p>{selected.document ? 'Documento / NIT: ' + selected.document : 'Documento pendiente de completar'}</p></div><span className="status-chip ok">{selected.origin === 'shopify' ? 'Shopify' : 'Manual'}</span></div>
        <div className="customer-profile-columns">
          <section className="commercial-section"><div className="commercial-section-heading"><span className="section-icon"><Phone /></span><div><h3>Contacto</h3><p>Información para comunicarte con el cliente.</p></div></div><div className="profile-details"><p><Phone /> {selected.phone || 'Sin teléfono'}</p><p><Mail /> {selected.email || 'Sin correo'}</p><p><MapPin /> {[selected.address, selected.city].filter(Boolean).join(', ') || 'Sin dirección'}</p></div>{selected.businessName && <p className="customer-business-name"><Building2 size={15} /> {selected.businessName}</p>}</section>
          <section className="commercial-section"><div className="commercial-section-heading"><span className="section-icon"><Building2 /></span><div><h3>Condiciones comerciales</h3><p>Canal, pago y cuenta del cliente.</p></div></div><dl className="product-meta-list"><div><dt>Canal habitual</dt><dd>{usualChannelLabel[selected.usualChannel] ?? selected.usualChannel}</dd></div><div><dt>Condiciones de pago</dt><dd>{selected.paymentTerms || 'Sin especificar'}</dd></div>{selected.topeAutorizado != null && <div><dt>Tope autorizado</dt><dd>{formatMoney(money(Math.round(selected.topeAutorizado * 100)))}</dd></div>}</dl></section>
        </div>
        <div className="customer-metrics">{featureFlags.supabase ? selected.type === 'retail' ? <div><span>Seguimiento</span><strong>Solo en Seller</strong></div> : <>{selectedSaldo?.limiteCredito != null && <div><span>Límite de crédito</span><strong>{formatMoney(money(Math.round(selectedSaldo.limiteCredito * 100)))}</strong></div>}<div><span>{selectedSaldo && selectedSaldo.saldoConfirmado < 0 ? 'Saldo a favor' : 'Saldo pendiente'}</span><strong>{!saldos ? 'Consultando…' : !saldos.mapa ? 'No disponible' : !selectedSaldo ? 'Sin cuenta en Hermes' : formatMoney(money(Math.round(Math.abs(selectedSaldo.saldoConfirmado) * 100)))}</strong></div></> : <><div><span>Límite de crédito</span><strong>{formatMoney(money(selected.creditLimitCents ?? 0))}</strong></div><div><span>{(selected.pendingBalanceCents ?? 0) < 0 ? 'Saldo a favor' : 'Saldo pendiente'}</span><strong>{formatMoney(money(Math.abs(selected.pendingBalanceCents ?? 0)))}</strong></div></>}</div>
        {featureFlags.supabase && selected.type !== 'retail' && <SaldoBadge clienteId={selected.id} />}
      </div>
      <footer className="modal-actions"><button className="secondary-button document-cancel" onClick={() => setSelected(null)}>Cerrar</button>{featureFlags.supabase && <button className="danger-button" onClick={() => void openDeleteCheck(selected)}><Trash2 /> Eliminar</button>}<button className="primary-button" onClick={() => { setEditingIsNew(false); setEditing(selected); setSelected(null) }}><Pencil /> Editar cliente</button></footer>
    </Modal>}
    {editing && <CustomerEditor customer={editing} isNew={editingIsNew} onClose={() => setEditing(null)} onSave={save} onGoToCustomer={(c) => { setEditing(null); setSelected(c) }} />}
    {deleteModalOpen && selected && <DeleteClienteModal customerName={selected.name} decision={deleteDecision} onClose={() => setDeleteModalOpen(false)} onConfirm={confirmDeleteCustomer} />}
  </FeatureShell>
}

// Brief T2 Tarea 1: 23505 (unique_violation) de uq_cliente_documento — buscar cuál es el
// cliente que ya tiene ese documento para poder linkearlo, en vez de mostrar el error
// crudo de Postgres.
async function buscarClientePorDocumento(documento: string, excludeId: string): Promise<CustomerRecord | null> {
  const doc = documento.trim()
  if (!doc) return null
  const candidatos = await customerService.list({ query: doc, page: { page: 1, pageSize: 5 } })
  return candidatos.find((c) => c.id !== excludeId && c.document.trim().toUpperCase() === doc.toUpperCase()) ?? null
}

function CustomerEditor({ customer, isNew, onClose, onSave, onGoToCustomer }: { customer: CustomerRecord; isNew: boolean; onClose: () => void; onSave: (value: CustomerRecord) => void | Promise<void>; onGoToCustomer: (customer: CustomerRecord) => void }) {
  const [value, setValue] = useState(customer)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [duplicado, setDuplicado] = useState<CustomerRecord | null>(null)
  const [candidatosSimilares, setCandidatosSimilares] = useState<ClienteSimilar[]>([])
  const documentoFaltante = !value.document.trim()
  const requiereTope = value.type === 'institutional' || value.type === 'corporate'

  const usarCandidato = async (candidate: ClienteSimilar) => {
    const full = await customerRepository.getById(String(candidate.id))
    onGoToCustomer(full ?? { ...value, id: String(candidate.id), name: candidate.nombre, document: candidate.documento ?? '', businessName: candidate.razonSocial ?? undefined })
  }

  const submit = async () => {
    if (saving || !value.name.trim()) return
    if (isNew && requiereConfirmacion(candidatosSimilares) && !confirm('Se encontraron clientes parecidos. ¿Crear uno nuevo de todos modos?')) return
    setSaving(true)
    setError('')
    setDuplicado(null)
    try {
      await onSave({ ...value, name: value.name.trim(), document: value.document.trim() })
    } catch (err) {
      const pgError = err as { code?: string; message?: string }
      if (pgError?.code === '23505') {
        const existing = await buscarClientePorDocumento(value.document, value.id)
        setDuplicado(existing)
        setError('Ya existe un cliente con ese documento')
      } else {
        setError(err instanceof Error ? err.message : 'No se pudo guardar el cliente')
      }
    } finally {
      setSaving(false)
    }
  }

  return <Modal title={isNew ? 'Nuevo cliente' : 'Editar cliente'} subtitle="Completa sus datos para agilizar cotizaciones, pedidos y ventas." className="commercial-modal customer-modal" onClose={() => { if (!saving) onClose() }} wide><form id="customer-editor" className="modal-body customer-editor" onSubmit={(e) => { e.preventDefault(); void submit() }}>
    <section className="commercial-section"><div className="commercial-section-heading"><span className="section-icon"><UserRound /></span><div><h3>Identificación</h3><p>El nombre es obligatorio. Puedes completar el documento después.</p></div><span className="section-step">01</span></div><div className="form-grid">
    <label>Nombre del cliente *<input required autoFocus autoComplete="name" placeholder="Nombre completo o institución" value={value.name} onChange={(e) => setValue({...value,name:e.target.value})} /></label>
    <label>Tipo<select value={value.type} onChange={(e)=>setValue({...value,type:e.target.value as CustomerRecord['type']})}><option value="retail">Retail</option><option value="wholesale">Mayorista</option><option value="institutional">Institución / Gobierno</option><option value="corporate">Corporativo</option></select></label>
    <label>Razón social<input value={value.businessName ?? ''} onChange={(e)=>setValue({...value,businessName:e.target.value})}/></label>
    <label>Documento / NIT<input value={value.document} onChange={(e)=>setValue({...value,document:e.target.value})}/></label>
    </div></section><section className="commercial-section"><div className="commercial-section-heading"><span className="section-icon"><Phone /></span><div><h3>Contacto y ubicación</h3><p>Datos que te ayudan a coordinar cada entrega.</p></div><span className="section-step">02</span></div><div className="form-grid"><label>Teléfono<input type="tel" autoComplete="tel" value={value.phone} onChange={(e)=>setValue({...value,phone:e.target.value})}/></label>
    <label>Correo<input type="email" value={value.email} onChange={(e)=>setValue({...value,email:e.target.value})}/></label>
    <label>Ciudad<input value={value.city ?? ''} onChange={(e)=>setValue({...value,city:e.target.value})}/></label>
    <label className="full">Dirección<input value={value.address} onChange={(e)=>setValue({...value,address:e.target.value})}/></label>
</div></section><section className="commercial-section"><div className="commercial-section-heading"><span className="section-icon"><Building2 /></span><div><h3>Condiciones comerciales</h3><p>Define cómo trabajas habitualmente con este cliente.</p></div><span className="section-step">03</span></div><div className="form-grid">
    <label>Canal habitual<select value={value.usualChannel} onChange={(e)=>setValue({...value,usualChannel:e.target.value as CustomerRecord['usualChannel']})}><option value="retail">Retail</option><option value="mayoreo">Mayoreo</option><option value="institucional">Institucional</option><option value="corporativo">Corporativo</option></select></label>
    <label>Condiciones de pago<input value={value.paymentTerms} onChange={(e)=>setValue({...value,paymentTerms:e.target.value})}/></label>
    {!featureFlags.supabase && <label>Límite de crédito (Bs)<NumberField min={0} value={(value.creditLimitCents ?? 0)/100} onCommit={(bs)=>setValue({...value,creditLimitCents:Math.round(bs*100)})}/></label>}
    {/* Brief S-H: solo institucional/corporativo — mismo criterio que SolicitanteField para
        decidir si tiene sentido mostrarlo (resolver_tope/evaluar_tope ni se llaman para
        retail/mayorista). Input numérico plano, no NumberField: acá "vacío" es un estado
        válido y distinto de 0 (sin tope vs. tope cero), y NumberField no representa eso. */}
    {requiereTope && (
      <label>Tope autorizado (Bs)
        <input type="number" min="0" step="0.01" placeholder="Sin tope" value={value.topeAutorizado ?? ''} onChange={(e)=>setValue({...value,topeAutorizado:e.target.value===''?undefined:Number(e.target.value)})}/>
        <small className="field-required-hint">Opcional. Vacío = sin tope.</small>
      </label>
    )}
    </div></section>
    {documentoFaltante && <p className="full field-required-hint">Este cliente no tiene documento cargado — puedes completarlo más adelante.</p>}
    {isNew && featureFlags.supabase && (
      <div className="full">
        <DuplicateCustomerPanel nombre={value.name} documento={value.document} onCandidatesChange={setCandidatosSimilares} onUseCustomer={(candidate) => void usarCandidato(candidate)} />
      </div>
    )}
    {error && <div className="full field-error" role="alert">
      <p>{error}</p>
      {duplicado && <button type="button" className="field-error-link" onClick={() => onGoToCustomer(duplicado)}>Ver a {duplicado.name}</button>}
    </div>}
  </form><footer className="modal-actions"><span className="form-footer-hint">* Campo obligatorio</span><button className="secondary-button" disabled={saving} onClick={onClose}>Cancelar</button><button form="customer-editor" type="submit" className="primary-button" disabled={!value.name.trim() || saving}>{saving ? 'Guardando…' : 'Guardar cliente'}</button></footer></Modal>
}
