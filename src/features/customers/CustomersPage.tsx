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
  const [selected, setSelected] = useState<CustomerRecord | null>(null)
  const [editing, setEditing] = useState<CustomerRecord | null>(null)
  // Tres estados en una sola variable, para que el tipo obligue a distinguirlos:
  //   null            → todavía no se consultó
  //   { mapa: null }  → se consultó y el puente falló
  //   { mapa: Map }   → datos reales; un id ausente del Map es "sin cuenta en Hermes"
  // Con dos booleanos separados hacía falta un setState sincrónico dentro del
  // efecto (react-hooks/set-state-in-effect) para marcar "cargando".
  const [saldos, setSaldos] = useState<{ mapa: Map<number, SaldoClienteLote> | null } | null>(null)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteDecision, setDeleteDecision] = useState<DeleteClienteDecision>({ kind: 'loading' })
  const load = () => customerService.list().then(setCustomers)
  useEffect(() => { void load() }, [])
  useEffect(() => {
    if (!featureFlags.supabase || !customers.length) return
    const ids = customers.map((c) => Number(c.id)).filter(Number.isFinite)
    if (!ids.length) return
    let cancelado = false
    void consultarSaldos(ids).then((mapa) => { if (!cancelado) setSaldos({ mapa }) })
    return () => { cancelado = true }
  }, [customers])
  const filtered = useMemo(() => customers.filter((customer) => `${customer.name} ${customer.document} ${customer.email}`.toLowerCase().includes(query.toLowerCase())), [customers, query])
  const create = () => setEditing({ id: crypto.randomUUID(), name: '', type: 'wholesale', document: '', phone: '', email: '', address: '', usualChannel: 'mayoreo', paymentTerms: 'Contado', creditLimitCents: 0, pendingBalanceCents: 0 })
  const save = async (customer: CustomerRecord) => { await customerService.save(customer); setEditing(null); await load(); notify('Cliente guardado localmente') }
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
  return <FeatureShell eyebrow="RELACIONES COMERCIALES" title="Clientes" subtitle="Datos, condiciones y actividad comercial simulada" action={<button className="primary-button" onClick={create}><Plus /> Nuevo cliente</button>}><FeatureToolbar query={query} onQuery={setQuery} placeholder="Buscar cliente, documento o correo..." />{!filtered.length ? <FeatureState type={customers.length ? 'no-results' : 'empty'} text="No hay clientes" /> : <div className="customer-grid">{filtered.map((customer) => <button className="customer-card" key={customer.id} onClick={() => setSelected(customer)}><div className="customer-avatar">{customer.type === 'institutional' || customer.type === 'corporate' ? <Building2 /> : <UserRound />}</div><div><strong>{customer.name}</strong><span>{customer.document} · {customer.usualChannel}</span></div><i>{customer.paymentTerms}</i><span className={`status-chip origin-chip ${customer.origin === 'shopify' ? 'pending' : 'ok'}`}>{customer.origin === 'shopify' ? 'Shopify' : 'Manual'}</span><footer>{featureFlags.supabase ? <SaldoFooter customerId={customer.id} saldos={saldos} /> : <><span>Saldo pendiente</span><strong>{formatMoney(money(customer.pendingBalanceCents ?? 0))}</strong></>}</footer></button>)}</div>}{selected && <Modal title={selected.name} subtitle={`Cliente ${selected.type}`} onClose={() => setSelected(null)} wide><div className="modal-body customer-profile"><div className="profile-details"><p><Phone /> {selected.phone || 'Sin teléfono'}</p><p><Mail /> {selected.email || 'Sin correo'}</p><p><MapPin /> {selected.address || 'Sin dirección'}{selected.city ? `, ${selected.city}` : ''}</p><SaldoBadge clienteId={selected.id} /></div><div className="customer-metrics">{featureFlags.supabase ? <>{selectedSaldo?.limiteCredito != null && <div><span>Límite de crédito</span><strong>{formatMoney(money(Math.round(selectedSaldo.limiteCredito * 100)))}</strong></div>}<div><span>Saldo pendiente</span><strong>{!saldos?.mapa ? 'No disponible' : !selectedSaldo ? 'Sin cuenta en Hermes' : formatMoney(money(Math.round(Math.abs(selectedSaldo.saldoConfirmado) * 100)))}</strong></div></> : <><div><span>Límite de crédito</span><strong>{formatMoney(money(selected.creditLimitCents ?? 0))}</strong></div><div><span>Saldo pendiente</span><strong>{formatMoney(money(selected.pendingBalanceCents ?? 0))}</strong></div></>}<div><span>Canal habitual</span><strong>{selected.usualChannel}</strong></div></div>{selected.businessName && <p><Building2 size={14} /> Razón social: {selected.businessName}</p>}<span className={`status-chip origin-chip ${selected.origin === 'shopify' ? 'pending' : 'ok'}`}>{selected.origin === 'shopify' ? 'Shopify' : 'Manual'}</span>{featureFlags.supabase ? <><h3>Actividad</h3><div className="mock-history empty-hint">Sin actividad registrada aún</div></> : <><h3>Historial simulado</h3><div className="mock-history"><span>COT-2026-0042</span><b>Cotización</b><small>22 jul 2026</small><span>PED-2026-0187</span><b>Pedido</b><small>22 jul 2026</small></div></>}</div><footer className="modal-actions"><button className="primary-button" onClick={() => { setEditing(selected); setSelected(null) }}><Pencil /> Editar</button>{featureFlags.supabase && <button className="danger-button" onClick={() => void openDeleteCheck(selected)}><Trash2 /> Eliminar</button>}</footer></Modal>}{editing && <CustomerEditor customer={editing} onClose={() => setEditing(null)} onSave={save} />}{deleteModalOpen && selected && <DeleteClienteModal customerName={selected.name} decision={deleteDecision} onClose={() => setDeleteModalOpen(false)} onConfirm={confirmDeleteCustomer} />}</FeatureShell>
}

