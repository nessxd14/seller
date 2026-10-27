import { useEffect, useState } from 'react'
import { Modal } from '../../components/Modal'
import { AnularVentaModal } from '../../components/AnularVentaModal'
import { usePuedeAnular } from '../../components/usePuedeAnular'
import { anulacionService, saleService } from '../../infrastructure/services'
import type { AnulacionSolicitud, VentaTicketRecord } from '../../application/shared/models'
import { mensajeAnulacion, type AnularVentaResultado } from '../../domain/sales/anulacion'

const bs = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Detalle de una venta (Actividad → "Ver productos"). Pie con la anulación: Ness/gerente anulan
 * (con motivo); el resto solicita. `onChanged` avisa al padre para recargar tras anular/solicitar/retirar.
 */
export function VentaDetalleModal({ id, onClose, notify, onChanged }: { id: string; onClose: () => void; notify?: (message: string) => void; onChanged?: () => void }) {
  const [venta, setVenta] = useState<VentaTicketRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const puedeAnular = usePuedeAnular()
  const [pendiente, setPendiente] = useState<AnulacionSolicitud | null>(null)
  const [anulando, setAnulando] = useState(false)
  const [retirando, setRetirando] = useState(false)

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

  // Solicitud pendiente de esta venta: Ness/gerente ven todas, el resto solo las suyas (lo filtra la base).
  useEffect(() => {
    let cancelled = false
    anulacionService.listar('SOLICITADA')
      .then((filas) => { if (!cancelled) setPendiente(filas.find((s) => s.ventaId === id) ?? null) })
      .catch(() => { if (!cancelled) setPendiente(null) })
    return () => { cancelled = true }
  }, [id, attempt])

  const retirar = async () => {
    if (!pendiente || retirando) return
    setRetirando(true)
    try {
      await anulacionService.retirar(pendiente.id)
      notify?.('Solicitud de anulación retirada')
      setPendiente(null)
      onChanged?.()
    } catch (err) {
      notify?.(err instanceof Error ? err.message : 'No se pudo retirar la solicitud')
    } finally {
      setRetirando(false)
    }
  }

  const terminado = (result: AnularVentaResultado) => {
    notify?.(mensajeAnulacion(venta?.numero, result))
    setAnulando(false)
    onChanged?.()
    onClose()
  }

  const anulable = !!venta && venta.estado !== 'ANULADA'
  // Lo cobrado sale de los pagos guardados de la venta; el turno del cobro solo lo conoce la fila de solicitud.
  const cobrado = venta ? venta.pagos.reduce((sum, p) => sum + p.montoBs, 0) : undefined

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
        {anulable && pendiente && <p className="anular-venta-pendiente" role="status">Anulación solicitada · esperando revisión <button type="button" className="aprobacion-link" disabled={retirando} onClick={() => void retirar()}>Retirar</button></p>}
      </>}
    </div>
    <footer className="modal-actions">
      {anulable && !pendiente && <button type="button" className={puedeAnular ? 'danger-button' : 'secondary-button'} onClick={() => setAnulando(true)}>{puedeAnular ? 'Anular venta' : 'Solicitar anulación'}</button>}
      <button type="button" className="primary-button" onClick={onClose}>Cerrar detalle</button>
    </footer>
    {anulando && venta && <AnularVentaModal venta={{ id, numero: venta.numero, total: venta.totalBs, cobrado }} puedeAnular={puedeAnular} onDone={terminado} onClose={() => setAnulando(false)} />}
  </Modal>
}
