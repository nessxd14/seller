import { useState } from 'react'
import { Modal } from './Modal'
import { usePos } from '../context/PosContext'
import { useCashSession } from '../context/CashSessionContext'
import { cashService } from '../infrastructure/services'

const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * TAREA 1 (Tanda 3): registrar_anticipo acepta p_pedido_id y p_cliente_id ambos NULL-ables
 * — solo exige que venga uno de los dos. cashService.registerPayment ya llama esa RPC con
 * p_cliente_id (y p_pedido_id null cuando no se pasa orderId), así que este modal la reusa
 * en vez de duplicar la llamada — es exactamente lo que "Registrar anticipo" institucional/
 * corporativo necesita: cliente + caja abierta, sin pedido previo.
 *
 * Sin parámetro de idempotencia (no existe en registrar_anticipo, a diferencia de
 * registrar_venta) — alcanza con deshabilitar el botón mientras la promesa está en vuelo.
 */
export function AnticipoModal({ onClose, notify }: { onClose: () => void; notify: (message: string) => void }) {
  const { customer, total } = usePos()
  const { sessionId } = useCashSession()
  const [amount, setAmount] = useState(0)
  const [method, setMethod] = useState<'cash' | 'qr' | 'transfer'>('cash')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const missingReason = !customer?.id
    ? 'Seleccioná un cliente para registrar un anticipo.'
    : !sessionId
      ? 'Caja cerrada — abrí la caja para poder registrar un anticipo.'
      : ''

  const submit = async () => {
    if (missingReason || !customer?.id || !sessionId || amount <= 0 || submitting) return
    setSubmitting(true)
    setError('')
    try {
      await cashService.registerPayment({ customerId: customer.id, amountCents: Math.round(amount * 100), method, sessionId })
      notify(`Anticipo de Bs ${money(amount)} registrado`)
      onClose()
    } catch (err) {
      // Los tres mensajes que puede tirar registrar_anticipo (Monto inválido, Cliente
      // % no existe, La sesión % no está abierta) llegan tal cual en err.message.
      setError(err instanceof Error ? err.message : 'No se pudo registrar el anticipo')
    } finally {
      setSubmitting(false)
    }
  }

  return <Modal title="Registrar anticipo" subtitle={customer ? customer.name : 'Cliente de mostrador'} onClose={onClose}>
    <div className="modal-body form-grid">
      <p className="settings-note">Total del carrito, como referencia: Bs {money(total)}</p>
      <label className="full">Monto del anticipo (Bs)<input autoFocus type="number" min="0" step="0.01" value={amount || ''} placeholder="0.00" onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))} /></label>
      <label className="full">Método<select value={method} onChange={(e) => setMethod(e.target.value as 'cash' | 'qr' | 'transfer')}>
        <option value="cash">Efectivo</option>
        <option value="qr">QR</option>
        <option value="transfer">Transferencia</option>
      </select></label>
      {error && <p className="mock-note payment-error">{error}</p>}
      {!error && missingReason && <p className="mock-note">{missingReason}</p>}
    </div>
    <footer className="modal-actions">
      <button className="secondary-button" onClick={onClose}>Cancelar</button>
      <button className="primary-button" disabled={Boolean(missingReason) || amount <= 0 || submitting} onClick={() => void submit()}>{submitting ? 'Registrando…' : 'Confirmar anticipo'}</button>
    </footer>
  </Modal>
}
