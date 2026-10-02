import { useRef, useState } from 'react'
import { Modal } from './Modal'
import { usePos } from '../context/PosContext'
import { useCashSession } from '../context/CashSessionContext'
import { cashService, sensitiveOperations } from '../infrastructure/services'
import { createUuid } from '../application/shared/createUuid'

const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Cobra y propone un anticipo sin repartirlo a deudas. Conserva la clave al reintentar. */
export function AnticipoModal({ onClose, notify }: { onClose: () => void; notify: (message: string) => void }) {
  const { customer, total } = usePos()
  const { sessionId } = useCashSession()
  const operationId = useRef(createUuid())
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
    const cajaId = sessionId
    const clienteId = customer.id
    setSubmitting(true)
    setError('')
    try {
      const amountCents = Math.round(amount * 100)
      const huella = JSON.stringify([clienteId, amountCents, method, cajaId, true])
      await sensitiveOperations.ejecutarIdempotente('register_payment', operationId.current, huella,
        idempotencyKey => cashService.registerPayment({ customerId: clienteId, amountCents, method, sessionId: cajaId, noImputar: true, idempotencyKey }))
      notify(`Anticipo de Bs ${money(amount)} registrado. Pendiente de revisión.`)
      onClose()
    } catch (err) {
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