function CustomerEditor({ customer, onClose, onSave }: { customer: CustomerRecord; onClose: () => void; onSave: (value: CustomerRecord) => void }) {
  const [value, setValue] = useState(customer)
  return <Modal title={customer.name ? 'Editar cliente' : 'Nuevo cliente'} onClose={onClose} wide><div className="modal-body form-grid"><label>Nombre<input value={value.name} onChange={(e) => setValue({...value,name:e.target.value})} /></label><label>Tipo<select value={value.type} onChange={(e)=>setValue({...value,type:e.target.value as CustomerRecord['type']})}><option value="retail">Retail</option><option value="wholesale">Mayorista</option><option value="institutional">Institución / Gobierno</option><option value="corporate">Corporativo</option></select></label><label>Razón social<input value={value.businessName ?? ''} onChange={(e)=>setValue({...value,businessName:e.target.value})}/></label><label>Documento / NIT<input value={value.document} onChange={(e)=>setValue({...value,document:e.target.value})}/></label><label>Teléfono<input value={value.phone} onChange={(e)=>setValue({...value,phone:e.target.value})}/></label><label>Correo<input type="email" value={value.email} onChange={(e)=>setValue({...value,email:e.target.value})}/></label><label>Ciudad<input value={value.city ?? ''} onChange={(e)=>setValue({...value,city:e.target.value})}/></label><label>Canal habitual<select value={value.usualChannel} onChange={(e)=>setValue({...value,usualChannel:e.target.value as CustomerRecord['usualChannel']})}><option value="retail">Retail</option><option value="mayoreo">Mayoreo</option><option value="institucional">Institucional</option><option value="municipal">Municipal</option></select></label><label className="full">Dirección<input value={value.address} onChange={(e)=>setValue({...value,address:e.target.value})}/></label><label>Condiciones de pago<input value={value.paymentTerms} onChange={(e)=>setValue({...value,paymentTerms:e.target.value})}/></label><label>Límite de crédito (Bs)<NumberField min={0} value={(value.creditLimitCents ?? 0)/100} onCommit={(bs)=>setValue({...value,creditLimitCents:Math.round(bs*100)})}/></label></div><footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!value.name.trim()} onClick={()=>onSave(value)}>Guardar</button></footer></Modal>
}
