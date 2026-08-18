import { useState } from 'react'
import { Modal } from './Modal'

/**
 * Brief S1: guardado explícito ("tipo Instagram") — distinto de Suspender, que sí vacía
 * el carrito. Guardar un borrador NO interrumpe la operación en curso: el cajero sigue
 * trabajando, y el checkpoint queda disponible en la bandeja de Borradores.
 */
export function GuardarBorradorModal({ submitting, error, onClose, onConfirm }: { submitting: boolean; error: string; onClose: () => void; onConfirm: (titulo: string) => void }) {
  const [titulo, setTitulo] = useState('')
  return (
    <Modal title="Guardar borrador" subtitle="Queda disponible en Borradores — no interrumpe lo que estás armando" onClose={onClose}>
      <div className="modal-body form-grid">
        <label className="full">Título (opcional)<input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej. Traslado Almacén → Tienda, papelería" /></label>
        {error && <p className="mock-note payment-error full">{error}</p>}
      </div>
      <footer className="modal-actions">
        <button className="secondary-button" onClick={onClose}>Cancelar</button>
        <button className="primary-button" disabled={submitting} onClick={() => onConfirm(titulo.trim())}>{submitting ? 'Guardando…' : 'Guardar borrador'}</button>
      </footer>
    </Modal>
  )
}
