import { useState } from 'react'
import { Modal } from './Modal'

export interface RechazoVtdData { motivo: string; devolucion_realizada: boolean; referencia: string }

// Cobrada: o se devolvió el dinero (con referencia), o el banco rechazó el pago QR/transferencia
// y no hay nada que devolver. La base valida esto último: si el pago no figura como rechazado,
// responde «Confirma la devolución realizada…» y el error se muestra aquí.
type Resolucion = 'devuelto' | 'pago_rechazado' | null

export function RechazoVtdModal({ ventaNumero, paid, busy, error, onCancel, onConfirm }: { ventaNumero?: string; paid: boolean; busy: boolean; error?: string; onCancel: () => void; onConfirm: (data: RechazoVtdData) => void | Promise<void> }) {
  const [motivo, setMotivo] = useState('')
  const [referencia, setReferencia] = useState('')
  const [resolucion, setResolucion] = useState<Resolucion>(null)
  const refunded = resolucion === 'devuelto'
  const pagoRechazado = resolucion === 'pago_rechazado'
  const pagoResuelto = refunded ? referencia.trim().length >= 3 : pagoRechazado
  const confirmar = () => void onConfirm(pagoRechazado
    ? { motivo: motivo.trim(), devolucion_realizada: false, referencia: '' }
    : { motivo: motivo.trim(), devolucion_realizada: refunded, referencia: referencia.trim() })
  return <Modal title="Rechazar entrega de Almacén" subtitle={ventaNumero} onClose={() => { if (!busy) onCancel() }} escapeToClose={!busy}>
    <div className="modal-body"><p>Se rechaza la VTD completa. Los productos VTA aceptados permanecen en la operación. Si el material salió, quedará en retorno hasta que Almacén confirme su recepción.</p><label>Motivo<textarea value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={1000} disabled={busy} /></label>
    {paid && <><p>El pago original se conserva. Registra únicamente una devolución de dinero ya realizada.</p>
      <label><input type="radio" name="rechazo-vtd-pago" checked={refunded} onChange={() => setResolucion('devuelto')} disabled={busy} />Confirmo que devolví el importe de esta VTD por los medios correspondientes</label>
      {refunded && <label>Referencia de devolución<input value={referencia} onChange={e => setReferencia(e.target.value)} disabled={busy} maxLength={200} /></label>}
      <label><input type="radio" name="rechazo-vtd-pago" checked={pagoRechazado} onChange={() => setResolucion('pago_rechazado')} disabled={busy} />El pago QR/transferencia fue rechazado por el banco — no hay nada que devolver</label></>}
    {error && <p role="alert">{error}</p>}</div><footer className="modal-actions"><button className="secondary-button" disabled={busy} onClick={onCancel}>Volver</button><button className="primary-button" disabled={busy || motivo.trim().length < 5 || (paid && !pagoResuelto)} onClick={confirmar}>Confirmar rechazo</button></footer>
  </Modal>
}
