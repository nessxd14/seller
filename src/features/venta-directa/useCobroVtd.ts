import { useState } from 'react'
import { ventaDirectaService } from '../../infrastructure/services'
import type { SaleCheckoutPayment } from '../../application/ports/repositories'
import type { VentaDirectaRecord } from '../../application/shared/models'

const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Brief Caja VTD obligatorio — confirmación del cobro de uno o más VTD (cobrar_vtd) y cola de
 * tickets PAGADO. Compartido por el carrito ("Agregar VTD") y la bandeja de Venta Directa
 * ("Cobrar"): el aviso de QR/transferencia pendiente y el ticket de cada VTD cobrado (la
 * autorización de entrega para Almacén) son idénticos en ambos lugares.
 */
export function useCobroVtd({ sessionId, notify }: { sessionId: string | null | undefined; notify: (message: string) => void }) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [ticketQueue, setTicketQueue] = useState<VentaDirectaRecord[]>([])

  /** true si el cobro quedó registrado (incluye el reintento idempotente). */
  const cobrar = async (ventaIds: string[], payments: SaleCheckoutPayment[]): Promise<boolean> => {
    if (!sessionId || submitting || !ventaIds.length) return false
    setSubmitting(true)
    setError('')
    try {
      const resultado = await ventaDirectaService.cobrarVtd({ ventaIds, sesionCajaId: sessionId, pagos: payments })
      notify(resultado.reintento
        ? 'Este cobro ya estaba registrado. No se cobró dos veces.'
        : `VTD cobrada — Bs ${money(resultado.totalBs)}${resultado.cambioBs > 0 ? ` · Cambio Bs ${money(resultado.cambioBs)}` : ''}`)
      if (resultado.pendienteVerificacion) notify('Pago QR/transferencia pendiente de verificación del gerente')
      // El cobro ya está registrado: si releer un VTD falla, no se reporta como cobro fallido.
      // Un ticket por VTD cobrado, uno por uno (cola): cada uno autoriza la entrega en Almacén.
      const actualizados = await Promise.all(ventaIds.map((id) => ventaDirectaService.getById(id).catch(() => null)))
      setTicketQueue(actualizados.filter((v): v is VentaDirectaRecord => v != null))
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cobrar la venta directa')
      return false
    } finally {
      setSubmitting(false)
    }
  }

  return { cobrar, submitting, error, clearError: () => setError(''), ticketQueue, closeTicket: () => setTicketQueue((queue) => queue.slice(1)) }
}
