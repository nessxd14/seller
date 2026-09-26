import { Printer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { saleService } from '../infrastructure/services'
import type { VentaTicketRecord } from '../application/shared/models'
import { empresaStore as empresa, loadEmpresaConfig } from '../config/empresaStore'
import { readDefaultPrintFormat, type PrintFormat } from './printFormat'
import { FeatureState } from '../features/shared/FeatureShell'

const bs = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const metodoLabel: Record<string, string> = { EFECTIVO: 'Efectivo', QR: 'QR', TRANSFERENCIA: 'Transferencia', SIGEP: 'SIGEP', CHEQUE: 'Cheque', DEPOSITO: 'Depósito' }

/**
 * Brief Caja-1 B1 — ticket post-venta REAL: se arma desde la venta ya guardada
 * (numero + líneas + venta_pago vía saleService.getTicket), a diferencia de
 * TicketPreviewModal (que muestra el carrito ANTES de cobrar, sin numero). Por eso
 * puede reimprimirse: no depende de que el carrito siga teniendo esos datos.
 */
export function VentaTicket({ id, onClose }: { id: string; onClose: () => void }) {
  const [venta, setVenta] = useState<VentaTicketRecord | null | 'loading'>('loading')
  const [format, setFormat] = useState<PrintFormat>(readDefaultPrintFormat)
  useEffect(() => { void loadEmpresaConfig() }, [])
  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- vuelve a "loading" en cuanto cambia el id, antes de que el fetch de abajo resuelva
    setVenta('loading')
    void saleService.getTicket(id).then((v) => { if (!cancelled) setVenta(v) }).catch(() => { if (!cancelled) setVenta(null) })
    return () => { cancelled = true }
  }, [id])

  if (venta === 'loading') return <Modal title="Ticket" onClose={onClose}><div className="modal-body"><FeatureState type="loading" text="Cargando ticket" /></div></Modal>
  if (!venta) return <Modal title="Ticket" onClose={onClose}><div className="modal-body"><FeatureState type="error" text="No se encontró la venta" /></div></Modal>

  // Brief Caja-2 (no implementado todavía) es quien agrega el bloqueo real de "no
  // imprimir con un pago QR/transferencia sin verificar" — acá, sin scraper que
  // concilie nada, todo QR/transferencia queda PENDIENTE para siempre, así que
  // bloquear la impresión dejaría estos tickets sin poder imprimirse nunca. Se avisa
  // en el ticket (informativo), pero no se bloquea el botón.
  const pendiente = venta.pagos.some((p) => p.estadoVerificacion === 'PENDIENTE' || p.estadoVerificacion === 'RECHAZADO')
  const efectivo = venta.pagos.find((p) => p.metodo === 'EFECTIVO' && p.recibidoBs != null)
  const cambio = efectivo?.recibidoBs != null ? efectivo.recibidoBs - efectivo.montoBs : null

  return <Modal title={venta.numero ? `Ticket ${venta.numero}` : 'Ticket'} subtitle="Documento no fiscal" onClose={onClose}>
    <div className="print-options"><select value={format} onChange={(e) => setFormat(e.target.value as typeof format)}><option value="ticket-58">Térmico 58 mm</option><option value="ticket-80">Térmico 80 mm</option></select></div>
    <div className={`ticket ${format}`}>
      <div className="ticket-brand"><strong>{empresa.razonSocial}</strong><span>{empresa.direccion}</span><small>{empresa.ciudad}</small></div>
      <div className="ticket-meta"><span>{venta.numero ?? `#${venta.ventaId}`}</span><span>{new Date(venta.creadoEn).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}</span></div>
      {(venta.cajaNombre || venta.cajero) && <div className="ticket-meta"><span>{venta.cajaNombre ?? ''}</span><span>{venta.cajero ?? ''}</span></div>}
      {(venta.clienteNombre) && <div className="ticket-meta"><span>{venta.clienteNombre}{venta.clienteNit ? ` · ${venta.clienteNit}` : ''}</span></div>}
      {venta.lineas.map((line) => <div className="ticket-line" key={line.id}><span>{line.cantidad} × {line.nombre}{line.presentacionNombre ? ` (${line.presentacionNombre})` : ''}</span><strong>{bs(line.subtotalBs)}</strong></div>)}
      <div className="ticket-totals">
        <div><span>Subtotal</span><span>Bs {bs(venta.subtotalBs)}</span></div>
        <div><span>Descuento</span><span>− Bs {bs(venta.descuentoBs)}</span></div>
        <div><strong>TOTAL</strong><strong>Bs {bs(venta.totalBs)}</strong></div>
      </div>
      <div className="ticket-totals">
        {venta.pagos.map((p, i) => <div key={i}><span>{metodoLabel[p.metodo] ?? p.metodo}{p.estadoVerificacion === 'PENDIENTE' ? ' (pendiente)' : p.estadoVerificacion === 'RECHAZADO' ? ' (rechazado)' : ''}</span><span>Bs {bs(p.montoBs)}</span></div>)}
        {efectivo?.recibidoBs != null && <div><span>Recibido</span><span>Bs {bs(efectivo.recibidoBs)}</span></div>}
        {cambio != null && <div><span>Cambio</span><span>Bs {bs(cambio)}</span></div>}
      </div>
      {pendiente && <p className="reprint-mark">QR / TRANSFERENCIA PENDIENTE DE VERIFICAR</p>}
      <p>¡Gracias por elegir {empresa.razonSocial}!</p>
      <p className="print-header-footer-hint">Documento no fiscal</p>
    </div>
    <footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cerrar</button><button className="primary-button" onClick={() => window.print()}><Printer /> Imprimir ticket</button></footer>
  </Modal>
}
