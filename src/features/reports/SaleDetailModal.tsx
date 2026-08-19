import { useEffect, useState } from 'react'
import { Modal } from '../../components/Modal'
import { AutoriaBadge } from '../../components/AutoriaBadge'
import { FeatureState } from '../shared/FeatureShell'
import { ventaDirectaService } from '../../infrastructure/services'
import type { VentaDirectaRecord } from '../../application/shared/models'
import { formatMoney, money } from '../../domain/common/money'

/**
 * Brief S3 — /ventas/:id. Reutiliza ventaDirectaService.getById (venta + venta_linea +
 * venta_pago) que ya cubre cualquier `venta`, sea VTD o venta de mostrador — el fallback
 * "#<id>" cuando `numero` es null (ventas viejas, previas a la serie VTD) ya lo resuelve
 * ese mismo repositorio, ver VentaDirectaRepository.supabase.ts.
 */
export function SaleDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [venta, setVenta] = useState<VentaDirectaRecord | null | 'loading'>('loading')
  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- vuelve a "loading" en cuanto cambia el id, antes de que el fetch de abajo resuelva
    setVenta('loading')
    void ventaDirectaService.getById(id).then((v) => { if (!cancelled) setVenta(v) }).catch(() => { if (!cancelled) setVenta(null) })
    return () => { cancelled = true }
  }, [id])

  if (venta === 'loading') return <Modal title="Venta" onClose={onClose}><div className="modal-body"><FeatureState type="loading" text="Cargando venta" /></div></Modal>
  if (!venta) return <Modal title="Venta" onClose={onClose}><div className="modal-body"><FeatureState type="error" text="No se encontró la venta" /></div></Modal>

  return (
    <Modal title={venta.numero} subtitle={venta.estado} onClose={onClose}>
      <div className="modal-body order-detail">
        <div className="autoria-row"><AutoriaBadge label="Creado por" email={venta.creadoPor} /></div>
        {venta.lines.map((line) => (
          <article key={line.id}>
            <header><div><strong>{line.name}</strong><small>{line.sku}</small></div><span>{line.cantidadPresentacion}{line.presentacionNombre ? ` × ${line.presentacionNombre}` : ''}</span></header>
          </article>
        ))}
        <div className="totals-footer">
          <div><span>Subtotal</span><span>{formatMoney(money(venta.subtotalCents))}</span></div>
          <div><span>Descuento</span><span>{formatMoney(money(venta.discountCents))}</span></div>
          <div className="total"><span>Total</span><span>{formatMoney(money(venta.totalCents))}</span></div>
        </div>
      </div>
    </Modal>
  )
}
