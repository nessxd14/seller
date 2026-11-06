import { Printer } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { TransferMotivo } from '../application/shared/models'
import { Modal } from '../components/Modal'
import { TicketPreviewModal } from '../components/TicketPreviewModal'
import { readDefaultPrintFormat, type PrintFormat } from '../components/printFormat'
import { empresaStore as empresa, loadEmpresaConfig } from '../config/empresaStore'
import { usePos } from '../context/PosContext'
import { formatQtyWithUnit } from '../domain/sales/unitOfMeasure'
import { ventaLineTotalCents } from '../domain/sales/ventaPricing'
import type { CartItem } from '../types'

const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// Igual que TrasladoTargetPicker: 1 = Almacén Central, 2 = Tienda.
const SUCURSAL: Record<number, string> = { 1: 'Almacén Central', 2: 'Tienda' }
const MOTIVO: Record<TransferMotivo, string> = { REPOSICION: 'Reposición', VENTA_DIRECTA: 'Venta directa', DEVOLUCION: 'Devolución' }

const cantidad = (item: CartItem) => (item.isCustomItem ? formatQtyWithUnit(item.cantidad, item.unidadMedida) : String(item.cantidad))
const presentacion = (item: CartItem) => (item.presentacionNombre && item.factorUnidadBase !== 1 ? ` (${item.presentacionNombre})` : '')
const ahora = () => new Date().toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })

/**
 * Pre-ticket del carrito en el celular, según el modo de la operación:
 * - Venta (VTA): el mismo "Ticket previo" del escritorio.
 * - Venta directa (VTD) y Traslado: vista previa antes de confirmar, sin número ni QR
 *   (los asigna la base al crear la VTD o la solicitud TRA; después sale el ticket real).
 * Usa las mismas clases .ticket/.ticket-58/.ticket-80, así que imprime igual que los demás.
 */
export function PreTicketMovil({ onClose }: { onClose: () => void }) {
  const { mode } = usePos()
  if (mode === 'venta') return <TicketPreviewModal onClose={onClose} />
  return <PreTicketOperacion onClose={onClose} />
}

function PreTicketOperacion({ onClose }: { onClose: () => void }) {
  const { mode, cart, subtotal, discount, total, trasladoMotivo, trasladoOrigenId, trasladoDestinoId } = usePos()
  const [format, setFormat] = useState<PrintFormat>(readDefaultPrintFormat)
  useEffect(() => { void loadEmpresaConfig() }, [])
  const esTraslado = mode === 'traslado'
  const unidadesBase = cart.reduce((n, item) => n + item.cantidad * (item.isCustomItem ? 1 : item.factorUnidadBase ?? 1), 0)

  return <Modal title={esTraslado ? 'Pre-ticket de traslado' : 'Pre-ticket de venta directa'} subtitle="Vista previa sin número — se asigna al confirmar" onClose={onClose}>
    <div className="print-options">
      <select value={format} onChange={(e) => setFormat(e.target.value as PrintFormat)} aria-label="Formato de impresión">
        <option value="ticket-58">Térmico 58 mm</option>
        <option value="ticket-80">Térmico 80 mm</option>
      </select>
    </div>
    <div className={`ticket ${format} ${esTraslado ? 'ticket-traslado' : 'ticket-vtd'}`}>
      <div className="vtd-badge">{esTraslado ? 'TRASLADO' : 'VENTA DIRECTA'}</div>
      <div className="ticket-brand">
        <strong>{empresa.razonSocial}</strong>
        <span>{empresa.direccion}</span>
        <small>{empresa.ciudad}</small>
      </div>
      <div className="ticket-meta"><span>Pre-ticket (sin número)</span><span>{ahora()}</span></div>
      {esTraslado && <div className="ticket-line"><span>{SUCURSAL[trasladoOrigenId] ?? `Sucursal ${trasladoOrigenId}`} → {SUCURSAL[trasladoDestinoId] ?? `Sucursal ${trasladoDestinoId}`}</span><strong>{MOTIVO[trasladoMotivo]}</strong></div>}
      {cart.map((item) => <div className="ticket-line" key={item.id}>
        <span>{cantidad(item)} × {item.nombre}{presentacion(item)}</span>
        {!esTraslado && <strong>{money(ventaLineTotalCents(item) / 100)}</strong>}
      </div>)}
      <div className="ticket-totals">
        {esTraslado
          ? <>
            <div><span>Líneas</span><span>{cart.length}</span></div>
            <div><strong>UNIDADES BASE</strong><strong>{unidadesBase.toLocaleString('es-BO')}</strong></div>
          </>
          : <>
            <div><span>Subtotal</span><span>Bs {money(subtotal)}</span></div>
            <div><span>Descuento</span><span>− Bs {money(discount)}</span></div>
            <div><strong>TOTAL</strong><strong>Bs {money(total)}</strong></div>
          </>}
      </div>
      <p>{esTraslado ? 'Vista previa: el QR para Almacén sale al solicitar el traslado.' : 'Vista previa: el número y el QR para Almacén salen al confirmar la venta directa.'}</p>
    </div>
    <footer className="modal-actions">
      <button className="secondary-button" onClick={onClose}>Cerrar</button>
      <button className="primary-button" onClick={() => window.print()}><Printer /> Imprimir</button>
    </footer>
  </Modal>
}
