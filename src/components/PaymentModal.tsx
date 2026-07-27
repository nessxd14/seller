import { Banknote, CreditCard, QrCode, Shuffle, Smartphone } from 'lucide-react'
import { useState } from 'react'
import { usePos } from '../context/PosContext'
import { Modal } from './Modal'
import { featureFlags } from '../config/featureFlags'
import { useCashSession } from '../context/CashSessionContext'
import { saleService } from '../infrastructure/services'
import type { SaleCheckoutPayment } from '../application/ports/repositories'

const allMethods = [
  { id: 'efectivo', label: 'Efectivo', icon: Banknote },
  { id: 'qr', label: 'QR', icon: QrCode },
  { id: 'transferencia', label: 'Transferencia', icon: Smartphone },
  { id: 'credito', label: 'Crédito', icon: CreditCard },
  { id: 'mixto', label: 'Pago mixto', icon: Shuffle },
]
const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const posMethod = (id: string): 'cash' | 'qr' | 'transfer' => (id === 'qr' ? 'qr' : id === 'transferencia' ? 'transfer' : 'cash')

export function PaymentModal({ onClose }: { onClose: () => void }) {
  const { cart, discount, total, newOperation } = usePos()
  const { sessionId } = useCashSession()
  // Crédito has no metodo_pago equivalent in the real backend; only shown in mock mode.
  const methods = allMethods.filter((m) => m.id !== 'credito' || (featureFlags.credit && !featureFlags.supabase))
  const [method, setMethod] = useState('efectivo')
  const [received, setReceived] = useState(total)
  const [mixedCash, setMixedCash] = useState(0)
  const [mixedMethod, setMixedMethod] = useState<'qr' | 'transferencia'>('qr')
  const [mixedDigital, setMixedDigital] = useState(total)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ saleId: string; totalCents: number } | null>(null)
  const mixedSum = Math.round((mixedCash + mixedDigital + Number.EPSILON) * 100) / 100
  const paymentValid = method === 'mixto' ? Math.abs(mixedSum - total) < 0.005 : received >= total

  const buildPayments = (): SaleCheckoutPayment[] => {
    if (method === 'mixto') {
      const payments: SaleCheckoutPayment[] = []
      if (mixedCash > 0) payments.push({ method: 'cash', amountCents: Math.round(mixedCash * 100) })
      if (mixedDigital > 0) payments.push({ method: posMethod(mixedMethod), amountCents: Math.round(mixedDigital * 100) })
      return payments
    }
    return [{ method: posMethod(method), amountCents: Math.round(total * 100) }]
  }

  const confirmSupabase = async () => {
    if (!sessionId) { setError('No hay una sesión de caja abierta. Abrí la caja para poder cobrar.'); return }
    setSubmitting(true)
    setError('')
    try {
      const checkout = await saleService.checkout({
        lines: cart.map((item) => ({ productId: String(item.id), quantity: item.cantidad, unitPriceCents: Math.round(item.precioAplicado * (1 - item.descuento / 100) * 100), sourceLocation: item.ubicacion, presentacionId: item.presentacionId })),
        payments: buildPayments(),
        cashSessionId: sessionId,
        discountCents: Math.round(discount * 100),
      })
      setResult({ saleId: checkout.saleId, totalCents: checkout.totalCents })
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la venta')
    } finally {
      setSubmitting(false)
    }
  }

  const confirm = () => { if (featureFlags.supabase) void confirmSupabase(); else setDone(true) }

  if (done) return <Modal title="¡Cobro confirmado!" subtitle={featureFlags.supabase ? (result ? `Venta #${result.saleId}` : undefined) : "Operación completada localmente"} onClose={() => { newOperation(); onClose() }}><div className="success-state"><span>✓</span><h3>Bs {money(featureFlags.supabase && result ? result.totalCents / 100 : total)}</h3><p>{featureFlags.supabase ? 'Venta registrada en el backend.' : 'Esta es una simulación. No se registró ningún pago real.'}</p></div><footer className="modal-actions"><button className="primary-button full-button" onClick={() => { newOperation(); onClose() }}>Finalizar y nueva operación</button></footer></Modal>

  return <Modal title="Registrar cobro" subtitle="Selecciona un método de pago" onClose={onClose} wide><div className="payment-total"><span>Total a cobrar</span><strong>Bs {money(total)}</strong></div><div className="modal-body"><label className="field-label">Método de pago</label><div className="payment-methods">{methods.map(({ id, label, icon: Icon }) => <button key={id} className={method === id ? 'active' : ''} onClick={() => setMethod(id)}><Icon /><span>{label}</span></button>)}</div>{method === 'mixto' ? <><div className="mixed-fields"><label>Efectivo (Bs)<input type="number" min="0" step="0.01" value={mixedCash} onChange={(e) => setMixedCash(Math.max(0, Number(e.target.value)))} /></label><label>{mixedMethod === 'qr' ? 'QR' : 'Transferencia'} (Bs)<div className="mixed-method-row"><select value={mixedMethod} onChange={(e) => setMixedMethod(e.target.value as 'qr' | 'transferencia')}><option value="qr">QR</option><option value="transferencia">Transferencia</option></select><input type="number" min="0" step="0.01" value={mixedDigital} onChange={(e) => setMixedDigital(Math.max(0, Number(e.target.value)))} /></div></label></div><div className={`mixed-status ${paymentValid ? 'valid' : ''}`}><span>Suma del pago</span><strong>Bs {money(mixedSum)}</strong><small>{paymentValid ? 'El monto coincide con el total' : `Faltan Bs ${money(Math.max(0, total - mixedSum))}`}</small></div></> : <div className="payment-fields"><label>Monto recibido (Bs)<input type="number" min="0" step="0.01" value={received} onChange={(e) => setReceived(Math.max(0, Number(e.target.value)))} /></label><div><span>{method === 'efectivo' ? 'Cambio' : 'Diferencia'}</span><strong>Bs {money(method === 'efectivo' ? Math.max(0, received - total) : Math.max(0, total - received))}</strong></div></div>}{!featureFlags.supabase && <p className="mock-note">Modo demostración: el pago no tendrá efecto contable ni movimiento de caja.</p>}{featureFlags.supabase && !sessionId && <p className="mock-note">Caja cerrada — abrí la caja para poder cobrar.</p>}{error && <p className="mock-note payment-error">{error}</p>}</div><footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!paymentValid || submitting || (featureFlags.supabase && !sessionId)} onClick={confirm}>{submitting ? 'Procesando…' : 'Confirmar cobro'}</button></footer></Modal>
}
