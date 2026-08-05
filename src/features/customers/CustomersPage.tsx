import { Building2, Mail, MapPin, Pencil, Phone, Plus, UserRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { CustomerRecord } from '../../application/shared/models'
import { customerService } from '../../infrastructure/services'
import { formatMoney, money } from '../../domain/common/money'
import { FeatureShell, FeatureState, FeatureToolbar } from '../shared/FeatureShell'
import { Modal } from '../../components/Modal'
import { SaldoBadge } from '../../components/SaldoBadge'
import { NumberField } from '../../components/NumberField'
import { consultarSaldos, type SaldoClienteLote } from '../../infrastructure/hermes/client'
import { featureFlags } from '../../config/featureFlags'

// Saldo de la tarjeta: cuatro estados posibles, ninguno es "Bs 0,00" salvo que Hermes
// devuelva exactamente cero. `saldos === null` es puente caído (no consultado o falló);
// `saldos.get(id) === undefined` es cliente sin cuenta corriente en Hermes.
function SaldoFooter({ customerId, saldos, saldosCargando }: { customerId: string; saldos: Map<number, SaldoClienteLote> | null; saldosCargando: boolean }) {
  if (saldosCargando && !saldos) return <span>Consultando saldo…</span>
  if (!saldos) return <span>Saldo no disponible</span>
  const s = saldos.get(Number(customerId))
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
  const [saldos, setSaldos] = useState<Map<number, SaldoClienteLote> | null>(null)
  const [saldosCargando, setSaldosCargando] = useState(false)
  const load = () => customerService.list().then(setCustomers)
  useEffect(() => { void load() }, [])
  useEffect(() => {
    if (!featureFlags.supabase || !customers.length) return
    const ids = customers.map((c) => Number(c.id)).filter(Number.isFinite)
    if (!ids.length) return
    let cancelado = false
    setSaldosCargando(true)
    void consultarSaldos(ids)
      .then((resultado) => { if (!cancelado) setSaldos(resultado) })
      .finally(() => { if (!cancelado) setSaldosCargando(false) })
    return () => { cancelado = true }
  }, [customers])
  const filtered = useMemo(() => customers.filter((customer) => `${customer.name} ${customer.document} ${customer.email}`.toLowerCase().includes(query.toLowerCase())), [customers, query])
  const create = () => setEditing({ id: crypto.randomUUID(), name: '', type: 'wholesale', document: '', phone: '', email: '', address: '', usualChannel: 'mayoreo', paymentTerms: 'Contado', creditLimitCents: 0, pendingBalanceCents: 0 })
  const save = async (customer: CustomerRecord) => { await customerService.save(customer); setEditing(null); await load(); notify('Cliente guardado localmente') }
  const selectedSaldo = selected ? saldos?.get(Number(selected.id)) : undefined
  return <FeatureShell eyebrow="RELACIONES COMERCIALES" title="Clientes" subtitle="Datos, condiciones y actividad comercial simulada" action={<button className="primary-button" onClick={create}><Plus /> Nuevo cliente</button>}><FeatureToolbar query={query} onQuery={setQuery} placeholder="Buscar cliente, documento o correo..." />{!filtered.length ? <FeatureState type={customers.length ? 'no-results' : 'empty'} text="No hay clientes" /> : <div className="customer-grid">{filtered.map((customer) => <button className="customer-card" key={customer.id} onClick={() => setSelected(customer)}><div className="customer-avatar">{customer.type === 'institutional' || customer.type === 'corporate' ? <Building2 /> : <UserRound />}</div><div><strong>{customer.name}</strong><span>{customer.document} · {customer.usualChannel}</span></div><i>{customer.paymentTerms}</i><span className={`status-chip origin-chip ${customer.origin === 'shopify' ? 'pending' : 'ok'}`}>{customer.origin === 'shopify' ? 'Shopify' : 'Manual'}</span><footer>{featureFlags.supabase ? <SaldoFooter customerId={customer.id} saldos={saldos} saldosCargando={saldosCargando} /> : <><span>Saldo pendiente</span><strong>{formatMoney(money(customer.pendingBalanceCents ?? 0))}</strong></>}</footer></button>)}</div>}{selected && <Modal title={selected.name} subtitle={`Cliente ${selected.type}`} onClose={() => setSelected(null)} wide><div className="modal-body customer-profile"><div className="profile-details"><p><Phone /> {selected.phone || 'Sin teléfono'}</p><p><Mail /> {selected.email || 'Sin correo'}</p><p><MapPin /> {selected.address || 'Sin dirección'}{selected.city ? `, ${selected.city}` : ''}</p><SaldoBadge clienteId={selected.id} /></div><div className="customer-metrics">{featureFlags.supabase ? <>{selectedSaldo?.limiteCredito != null && <div><span>Límite de crédito</span><strong>{formatMoney(money(Math.round(selectedSaldo.limiteCredito * 100)))}</strong></div>}<div><span>Saldo pendiente</span><strong>{saldos === null ? 'No disponible' : !selectedSaldo ? 'Sin cuenta en Hermes' : formatMoney(money(Math.round(Math.abs(selectedSaldo.saldoConfirmado) * 100)))}</strong></div></> : <><div><span>Límite de crédito</span><strong>{formatMoney(money(selected.creditLimitCents ?? 0))}</strong></div><div><span>Saldo pendiente</span><strong>{formatMoney(money(selected.pendingBalanceCents ?? 0))}</strong></div></>}<div><span>Canal habitual</span><strong>{selected.usualChannel}</strong></div></div>{selected.businessName && <p><Building2 size={14} /> Razón social: {selected.businessName}</p>}<span className={`status-chip origin-chip ${selected.origin === 'shopify' ? 'pending' : 'ok'}`}>{selected.origin === 'shopify' ? 'Shopify' : 'Manual'}</span>{featureFlags.supabase ? <><h3>Actividad</h3><div className="mock-history empty-hint">Sin actividad registrada aún</div></> : <><h3>Historial simulado</h3><div className="mock-history"><span>COT-2026-0042</span><b>Cotización</b><small>22 jul 2026</small><span>PED-2026-0187</span><b>Pedido</b><small>22 jul 2026</small></div></>}</div><footer className="modal-actions"><button className="primary-button" onClick={() => { setEditing(selected); setSelected(null) }}><Pencil /> Editar</button></footer></Modal>}{editing && <CustomerEditor customer={editing} onClose={() => setEditing(null)} onSave={save} />}</FeatureShell>
}

function CustomerEditor({ customer, onClose, onSave }: { customer: CustomerRecord; onClose: () => void; onSave: (value: CustomerRecord) => void }) {
  const [value, setValue] = useState(customer)
  return <Modal title={customer.name ? 'Editar cliente' : 'Nuevo cliente'} onClose={onClose} wide><div className="modal-body form-grid"><label>Nombre<input value={value.name} onChange={(e) => setValue({...value,name:e.target.value})} /></label><label>Tipo<select value={value.type} onChange={(e)=>setValue({...value,type:e.target.value as CustomerRecord['type']})}><option value="retail">Retail</option><option value="wholesale">Mayorista</option><option value="institutional">Institución / Gobierno</option><option value="corporate">Corporativo</option></select></label><label>Razón social<input value={value.businessName ?? ''} onChange={(e)=>setValue({...value,businessName:e.target.value})}/></label><label>Documento / NIT<input value={value.document} onChange={(e)=>setValue({...value,document:e.target.value})}/></label><label>Teléfono<input value={value.phone} onChange={(e)=>setValue({...value,phone:e.target.value})}/></label><label>Correo<input type="email" value={value.email} onChange={(e)=>setValue({...value,email:e.target.value})}/></label><label>Ciudad<input value={value.city ?? ''} onChange={(e)=>setValue({...value,city:e.target.value})}/></label><label>Canal habitual<select value={value.usualChannel} onChange={(e)=>setValue({...value,usualChannel:e.target.value as CustomerRecord['usualChannel']})}><option value="retail">Retail</option><option value="mayoreo">Mayoreo</option><option value="institucional">Institucional</option><option value="municipal">Municipal</option></select></label><label className="full">Dirección<input value={value.address} onChange={(e)=>setValue({...value,address:e.target.value})}/></label><label>Condiciones de pago<input value={value.paymentTerms} onChange={(e)=>setValue({...value,paymentTerms:e.target.value})}/></label><label>Límite de crédito (Bs)<NumberField min={0} value={(value.creditLimitCents ?? 0)/100} onCommit={(bs)=>setValue({...value,creditLimitCents:Math.round(bs*100)})}/></label></div><footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!value.name.trim()} onClick={()=>onSave(value)}>Guardar</button></footer></Modal>
}
