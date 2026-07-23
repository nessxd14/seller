import { ArrowDownLeft, ArrowUpRight, Calculator, LockKeyhole, WalletCards } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CashSessionRecord } from '../../application/shared/models'
import { cashService, sensitiveOperations } from '../../infrastructure/mock/services'
import { formatMoney, money } from '../../domain/common/money'
import { FeatureShell, FeatureState } from '../shared/FeatureShell'
import { Modal } from '../../components/Modal'

export function CashPage({ notify }: { notify: (message: string) => void }) {
  const [sessions, setSessions] = useState<CashSessionRecord[]>([])
  const [opening, setOpening] = useState(false)
  const [closing, setClosing] = useState<CashSessionRecord | null>(null)
  const load = () => cashService.list().then(setSessions)
  useEffect(() => { void load() }, [])
  const active = sessions.find((session) => session.status === 'open')
  const expected = active ? cashService.expected(active) : 0
  const byMethod = active?.movements.reduce((result, movement) => ({ ...result, [movement.method]: (result[movement.method] || 0) + (movement.type === 'income' ? movement.amountCents : -movement.amountCents) }), {} as Record<string,number>) ?? {}
  const open = async (amount: number) => { await sensitiveOperations.execute('open_cash','Caja 01',()=>cashService.open('Caja 01 · Sucursal Central', amount)); setOpening(false); await load(); notify('Sesión de caja abierta en modo mock') }
  const close = async (counted: number) => { if (!closing) return; await sensitiveOperations.execute('close_cash',closing.id,()=>cashService.close(closing, counted)); setClosing(null); await load(); notify('Cierre guardado en historial local') }
  const movement = async (type: 'income' | 'expense') => {
    if (!active) return
    const amount=Number(prompt(`Monto del ${type==='income'?'ingreso':'egreso'} simulado en Bs`, '0'))
    if (!Number.isFinite(amount) || amount<=0) { notify('Ingresa un monto válido'); return }
    const note=prompt('Motivo del movimiento','Movimiento manual mock') || ''
    await cashService.addMovement(active,type,Math.round(amount*100),note)
    await load()
    notify(`${type==='income'?'Ingreso':'Egreso'} simulado registrado`)
  }
  return <FeatureShell eyebrow="CONTROL DE CAJA" title="Caja" subtitle="Apertura, movimientos y cierre exclusivamente simulados">{active ? <div className="cash-layout"><section className="cash-hero"><div><span>SESIÓN ACTIVA</span><h2>{active.register}</h2><p>Abierta {new Date(active.openedAt).toLocaleString('es-BO')}</p></div><WalletCards /><footer><span>Efectivo esperado</span><strong>{formatMoney(money(expected))}</strong></footer></section><section className="cash-methods"><h3>Resumen por método</h3>{[['cash','Efectivo'],['qr','QR'],['transfer','Transferencia']].map(([key,label])=><div key={key}><span>{label}</span><strong>{formatMoney(money(byMethod[key] || 0))}</strong></div>)}</section><section className="cash-movements"><header><h3>Movimientos simulados</h3><div><button onClick={()=>movement('income')}><ArrowDownLeft /> Ingreso</button><button onClick={()=>movement('expense')}><ArrowUpRight /> Egreso</button></div></header>{active.movements.length ? active.movements.map((movement)=><div key={movement.id}><span>{movement.note}</span><b>{movement.type==='expense'?'− ':''}{formatMoney(money(movement.amountCents))}</b></div>) : <FeatureState type="empty" text="Sin movimientos en esta sesión" />}</section><button className="close-cash-button" onClick={()=>setClosing(active)}><LockKeyhole /> Cerrar caja</button></div> : <div className="cash-empty"><div><WalletCards /></div><h2>No hay una sesión activa</h2><p>Selecciona una caja e ingresa el fondo inicial para comenzar.</p><button className="primary-button" onClick={()=>setOpening(true)}>Abrir Caja 01</button></div>}{opening && <OpenCashModal onClose={()=>setOpening(false)} onOpen={open}/>} {closing && <CloseCashModal session={closing} expected={cashService.expected(closing)} onClose={()=>setClosing(null)} onConfirm={close}/>}<section className="cash-history"><h3>Historial local</h3>{sessions.filter((s)=>s.status==='closed').map((session)=><div key={session.id}><span>{session.register}<small>{new Date(session.closedAt!).toLocaleString('es-BO')}</small></span><b>{formatMoney(money(session.countedCents || 0))}</b></div>)}</section></FeatureShell>
}

function OpenCashModal({onClose,onOpen}:{onClose:()=>void;onOpen:(amount:number)=>void}) { const [amount,setAmount]=useState(50000); return <Modal title="Abrir caja" subtitle="No se registrará dinero real" onClose={onClose}><div className="modal-body form-grid"><label className="full">Caja<select><option>Caja 01 · Sucursal Central</option></select></label><label className="full">Monto inicial (Bs)<input autoFocus type="number" min="0" value={amount/100} onChange={(e)=>setAmount(Math.max(0,Math.round(Number(e.target.value)*100)))}/></label></div><footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" onClick={()=>onOpen(amount)}>Confirmar apertura</button></footer></Modal> }

function CloseCashModal({session,expected,onClose,onConfirm}:{session:CashSessionRecord;expected:number;onClose:()=>void;onConfirm:(amount:number)=>void}) { const [counted,setCounted]=useState(expected); const difference=counted-expected; return <Modal title="Cerrar caja" subtitle={session.register} onClose={onClose}><div className="modal-body close-summary"><div><span>Efectivo esperado</span><strong>{formatMoney(money(expected))}</strong></div><label>Efectivo contado (Bs)<input autoFocus type="number" min="0" value={counted/100} onChange={(e)=>setCounted(Math.max(0,Math.round(Number(e.target.value)*100)))}/></label><div className={difference===0?'balanced':difference>0?'surplus':'shortage'}><Calculator/><span>{difference===0?'Caja cuadrada':difference>0?'Sobrante':'Faltante'}</span><strong>{formatMoney(money(Math.abs(difference)))}</strong></div></div><footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" onClick={()=>confirm('¿Confirmar cierre de caja mock?')&&onConfirm(counted)}>Confirmar cierre</button></footer></Modal> }
