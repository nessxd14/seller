import { Banknote, QrCode, Smartphone } from 'lucide-react'
import { useState } from 'react'
import { Modal } from './Modal'
import type { SaleCheckoutPayment } from '../application/ports/repositories'

const methods = [
  { id: 'cash', label: 'Efectivo', icon: Banknote },
  { id: 'qr', label: 'QR', icon: QrCode },
  { id: 'transfer', label: 'Transferencia', icon: Smartphone },
] as const

const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Brief VTD 2.1/2.2: modo precobrado — "cobra ahora". Versión reducida de PaymentModal
 * (un solo método, sin pago mixto ni crédito) porque abrir_venta solo necesita un
 * p_pagos que sume el total; el desglose fino de caja lo sigue resolviendo PaymentModal
 * en el flujo de venta normal.
 */
export function VtdPaymentModal({ total, submitting, error, onClose, onConfirm }: { total: number; submitting: boolean; error: string; onClose: () => void; onConfirm: (payments: SaleCheckoutPayment[]) => void }) {
  const [method, setMethod] = useState<'cash' | 'qr' | 'transfer'>('cash')
  return (
    <Modal title="Cobrar venta directa" subtitle="Precobrado — se cobra antes de enviar a Almacén" onClose={onClose}>
      <div className="payment-total"><span>Total a cobrar</span><strong>Bs {money(total)}</strong></div>
      <div className="modal-body">
        <label className="field-label">Método de pago</label>
        <div className="payment-methods">
          {methods.map(({ id, label, icon: Icon }) => (
            <button key={id} className={method === id ? 'active' : ''} onClick={() => setMethod(id)}><Icon /><span>{label}</span></button>
          ))}
        </div>
        {error && <p className="mock-note payment-error">{error}</p>}
      </div>
      <footer className="modal-actions">
        <button className="secondary-button" onClick={onClose}>Cancelar</button>
        <button className="primary-button" disabled={submitting} onClick={() => onConfirm([{ method, amountCents: Math.round(total * 100) }])}>{submitting ? 'Procesando…' : 'Confirmar cobro'}</button>
      </footer>
    </Modal>
  )
}
