import { Banknote, QrCode, Shuffle, Smartphone } from 'lucide-react'
import { useState } from 'react'
import { Modal } from './Modal'
import { NumberField } from './NumberField'
import type { SaleCheckoutPayment } from '../application/ports/repositories'
import type { VtdPorCobrar } from '../application/shared/models'

const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const methods = [
  { id: 'efectivo', label: 'Efectivo', icon: Banknote },
  { id: 'qr', label: 'QR', icon: QrCode },
  { id: 'transferencia', label: 'Transferencia', icon: Smartphone },
  { id: 'mixto', label: 'Pago mixto', icon: Shuffle },
]

/**
 * Brief Caja VTD tarea 3: pago del cobro de VTD — mismo diseño de métodos/pago mixto que
 * PaymentModal (brief: "PaymentModal (pago mixto permitido)"), pero sin acoplarse al
 * carrito de usePos ni a saleService.checkout — este confirma contra cobrar_vtd, un total
 * fijo (la suma de los VTD elegidos), nunca editable acá.
 */
export function CobrarVtdPaymentModal({ ventas, submitting, error, onClose, onConfirm }: { ventas: VtdPorCobrar[]; submitting: boolean; error: string; onClose: () => void; onConfirm: (payments: SaleCheckoutPayment[]) => void }) {
  const total = ventas.reduce((sum, v) => sum + v.totalBs, 0)
  const [method, setMethod] = useState('efectivo')
  const [received, setReceived] = useState(total)
  const [mixedCash, setMixedCash] = useState(0)
  const [mixedCashRecibido, setMixedCashRecibido] = useState(0)
  const [mixedMethod, setMixedMethod] = useState<'qr' | 'transferencia'>('qr')
  const [mixedDigital, setMixedDigital] = useState(total)
  const mixedSum = Math.round((mixedCash + mixedDigital + Number.EPSILON) * 100) / 100
  const mixedRecibidoInsuficiente = mixedCashRecibido > 0 && mixedCashRecibido < mixedCash
  const paymentValid = method === 'mixto' ? Math.abs(mixedSum - total) < 0.005 && !mixedRecibidoInsuficiente : received >= total

  const posMethod = (id: string): 'cash' | 'qr' | 'transfer' => (id === 'qr' ? 'qr' : id === 'transferencia' ? 'transfer' : 'cash')

  const buildPayments = (): SaleCheckoutPayment[] => {
    if (method === 'mixto') {
      const payments: SaleCheckoutPayment[] = []
      if (mixedCash > 0) payments.push({ method: 'cash', amountCents: Math.round(mixedCash * 100), ...(mixedCashRecibido > 0 ? { receivedCents: Math.round(mixedCashRecibido * 100) } : {}) })
      if (mixedDigital > 0) payments.push({ method: posMethod(mixedMethod), amountCents: Math.round(mixedDigital * 100) })
      return payments
    }
    return [{ method: posMethod(method), amountCents: Math.round(total * 100), ...(method === 'efectivo' ? { receivedCents: Math.round(received * 100) } : {}) }]
  }

  return (
    <Modal title="Cobrar VTD" subtitle={`${ventas.length} venta${ventas.length > 1 ? 's' : ''} directa${ventas.length > 1 ? 's' : ''} seleccionada${ventas.length > 1 ? 's' : ''}`} onClose={onClose} wide>
      <div className="payment-total"><span>Total a cobrar</span><strong>Bs {money(total)}</strong></div>
      <div className="modal-body">
        <label className="field-label">Método de pago</label>
        <div className="payment-methods">{methods.map(({ id, label, icon: Icon }) => <button key={id} className={method === id ? 'active' : ''} onClick={() => setMethod(id)}><Icon /><span>{label}</span></button>)}</div>
        {method === 'mixto'
          ? <>
              <div className="mixed-fields">
                <label>Efectivo (Bs)<NumberField min={0} step={0.01} value={mixedCash} onCommit={setMixedCash} /></label>
                <label>Recibido en efectivo (Bs)<NumberField min={0} step={0.01} value={mixedCashRecibido} onCommit={setMixedCashRecibido} /></label>
                <label>{mixedMethod === 'qr' ? 'QR' : 'Transferencia'} (Bs)<div className="mixed-method-row"><select value={mixedMethod} onChange={(e) => setMixedMethod(e.target.value as 'qr' | 'transferencia')}><option value="qr">QR</option><option value="transferencia">Transferencia</option></select><NumberField min={0} step={0.01} value={mixedDigital} onCommit={setMixedDigital} /></div></label>
              </div>
              {mixedRecibidoInsuficiente && <p className="mock-note payment-error">El recibido no puede ser menor al efectivo</p>}
              <div className={`mixed-status ${paymentValid ? 'valid' : ''}`}><span>Suma del pago</span><strong>Bs {money(mixedSum)}</strong><small>{Math.abs(mixedSum - total) >= 0.005 ? `Faltan Bs ${money(Math.max(0, total - mixedSum))}` : 'El monto coincide con el total'}</small></div>
            </>
          : <div className="payment-fields"><label>Monto recibido (Bs)<NumberField min={0} step={0.01} value={received} onCommit={setReceived} /></label><div><span>{method === 'efectivo' ? 'Cambio' : 'Diferencia'}</span><strong>Bs {money(method === 'efectivo' ? Math.max(0, received - total) : Math.max(0, total - received))}</strong></div></div>}
        {error && <p className="mock-note payment-error">{error}</p>}
      </div>
      <footer className="modal-actions">
        <button className="secondary-button" onClick={onClose}>Cancelar</button>
        <button className="primary-button" disabled={!paymentValid || submitting} onClick={() => onConfirm(buildPayments())}>{submitting ? 'Procesando…' : 'Confirmar cobro'}</button>
      </footer>
    </Modal>
  )
}
