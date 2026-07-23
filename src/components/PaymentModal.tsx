import { Banknote, CreditCard, QrCode, Shuffle, Smartphone } from 'lucide-react'
import { useState } from 'react'
import { usePos } from '../context/PosContext'
import { Modal } from './Modal'

const methods = [{ id: 'efectivo', label: 'Efectivo', icon: Banknote }, { id: 'qr', label: 'QR', icon: QrCode }, { id: 'transferencia', label: 'Transferencia', icon: Smartphone }, { id: 'credito', label: 'Crédito', icon: CreditCard }, { id: 'mixto', label: 'Pago mixto', icon: Shuffle }]
const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function PaymentModal({ onClose }: { onClose: () => void }) {
  const { total, newOperation } = usePos()
  const [method, setMethod] = useState('efectivo')
  const [received, setReceived] = useState(total)
  const [mixedCash, setMixedCash] = useState(0)
  const [mixedDigital, setMixedDigital] = useState(total)
  const [done, setDone] = useState(false)
  const mixedSum = Math.round((mixedCash + mixedDigital + Number.EPSILON) * 100) / 100
  const paymentValid = method === 'mixto' ? Math.abs(mixedSum - total) < 0.005 : received >= total
  if (done) return <Modal title="¡Cobro confirmado!" subtitle="Operación completada localmente" onClose={() => { newOperation(); onClose() }}><div className="success-state"><span>✓</span><h3>Bs {money(total)}</h3><p>Esta es una simulación. No se registró ningún pago real.</p></div><footer className="modal-actions"><button className="primary-button full-button" onClick={() => { newOperation(); onClose() }}>Finalizar y nueva operación</button></footer></Modal>
  return <Modal title="Registrar cobro" subtitle="Selecciona un método de pago" onClose={onClose} wide><div className="payment-total"><span>Total a cobrar</span><strong>Bs {money(total)}</strong></div><div className="modal-body"><label className="field-label">Método de pago</label><div className="payment-methods">{methods.map(({ id, label, icon: Icon }) => <button key={id} className={method === id ? 'active' : ''} onClick={() => setMethod(id)}><Icon /><span>{label}</span></button>)}</div>{method === 'mixto' ? <><div className="mixed-fields"><label>Efectivo (Bs)<input type="number" min="0" step="0.01" value={mixedCash} onChange={(e) => setMixedCash(Math.max(0, Number(e.target.value)))} /></label><label>QR / transferencia (Bs)<input type="number" min="0" step="0.01" value={mixedDigital} onChange={(e) => setMixedDigital(Math.max(0, Number(e.target.value)))} /></label></div><div className={`mixed-status ${paymentValid ? 'valid' : ''}`}><span>Suma del pago</span><strong>Bs {money(mixedSum)}</strong><small>{paymentValid ? 'El monto coincide con el total' : `Faltan Bs ${money(Math.max(0, total - mixedSum))}`}</small></div></> : <div className="payment-fields"><label>Monto recibido (Bs)<input type="number" min="0" step="0.01" value={received} onChange={(e) => setReceived(Math.max(0, Number(e.target.value)))} /></label><div><span>{method === 'efectivo' ? 'Cambio' : 'Diferencia'}</span><strong>Bs {money(method === 'efectivo' ? Math.max(0, received - total) : Math.max(0, total - received))}</strong></div></div>}<p className="mock-note">Modo demostración: el pago no tendrá efecto contable ni movimiento de caja.</p></div><footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!paymentValid} onClick={() => setDone(true)}>Confirmar cobro</button></footer></Modal>
}
