import { Printer } from 'lucide-react'
import { useState } from 'react'
import { usePos } from '../context/PosContext'
import { Modal } from './Modal'
import { calculateLineTotal } from '../domain/sales/cartCalculator'
import { moneyToDecimal } from '../domain/common/money'
import { empresaStore as empresa } from '../config/empresaStore'
import { readDefaultPrintFormat, type PrintFormat } from './printFormat'

const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function TicketPreviewModal({ onClose }: { onClose: () => void }) {
  const { cart, subtotal, discount, total, operationNumber } = usePos()
  // Initializes from the Configuración > Impresión default (localStorage), but this
  // dropdown still overrides it for a single print — the page sets the default only.
  const [format,setFormat]=useState<PrintFormat>(readDefaultPrintFormat)
  const [reprint,setReprint]=useState(false)
  return <Modal title="Vista previa del ticket" subtitle="Documento no fiscal" onClose={onClose}><div className="print-options"><select value={format} onChange={(e)=>setFormat(e.target.value as typeof format)}><option value="ticket-58">Térmico 58 mm</option><option value="ticket-80">Térmico 80 mm</option></select><label><input type="checkbox" checked={reprint} onChange={(e)=>setReprint(e.target.checked)}/> Marcar reimpresión</label></div><div className={`ticket ${format}`}>{reprint&&<div className="reprint-mark">REIMPRESIÓN</div>}<div className="ticket-brand"><strong>{empresa.razonSocial}</strong><span>{empresa.direccion}</span><small>{empresa.ciudad}</small></div><div className="ticket-meta"><span>Operación #{operationNumber}</span><span>{new Date().toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}</span></div>{cart.map((item) => <div className="ticket-line" key={item.id}><span>{item.cantidad} × {item.nombre}{item.presentacionNombre && item.factorUnidadBase !== 1 ? ` (${item.presentacionNombre})` : ''}</span><strong>{money(moneyToDecimal(calculateLineTotal({ unitPrice: item.precioAplicado, quantity: item.cantidad, discountPercent: item.descuento })))}</strong></div>)}<div className="ticket-totals"><div><span>Subtotal</span><span>Bs {money(subtotal)}</span></div><div><span>Descuento</span><span>− Bs {money(discount)}</span></div><div><strong>TOTAL</strong><strong>Bs {money(total)}</strong></div></div><p>¡Gracias por elegir {empresa.razonSocial}!</p></div><footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cerrar</button><button className="primary-button" onClick={() => window.print()}><Printer /> Imprimir</button></footer></Modal>
}
