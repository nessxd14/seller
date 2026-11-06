import { Printer } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TransferMotivo, TransferRecord } from '../application/shared/models'
import { DocQr } from '../components/DocQr'
import { Modal } from '../components/Modal'
import { readDefaultPrintFormat, type PrintFormat } from '../components/printFormat'
import { empresaStore as empresa, loadEmpresaConfig } from '../config/empresaStore'
import { contenidoQrTraslado } from './qrTraslado'

// Igual que TrasladoTargetPicker: 1 = Almacén Central, 2 = Tienda.
const SUCURSAL: Record<number, string> = { 1: 'Almacén Central', 2: 'Tienda' }
const MOTIVO: Record<TransferMotivo, string> = { REPOSICION: 'Reposición', VENTA_DIRECTA: 'Venta directa', DEVOLUCION: 'Devolución' }

/**
 * Ticket térmico de la solicitud TRA recién creada, con el mismo QR que Almacén usa para
 * alistar y para recibir (una persona alista, otra confirma la recepción con el mismo QR).
 * Mismas clases .ticket/.ticket-58/.ticket-80 que el ticket de la VTD: imprime solo el ticket,
 * e Imprimir espera a que el QR esté dibujado.
 */
export function TrasladoTicketMovil({ traslado, onClose }: { traslado: TransferRecord; onClose: () => void }) {
  const [format, setFormat] = useState<PrintFormat>(readDefaultPrintFormat)
  const qr = useMemo(() => contenidoQrTraslado(traslado.id), [traslado.id])
  const [qrListo, setQrListo] = useState('')
  const [qrFallo, setQrFallo] = useState(false)
  useEffect(() => { void loadEmpresaConfig() }, [])
  const enlace = qr.ok ? qr.enlace : ''
  const listo = useCallback(() => { setQrListo(enlace); setQrFallo(false) }, [enlace])
  const fallo = useCallback(() => setQrFallo(true), [])
  const unidadesBase = traslado.lines.reduce((n, l) => n + l.cantidadBase, 0)
  const puedeImprimir = qr.ok && qrListo === enlace && !qrFallo

  return <Modal title="Ticket de traslado" subtitle={`${traslado.numero} · solicitud creada`} onClose={onClose}>
    <div className="print-options">
      <select value={format} onChange={(e) => setFormat(e.target.value as PrintFormat)} aria-label="Formato de impresión">
        <option value="ticket-58">Térmico 58 mm</option>
        <option value="ticket-80">Térmico 80 mm</option>
      </select>
    </div>
    <div className={`ticket ${format} ticket-traslado`}>
      <div className="vtd-badge">TRASLADO</div>
      <div className="ticket-brand">
        <strong>{empresa.razonSocial}</strong>
        <span>{empresa.direccion}</span>
        <small>{empresa.ciudad}</small>
      </div>
      <div className="ticket-meta">
        <span>{traslado.numero}</span>
        <span>{new Date(traslado.creadoEn || traslado.solicitadoEn).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}</span>
      </div>
      <div className="ticket-line">
        <span>{SUCURSAL[traslado.sucursalOrigenId] ?? `Sucursal ${traslado.sucursalOrigenId}`} → {SUCURSAL[traslado.sucursalDestinoId] ?? `Sucursal ${traslado.sucursalDestinoId}`}</span>
        <strong>{MOTIVO[traslado.motivo]}</strong>
      </div>
      {traslado.lines.map((l) => <div className="ticket-line" key={l.id}>
        <span>{l.cantidadPresentacion != null && l.presentacionNombre ? `${l.cantidadPresentacion} × ${l.name} (${l.presentacionNombre})` : `${l.cantidadBase} × ${l.name}`}</span>
      </div>)}
      <div className="ticket-totals">
        <div><span>Líneas</span><span>{traslado.lines.length}</span></div>
        <div><strong>UNIDADES BASE</strong><strong>{unidadesBase.toLocaleString('es-BO')}</strong></div>
      </div>
      {qr.ok
        ? <div className="vtd-barcode-wrap">
          <DocQr content={enlace} className="vtd-documento-qr" resolution={320} margin={4} onReady={listo} onError={fallo} />
          <small>{traslado.numero}</small>
        </div>
        : <p role="alert">{qr.error}</p>}
      <p>Almacén alista con este QR; quien recibe confirma con el mismo QR.</p>
      {traslado.solicitadoPor && <p>Solicitó: {traslado.solicitadoPor}</p>}
    </div>
    <footer className="modal-actions">
      {qrFallo && <span role="alert">No se pudo generar el QR. Cierra y vuelve a abrir el ticket.</span>}
      {qr.ok && <a className="secondary-button" href={enlace} target="_blank" rel="noreferrer">Abrir en Almacén</a>}
      <button className="secondary-button" onClick={onClose}>Cerrar</button>
      <button className="primary-button" disabled={!puedeImprimir} onClick={() => window.print()}><Printer /> {!qr.ok ? 'Sin QR' : qrListo === enlace ? 'Imprimir' : 'Preparando QR…'}</button>
    </footer>
  </Modal>
}
