import { useEffect, useState } from 'react'
import { Printer } from 'lucide-react'
import type { CajaReceipt } from '../application/shared/cajaCheckout'
import { saleService, turnoService } from '../infrastructure/services'
import { empresaStore as empresa, loadEmpresaConfig } from '../config/empresaStore'
import { Modal } from './Modal'
import { readDefaultPrintFormat, type PrintFormat } from './printFormat'

const bs = (n: number) => n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export function CajaTicket({ receipt, onClose }: { receipt: CajaReceipt; onClose: () => void }) {
  const [format, setFormat] = useState<PrintFormat>(readDefaultPrintFormat)
  const [status, setStatus] = useState<'loading'|'ready'|'pending'|'rejected'|'cancelled'|'error'>('loading')
  const [bankOnline, setBankOnline] = useState<boolean | null>(null)
  const [now, setNow] = useState(Date.now)
  useEffect(() => { void loadEmpresaConfig() }, [])
  useEffect(() => {
    let active = true
    void turnoService.estadoBancoQr().then(state => { if (active) setBankOnline(state.enLinea) }).catch(() => { if (active) setBankOnline(false) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    let active = true
    const check = async () => {
      if (active) setNow(Date.now())
      try {
        const tickets = await Promise.all(receipt.saleIds.map(id => saleService.getTicket(id)))
        if (!active) return
        setStatus(tickets.some(t => !t) ? 'error' : tickets.some(t => t?.estado === 'ANULADA') ? 'cancelled' : tickets.some(t => t?.pagos.some(p => p.estadoVerificacion === 'RECHAZADO')) ? 'rejected' : tickets.some(t => t?.pagos.some(p => p.estadoVerificacion === 'PENDIENTE')) ? 'pending' : 'ready')
      } catch { if (active) setStatus('error') }
    }
    void check()
    const interval = window.setInterval(() => void check(), 5000)
    return () => { active = false; window.clearInterval(interval) }
  }, [receipt.saleIds])
  const qrWaiting = status === 'pending' && receipt.pagos.some(p => p.metodo === 'QR') && bankOnline !== false && now - Date.parse(receipt.creadoEn) < 90_000
  return <Modal title={`Comprobante ${receipt.numero}`} subtitle="Documento no fiscal · cobro único" onClose={onClose}>
    <div className="print-options"><select aria-label="Formato del comprobante" value={format} onChange={e => setFormat(e.target.value as PrintFormat)}><option value="ticket-58">Térmico 58 mm</option><option value="ticket-80">Térmico 80 mm</option></select></div>
    <div className={`ticket ${format}`}>
      <div className="ticket-brand"><strong>{empresa.razonSocial}</strong><span>{empresa.direccion}</span><small>{empresa.ciudad}</small></div>
      <div className="ticket-meta"><strong>{receipt.numero}</strong><span>{new Date(receipt.creadoEn).toLocaleString('es-BO')}</span></div>
      {receipt.cliente && <p>Cliente: {receipt.cliente}</p>}{receipt.vendedor && <p>Venta realizada por: {receipt.vendedor}</p>}
      {receipt.lineas.map((l,i) => <div className="ticket-line" key={i}><span>{l.cantidad} × {l.descripcion}<small className="checkout-origin">{l.origen}</small></span><strong>{bs(l.subtotal)}</strong></div>)}
      <div className="ticket-totals">{receipt.discountCents > 0 && <div><span>Descuento de mostrador</span><span>Bs {bs(receipt.discountCents/100)}</span></div>}<div><strong>TOTAL</strong><strong>Bs {bs(receipt.totalCents/100)}</strong></div>{receipt.balanceCents > 0 && <div><span>Saldo a favor aplicado</span><span>Bs {bs(receipt.balanceCents/100)}</span></div>}{receipt.pagos.map((p,i) => <div key={i}><span>{p.metodo}</span><span>Bs {bs(p.monto)}</span></div>)}{receipt.changeCents > 0 && <div><span>Cambio</span><span>Bs {bs(receipt.changeCents/100)}</span></div>}</div>
      {status !== 'ready' && <p className="reprint-mark">{status === 'pending' ? 'PAGO DIGITAL PENDIENTE DE VERIFICACIÓN' : status === 'cancelled' ? 'CONTIENE UNA OPERACIÓN ANULADA' : status === 'rejected' ? 'PAGO RECHAZADO' : 'VERIFICACIÓN NO DISPONIBLE'}</p>}
      <p>Documento no fiscal</p>
    </div>
    {status === 'error' && <p role="alert">No se pudieron comprobar los pagos. Vuelve a abrir el comprobante.</p>}
    {qrWaiting && <p role="status">Esperando confirmación del QR antes de imprimir.</p>}
    <footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cerrar</button><button className="primary-button" disabled={qrWaiting || ['loading','error','rejected','cancelled'].includes(status)} onClick={() => window.print()}><Printer /> Imprimir</button></footer>
  </Modal>
}
