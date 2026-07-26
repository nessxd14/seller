import { ArrowDownLeft, ArrowUpRight, Calculator, LockKeyhole, WalletCards } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CashSessionRecord } from '../../application/shared/models'
import { cashService, sensitiveOperations } from '../../infrastructure/services'
import { formatMoney, money } from '../../domain/common/money'
import { FeatureShell, FeatureState } from '../shared/FeatureShell'
import { Modal } from '../../components/Modal'
import { featureFlags } from '../../config/featureFlags'
import { useCashSession } from '../../context/CashSessionContext'

export function CashPage({ notify, canCloseCash = true }: { notify: (message: string) => void; canCloseCash?: boolean }) {
  const [sessions, setSessions] = useState<CashSessionRecord[]>([])
  const [opening, setOpening] = useState(false)
  const [closing, setClosing] = useState<CashSessionRecord | null>(null)
  const [movementOpen, setMovementOpen] = useState<'income' | 'expense' | null>(null)
  const { refresh: refreshCashSession } = useCashSession()
  const load = () => cashService.list().then(setSessions)
  useEffect(() => { void load() }, [])
  const active = sessions.find((session) => session.status === 'open')
  const expected = active ? cashService.expected(active) : 0
  const byMethod = active?.movements.reduce((result, movement) => ({ ...result, [movement.method]: (result[movement.method] || 0) + (movement.type === 'income' ? movement.amountCents : -movement.amountCents) }), {} as Record<string,number>) ?? {}
  const open = async (amount: number) => {
    await sensitiveOperations.execute('open_cash','Caja Tienda',()=>cashService.open(amount))
    setOpening(false)
    await load()
    await refreshCashSession()
    notify(featureFlags.supabase ? 'Sesión de caja abierta' : 'Sesión de caja abierta en modo mock')
  }
  const close = async (counted: number) => {
    if (!closing) return
    const result = await sensitiveOperations.execute('close_cash',closing.id,()=>cashService.close(closing.id, counted))
    setClosing(null)
    await load()
    await refreshCashSession()
    if (featureFlags.supabase && result.differenceCents != null) {
      const diff = result.differenceCents
      notify(diff === 0 ? 'Caja cerrada — cuadrada' : diff > 0 ? `Caja cerrada — sobrante de ${formatMoney(money(diff))}` : `Caja cerrada — faltante de ${formatMoney(money(Math.abs(diff)))}`)
    } else {
      notify('Cierre guardado en historial local')
    }
  }
  const movement = async (type: 'income' | 'expense', amountCents: number, method: 'cash' | 'qr' | 'transfer', note: string) => {
    if (!active) return
    await cashService.addMovement(active.id, type, method, amountCents, note)
    setMovementOpen(null)
    await load()
    notify(`${type==='income'?'Ingreso':'Egreso'} registrado`)
  }
  return <FeatureShell eyebrow="CONTROL DE CAJA" title="Caja" subtitle={featureFlags.supabase ? "Apertura, movimientos y cierre reales — Caja Tienda" : "Apertura, movimientos y cierre exclusivamente simulados"}>{active ? <div className="cash-layout"><section className="cash-hero"><div><span>SESIÓN ACTIVA</span><h2>{active.register}</h2><p>Abierta {new Date(active.openedAt).toLocaleString('es-BO')}</p></div><WalletCards /><footer><span>Efectivo esperado</span><strong>{formatMoney(money(expected))}</strong></footer></section><section className="cash-methods"><h3>Resumen por método</h3>{[['cash','Efectivo'],['qr','QR'],['transfer','Transferencia']].map(([key,label])=><div key={key}><span>{label}</span><strong>{formatMoney(money(byMethod[key] || 0))}</strong></div>)}</section><section className="cash-movements"><header><h3>Movimientos</h3><div><button onClick={()=>setMovementOpen('income')}><ArrowDownLeft /> Ingreso</button><button onClick={()=>setMovementOpen('expense')}><ArrowUpRight /> Egreso</button></div></header>{active.movements.length ? active.movements.map((movement)=><div key={movement.id}><span>{movement.note}</span><b>{movement.type==='expense'?'− ':''}{formatMoney(money(movement.amountCents))}</b></div>) : <FeatureState type="empty" text="Sin movimientos en esta sesión" />}</section><button className="close-cash-button" disabled={!canCloseCash} title={canCloseCash?undefined:'Solo un administrador puede cerrar caja'} onClick={()=>setClosing(active)}><LockKeyhole /> Cerrar caja</button></div> : <div className="cash-empty"><div><WalletCards /></div><h2>No hay una sesión activa</h2><p>Selecciona una caja e ingresa el fondo inicial para comenzar.</p><button className="primary-button" onClick={()=>setOpening(true)}>Abrir Caja Tienda</button></div>}{opening && <OpenCashModal onClose={()=>setOpening(false)} onOpen={open}/>} {closing && <CloseCashModal session={closing} expected={cashService.expected(closing)} onClose={()=>setClosing(null)} onConfirm={close}/>}{movementOpen && <MovementModal type={movementOpen} onClose={()=>setMovementOpen(null)} onConfirm={(amount,method,note)=>movement(movementOpen,amount,method,note)}/>}<section className="cash-history"><h3>Historial</h3>{sessions.filter((s)=>s.status==='closed').map((session)=><div key={session.id}><span>{session.register}<small>{new Date(session.closedAt!).toLocaleString('es-BO')}</small></span><b>{formatMoney(money(session.countedCents || 0))}</b></div>)}</section></FeatureShell>
}

