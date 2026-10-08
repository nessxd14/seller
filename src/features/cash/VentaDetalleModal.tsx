import { useEffect, useState } from 'react'
import { Modal } from '../../components/Modal'
import { saleService } from '../../infrastructure/services'
import type { VentaTicketRecord } from '../../application/shared/models'

const bs = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function VentaDetalleModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [venta, setVenta] = useState<VentaTicketRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    void saleService.getTicket(id).then((record) => {
      if (cancelled) return
      setVenta(record)
      setError(record ? '' : 'No se encontró la venta o no tienes acceso a su detalle.')
    }).catch(() => {
      if (!cancelled) setError('No se pudo cargar el detalle de la venta. Intenta nuevamente.')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id, attempt])

  return <Modal className="cash-dialog cash-sale-detail" title={venta?.numero ? `Productos · ${venta.numero}` : 'Detalle de venta'} onClose={onClose}>
    <div className="modal-body">
      {loading ? <p role="status">Cargando productos…</p> : error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => { setLoading(true); setError(''); setAttempt((n) => n + 1) }}>Reintentar</button></div> : venta && <>
        <p>{venta.clienteNombre ?? 'Cliente de mostrador'} · {new Date(venta.creadoEn).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}</p>
        {venta.estado === 'ANULADA' && <p role="status">Venta anulada</p>}
        {venta.lineas.length ? <ul className="cash-sale-lines" aria-label="Productos vendidos">
          {venta.lineas.map((line) => <li key={line.id}>
            <strong>{line.nombre || 'Producto sin descripción'}</strong>
            {(line.sku || line.presentacionNombre) && <small>{[line.sku, line.presentacionNombre].filter(Boolean).join(' · ')}</small>}
            <div><span>{line.cantidad.toLocaleString('es-BO')} × Bs {bs(line.precioUnitarioBs)}</span><b>Bs {bs(line.subtotalBs)}</b></div>
          </li>)}
        </ul> : <p role="status">Esta venta no tiene líneas de productos disponibles.</p>}
        <dl className="cash-sale-totals">
          <div><dt>Subtotal</dt><dd>Bs {bs(venta.subtotalBs)}</dd></div>
          <div><dt>Descuento</dt><dd>Bs {bs(venta.descuentoBs)}</dd></div>
          <div><dt>Total de la venta</dt><dd>Bs {bs(venta.totalBs)}</dd></div>
        </dl>
      </>}
    </div>
    <footer className="modal-actions"><button type="button" className="primary-button" onClick={onClose}>Cerrar detalle</button></footer>
  </Modal>
}
