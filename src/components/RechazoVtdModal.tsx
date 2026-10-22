import { useState } from 'react'
import { Modal } from './Modal'

export interface RechazoVtdData { motivo: string; devolucion_realizada: boolean; referencia: string }

export function RechazoVtdModal({ ventaNumero, paid, busy, error, onCancel, onConfirm }: { ventaNumero?: string; paid: boolean; busy: boolean; error?: string; onCancel: () => void; onConfirm: (data: RechazoVtdData) => void | Promise<void> }) {
  const [motivo, setMotivo] = useState('')
  const [referencia, setReferencia] = useState('')
  const [refunded, setRefunded] = useState(false)
  return <Modal title="Rechazar entrega de Almacén" subtitle={ventaNumero} onClose={() => { if (!busy) onCancel() }} escapeToClose={!busy}>
    <div className="modal-body"><p>Se rechaza la VTD completa. Los productos VTA aceptados permanecen en la operación. Si el material salió, quedará en retorno hasta que Almacén confirme su recepción.</p><label>Motivo<textarea value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={1000} disabled={busy} /></label>
    {paid && <><p>El pago original se conserva. Registra únicamente una devolución de dinero ya realizada.</p><label><input type="checkbox" checked={refunded} onChange={e => setRefunded(e.target.checked)} disabled={busy} />Confirmo que devolví el importe de esta VTD por los medios correspondientes</label><label>Referencia de devolución<input value={referencia} onChange={e => setReferencia(e.target.value)} disabled={busy} maxLength={200} /></label></>}
    {error && <p role="alert">{error}</p>}</div><footer className="modal-actions"><button className="secondary-button" disabled={busy} onClick={onCancel}>Volver</button><button className="primary-button" disabled={busy || motivo.trim().length < 5 || (paid && (!refunded || referencia.trim().length < 3))} onClick={() => void onConfirm({ motivo: motivo.trim(), devolucion_realizada: refunded, referencia: referencia.trim() })}>Confirmar rechazo</button></footer>
  </Modal>
}