function OpenCashModal({onClose,onOpen}:{onClose:()=>void;onOpen:(amount:number)=>void}) { const [amount,setAmount]=useState(50000); return <Modal title="Abrir caja" subtitle={featureFlags.supabase ? undefined : "No se registrará dinero real"} onClose={onClose}><div className="modal-body form-grid"><label className="full">Caja<select><option>{featureFlags.supabase ? 'Caja Tienda' : 'Caja 01 · Sucursal Central'}</option></select></label><label className="full">Monto inicial (Bs)<input autoFocus type="number" min="0" value={amount/100} onChange={(e)=>setAmount(Math.max(0,Math.round(Number(e.target.value)*100)))}/></label></div><footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" onClick={()=>onOpen(amount)}>Confirmar apertura</button></footer></Modal> }

function CloseCashModal({session,expected,onClose,onConfirm}:{session:CashSessionRecord;expected:number;onClose:()=>void;onConfirm:(amount:number)=>void}) { const [counted,setCounted]=useState(expected); const difference=counted-expected; return <Modal title="Cerrar caja" subtitle={session.register} onClose={onClose}><div className="modal-body close-summary"><div><span>Efectivo esperado (estimado)</span><strong>{formatMoney(money(expected))}</strong></div><label>Efectivo contado (Bs)<input autoFocus type="number" min="0" value={counted/100} onChange={(e)=>setCounted(Math.max(0,Math.round(Number(e.target.value)*100)))}/></label><div className={difference===0?'balanced':difference>0?'surplus':'shortage'}><Calculator/><span>{difference===0?'Caja cuadrada':difference>0?'Sobrante':'Faltante'}</span><strong>{formatMoney(money(Math.abs(difference)))}</strong></div></div><footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" onClick={()=>confirm(featureFlags.supabase ? '¿Confirmar cierre de caja?' : '¿Confirmar cierre de caja mock?')&&onConfirm(counted)}>Confirmar cierre</button></footer></Modal> }

function MovementModal({type,onClose,onConfirm}:{type:'income'|'expense';onClose:()=>void;onConfirm:(amountCents:number,method:'cash'|'qr'|'transfer',note:string)=>void}) {
  const [amount,setAmount]=useState(0)
  const [method,setMethod]=useState<'cash'|'qr'|'transfer'>('cash')
  const [note,setNote]=useState('')
  const valid = amount > 0
  return <Modal title={type==='income'?'Registrar ingreso':'Registrar egreso'} onClose={onClose}><div className="modal-body form-grid">
    <label className="full">Monto (Bs)<input autoFocus type="number" min="0" step="0.01" value={amount/100 || ''} onChange={(e)=>setAmount(Math.max(0,Math.round(Number(e.target.value)*100)))}/></label>
    <label className="full">Método<select value={method} onChange={(e)=>setMethod(e.target.value as 'cash'|'qr'|'transfer')}><option value="cash">Efectivo</option><option value="qr">QR</option><option value="transfer">Transferencia</option></select></label>
    <label className="full">Motivo<input type="text" value={note} onChange={(e)=>setNote(e.target.value)} placeholder={type==='income'?'Motivo del ingreso':'Motivo del egreso'}/></label>
  </div><footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!valid} onClick={()=>onConfirm(amount,method,note)}>Confirmar</button></footer></Modal>
}
