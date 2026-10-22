import { useState } from 'react'
import { useCajaAlmacen } from '../context/CajaAlmacenContext'
import { usePos } from '../context/PosContext'
import { RechazoVtdModal } from './RechazoVtdModal'
import { VtdTicketPreviewModal } from './VtdTicketPreviewModal'
import { ventaDirectaService } from '../infrastructure/services'
import type { VentaDirectaRecord } from '../application/shared/models'
import { vtdEstadoLabels } from '../application/shared/cajaAlmacen'
import '../styles/caja-almacen.css'

export function CajaAlmacenPanel() {
  const { record, error, busy, refresh, flush, resolve } = useCajaAlmacen()
  const { cart } = usePos()
  const [rejection, setRejection] = useState<number | null>(null)
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
      <details><summary>Entregas, QR y rechazos ({record.vtds.length})</summary><ul>{record.vtds.map(v => <li key={v.venta_id}><div><b>{v.numero}</b><span>{vtdEstadoLabels[v.estado]}</span></div><div className="caja-almacen-buttons"><button className="secondary-button" disabled={busy} onClick={() => void print(v.venta_id)}>Ver QR</button>{['SOLICITADO','EN_CAJA'].includes(v.estado) && <button className="secondary-button" disabled={busy} onClick={() => { setRejection(v.venta_id) }}>Rechazar</button>}</div></li>)}</ul></details>
      <div className="caja-almacen-buttons">{paid && <button className="secondary-button" disabled={busy} onClick={() => void flush().then(() => refresh()).catch(e => setLocalError(e.message))}>Actualizar estado de Almacén</button>}
      {paid && <button className="primary-button" disabled={busy || pending} onClick={() => void resolve('completar')}>{busy ? 'Confirmando…' : 'Completar entrega y operación'}</button>}
      {!paid && rejectedAll && cart.length === 0 && <button className="primary-button" disabled={busy} onClick={() => void resolve('cerrar_rechazo')}>Finalizar rechazo</button>}</div></>}
    {(error || localError) && <p role="alert">{error || localError}</p>}
    {!op && error && <><p>Comprueba si la solicitud quedó registrada antes de continuar.</p><button className="secondary-button" disabled={busy} onClick={() => void refresh(true).catch(e => setLocalError(e.message))}>Consultar operación pendiente</button></>}
    {op && (error || localError) && <button className="secondary-button" disabled={busy} onClick={() => { if (window.confirm('Recuperar el estado guardado reemplaza los cambios locales sin guardar. ¿Continuar?')) void refresh(true).then(() => setLocalError('')).catch(e => setLocalError(e.message)) }}>Recuperar versión guardada</button>}
    {rejection !== null && <RechazoVtdModal ventaNumero={record?.vtds.find(v => v.venta_id === rejection)?.numero} paid={paid} busy={busy} error={error} onCancel={() => setRejection(null)}
      onConfirm={async data => { if (await resolve('rechazar', { venta_id: rejection, ...data })) setRejection(null) }} />}
    {ticket && <VtdTicketPreviewModal venta={ticket} onClose={() => setTicket(null)} />}
  </section>
}
