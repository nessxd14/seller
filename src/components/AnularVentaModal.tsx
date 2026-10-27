import { useState } from 'react'
import { Modal } from './Modal'
import { anulacionService } from '../infrastructure/services'
import { explicarDevolucion, MOTIVO_ANULACION_MIN, type AnularVentaResultado, type CobroAnulacion } from '../domain/sales/anulacion'

const MOTIVO_MAX = 300

export interface AnularVentaTarget extends CobroAnulacion {
  id: string
  numero: string | null
  total: number
}

/**
 * Modal único para anular (Ness / gerente) o solicitar la anulación (resto) de un ticket VTA o VTD.
 * El motivo es obligatorio; la base decide de qué turno sale la devolución y este texto solo la explica.
 * Los errores de Postgres ya vienen en español: se muestran tal cual.
 */
export function AnularVentaModal({ venta, puedeAnular, nota, onDone, onClose }: { venta: AnularVentaTarget; puedeAnular: boolean; nota?: string; onDone: (result: AnularVentaResultado) => void; onClose: () => void }) {
  const [motivo, setMotivo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const nombre = venta.numero ?? `venta ${venta.id}`
  const valido = motivo.trim().length >= MOTIVO_ANULACION_MIN

  const enviar = async () => {
    if (!valido || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const result: AnularVentaResultado = puedeAnular
        ? { tipo: 'anulada', resultado: await anulacionService.anular(venta.id, motivo.trim()) }
        : { tipo: 'solicitada', resultado: await anulacionService.solicitar(venta.id, motivo.trim()) }
      onDone(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar la operación')
      setSubmitting(false)
    }
  }

  return <Modal className="cash-dialog anular-venta-modal" title={puedeAnular ? `Anular ${nombre}` : `Solicitar anulación de ${nombre}`} onClose={() => { if (!submitting) onClose() }}>
    <form className="modal-body" onSubmit={(e) => { e.preventDefault(); void enviar() }}>
      <p className="anular-venta-refund" role="note">{explicarDevolucion(venta, puedeAnular)}</p>
      {nota && <p className="anular-venta-nota">{nota}</p>}
      <label className="anular-venta-motivo">Motivo
        <textarea value={motivo} rows={3} maxLength={MOTIVO_MAX} disabled={submitting} required aria-required="true" autoFocus
          placeholder="Por qué se anula esta venta" onChange={(e) => setMotivo(e.target.value)} />
        <small className={valido ? '' : 'anular-venta-contador-corto'}>{motivo.trim().length}/{MOTIVO_MAX} · mínimo {MOTIVO_ANULACION_MIN} caracteres</small>
      </label>
      {error && <p role="alert" className="cash-error">{error}</p>}
      <footer className="modal-actions">
        <button type="button" disabled={submitting} onClick={onClose}>Volver</button>
        <button type="submit" className={`primary-button${puedeAnular ? ' peligro' : ''}`} disabled={!valido || submitting}>
          {submitting ? 'Enviando…' : puedeAnular ? 'Anular venta' : 'Enviar solicitud'}
        </button>
      </footer>
    </form>
  </Modal>
}
