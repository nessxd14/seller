import { Printer } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Modal } from './Modal'
import { DocQr } from './DocQr'
import { qrContentForVtd } from '../domain/documents/qrContent'
import { empresaStore as empresa } from '../config/empresaStore'
import { readDefaultPrintFormat, type PrintFormat } from './printFormat'
import type { VentaDirectaRecord } from '../application/shared/models'

const money = (cents: number) => (cents / 100).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Brief VTD 2.3 — ticket del VTD, reutilizando la infraestructura térmica del documento
 * ROARI v1.1 (mismas clases .ticket/.ticket-58/.ticket-80 y las reglas @media print de
 * workflows.css). Lleva, como mínimo: identificador (numero VTD-2026-NNNNN, ver B1),
 * QR para preparación y verificación en Almacén, marca "VENTA DIRECTA", modo PAGADO/POR
 * COBRAR bien visible, y cantidades en unidades de PRESENTACIÓN (nunca base).
 */
export function VtdTicketPreviewModal({ venta, onClose }: { venta: VentaDirectaRecord; onClose: () => void }) {
  const [format, setFormat] = useState<PrintFormat>(readDefaultPrintFormat)
  const [qrListo, setQrListo] = useState('')
  const [qrError, setQrError] = useState(false)
  const content = qrContentForVtd(venta.id)
  const ready = useCallback(() => { setQrListo(content); setQrError(false) }, [content])
  const failed = useCallback(() => setQrError(true), [])
  return (
    <Modal title="Ticket de venta directa" subtitle="Documento no fiscal" onClose={onClose}>
      <div className="print-options">
        <select value={format} onChange={(e) => setFormat(e.target.value as PrintFormat)}>
          <option value="ticket-58">Térmico 58 mm</option>
          <option value="ticket-80">Térmico 80 mm</option>
        </select>
      </div>
      <div className={`ticket ${format} ticket-vtd`}>
        <div className="vtd-badge">VENTA DIRECTA</div>
        <div className="ticket-brand">
          <strong>{empresa.razonSocial}</strong>
          <span>{empresa.direccion}</span>
          <small>{empresa.ciudad}</small>
        </div>
        <div className="ticket-meta">
          <span>{venta.numero}</span>
          <span>{new Date(venta.creadoEn).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}</span>
        </div>
        <div className={`vtd-modo-pill ${venta.modo === 'PRECOBRADO' ? 'pagado' : 'por-cobrar'}`}>
          {venta.modo === 'PRECOBRADO' ? 'PAGADO' : 'POR COBRAR'}
        </div>
        {venta.lines.map((line) => (
          <div className="ticket-line" key={line.id}>
            <span>{line.cantidadPresentacion} × {line.name}{line.presentacionNombre ? ` (${line.presentacionNombre})` : ''}</span>
            <strong>{money(line.precioUnitarioCents * line.cantidadPresentacion)}</strong>
          </div>
        ))}
        <div className="ticket-totals">
          <div><span>Subtotal</span><span>Bs {money(venta.subtotalCents)}</span></div>
          <div><span>Descuento</span><span>− Bs {money(venta.discountCents)}</span></div>
          <div><strong>TOTAL</strong><strong>Bs {money(venta.totalCents)}</strong></div>
        </div>
        <div className="vtd-barcode-wrap">
          <DocQr content={content} className="vtd-documento-qr" resolution={320} margin={4} onReady={ready} onError={failed} />
          <small>{venta.numero}</small>
        </div>
        <p>Entregar contra este ticket en Almacén Central</p>
      </div>
      <footer className="modal-actions">
        {qrError && <span role="alert">No se pudo generar el QR. Cierra y vuelve a abrir el ticket.</span>}
        <button className="secondary-button" onClick={onClose}>Cerrar</button>
        <button className="primary-button" disabled={qrListo !== content || qrError} onClick={() => window.print()}><Printer /> {qrListo === content ? 'Imprimir' : 'Preparando QR…'}</button>
      </footer>
    </Modal>
  )
}
