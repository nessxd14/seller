import { useState } from 'react'
import { useCajaAlmacen } from '../context/CajaAlmacenContext'
import { usePos } from '../context/PosContext'
import { Modal } from './Modal'
import { VtdTicketPreviewModal } from './VtdTicketPreviewModal'
import { ventaDirectaService } from '../infrastructure/services'
import type { VentaDirectaRecord } from '../application/shared/models'
import '../styles/caja-almacen.css'

const labels: Record<string, string> = { SOLICITADO: 'Pendiente de verificación de Almacén', EN_CAJA: 'Material enviado a Caja', ENTREGADO: 'Entrega confirmada', RETORNO_PENDIENTE: 'Material en retorno a Almacén', RETORNADO: 'Retorno recibido en Almacén', CANCELADO: 'Solicitud cancelada antes de salir' }
export function CajaAlmacenPanel() {
  const { record, error, busy, refresh, flush, resolve } = useCajaAlmacen()
  const { cart } = usePos()
  const [rejection, setRejection] = useState<number | null>(null)
  const [motivo, setMotivo] = useState('')
  const [referencia, setReferencia] = useState('')
  const [refunded, setRefunded] = useState(false)
  const [ticket, setTicket] = useState<VentaDirectaRecord | null>(null)
  const [localError, setLocalError] = useState('')
  const op = record?.operacion
  if (!op && !error) return null
  const paid = !!op?.comprobante
  const pending = record?.vtds.some(v => v.estado === 'SOLICITADO')
  const rejectedAll = !!record?.vtds.length && record.vtds.every(v => ['CANCELADO','RETORNO_PENDIENTE','RETORNADO'].includes(v.estado))
  const print = async (id: number) => { try { const v = await ventaDirectaService.getById(String(id)); if (!v) throw new Error('No se encontró el documento.'); setTicket(v) } catch (e) { setLocalError(e instanceof Error ? e.message : 'No se pudo abrir el QR.') } }
  return <section className="caja-almacen-panel" aria-label="Operación con Almacén">
    {op && <><strong>{paid ? 'Cobro registrado · falta resolver la entrega' : 'Continúa esta operación: VTA + Almacén'}</strong>
      <p>{paid ? 'Confirma la entrega o resuelve el rechazo.' : 'Puedes agregar productos VTA y cobrar todo junto.'}</p>
      <details><summary>Entregas, QR y rechazos ({record.vtds.length})</summary><ul>{record.vtds.map(v => <li key={v.venta_id}><div><b>{v.numero}</b><span>{labels[v.estado]}</span></div><div className="caja-almacen-buttons"><button className="secondary-button" disabled={busy} onClick={() => void print(v.venta_id)}>Ver QR</button>{['SOLICITADO','EN_CAJA'].includes(v.estado) && <button className="secondary-button" disabled={busy} onClick={() => { setRejection(v.venta_id); setMotivo(''); setReferencia(''); setRefunded(false) }}>Rechazar</button>}</div></li>)}</ul></details>
      <div className="caja-almacen-buttons">{paid && <button className="secondary-button" disabled={busy} onClick={() => void flush().then(() => refresh()).catch(e => setLocalError(e.message))}>Actualizar estado de Almacén</button>}
      {paid && <button className="primary-button" disabled={busy || pending} onClick={() => void resolve('completar')}>{busy ? 'Confirmando…' : 'Completar entrega y operación'}</button>}
      {!paid && rejectedAll && cart.length === 0 && <button className="primary-button" disabled={busy} onClick={() => void resolve('cerrar_rechazo')}>Finalizar rechazo</button>}</div></>}
    {(error || localError) && <p role="alert">{error || localError}</p>}
    {!op && error && <><p>Comprueba si la solicitud quedó registrada antes de continuar.</p><button className="secondary-button" disabled={busy} onClick={() => void refresh(true).catch(e => setLocalError(e.message))}>Consultar operación pendiente</button></>}
    {op && (error || localError) && <button className="secondary-button" disabled={busy} onClick={() => { if (window.confirm('Recuperar el estado guardado reemplaza los cambios locales sin guardar. ¿Continuar?')) void refresh(true).then(() => setLocalError('')).catch(e => setLocalError(e.message)) }}>Recuperar versión guardada</button>}
    {rejection !== null && <Modal title="Rechazar entrega de Almacén" onClose={() => { if (!busy) setRejection(null) }} escapeToClose={!busy}>
      <div className="modal-body"><p>Se rechaza la VTD completa. Los productos VTA aceptados permanecen en la operación. Si el material salió, quedará en retorno hasta que Almacén confirme su recepción.</p><label>Motivo<textarea value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={1000} disabled={busy} /></label>
      {paid && <><p>El pago original se conserva. Registra únicamente una devolución de dinero ya realizada.</p><label><input type="checkbox" checked={refunded} onChange={e => setRefunded(e.target.checked)} disabled={busy} />Confirmo que devolví el importe de esta VTD por los medios correspondientes</label><label>Referencia de devolución<input value={referencia} onChange={e => setReferencia(e.target.value)} disabled={busy} maxLength={200} /></label></>}
      {error && <p role="alert">{error}</p>}</div><footer className="modal-actions"><button className="secondary-button" disabled={busy} onClick={() => setRejection(null)}>Volver</button><button className="primary-button" disabled={busy || motivo.trim().length < 5 || (paid && (!refunded || referencia.trim().length < 3))} onClick={async () => { if (await resolve('rechazar', { venta_id: rejection, motivo: motivo.trim(), devolucion_realizada: refunded, referencia: referencia.trim() })) setRejection(null) }}>Confirmar rechazo</button></footer>
    </Modal>}
    {ticket && <VtdTicketPreviewModal venta={ticket} onClose={() => setTicket(null)} />}
  </section>
}
