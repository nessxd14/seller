import { useState } from 'react'
import type { WorkflowLine } from '../../application/shared/models'
import { Modal } from '../../components/Modal'
import { NumberField } from '../../components/NumberField'
import { buildOriginOptions, type OriginLocation } from '../../components/OriginPin'
import { cantidadBaseFor } from '../../domain/sales/stockCheck'
import { formatMoney, money } from '../../domain/common/money'
import type { LineIdentifiers } from '../../components/LineIdentifiersRow'

type LinePresentation = { id: number; nombre: string; factorUnidadBase: number; esBase: boolean }
type LineStock = { tienda: number; almacen: number }

const lineTotalCents = (unitPriceCents: number, quantity: number, discountBasisPoints: number) =>
  Math.round(unitPriceCents * quantity * (10_000 - discountBasisPoints) / 10_000)

/**
 * Tarea 1 (brief T1) — reemplaza PricePopover + MaskPopover + OriginPin dentro del
 * editor de cotización: los tres eran hijos de .modal-body y se recortaban contra el
 * overflow:auto del modal en cotizaciones largas (un z-index no saca un elemento del
 * overflow de un ancestro). Un modal propio no tiene ese problema porque es su propio
 * portal (ver Modal.tsx), igual que ya resuelve EditCartItemModal para el carrito.
 *
 * Mismo patrón que EditCartItemModal: form local, se confirma recién al Guardar — nada
 * se escribe en la línea real hasta entonces.
 */
export function EditQuoteLineModal({ line, stock, presentations, identifiers, basePriceCents, onClose, onSave }: {
  line: WorkflowLine
  stock?: LineStock
  presentations: LinePresentation[]
  identifiers?: LineIdentifiers
  basePriceCents: number
  onClose: () => void
  onSave: (patch: Partial<WorkflowLine>) => void
}) {
  const [form, setForm] = useState(() => ({
    quantity: line.quantity,
    presentacionId: line.presentacionId ?? presentations.find((p) => p.esBase)?.id ?? presentations[0]?.id,
    unitPriceCents: line.unitPriceCents,
    discountBasisPoints: line.discountBasisPoints,
    maskName: line.maskName ?? '',
    sourceLocation: (line.sourceLocation ?? 'Almacén') as OriginLocation,
    note: line.note ?? '',
  }))

  const chosenPresentation = presentations.find((p) => p.id === form.presentacionId)
  const factor = chosenPresentation?.factorUnidadBase ?? line.factorUnidadBase ?? 1

  // Misma fórmula que onPresentationChange en DraftOrderEditor: sugiere un precio a
  // partir del precio base capturado al agregar la línea × el factor de la
  // presentación elegida. Solo sugiere — el campo de precio sigue siendo editable
  // después, y recién al Guardar se decide si quedó "editado" (ver más abajo).
  const applyPresentation = (presentationId: number) => {
    const chosen = presentations.find((p) => p.id === presentationId)
    if (!chosen) return
    setForm((f) => ({ ...f, presentacionId: presentationId, unitPriceCents: Math.round(basePriceCents * chosen.factorUnidadBase) }))
  }

  const totalCents = lineTotalCents(form.unitPriceCents, form.quantity, form.discountBasisPoints)

  const cantidadBase = cantidadBaseFor({ cantidad: form.quantity, ubicacion: form.sourceLocation, factorUnidadBase: factor })
  const almacenCovers = stock ? stock.almacen >= cantidadBase : false
  const originOptions = buildOriginOptions(stock, almacenCovers ? { Tienda: 'Almacén cubre esta línea' } : undefined)

  const save = () => {
    const isBase = !chosenPresentation || chosenPresentation.esBase || chosenPresentation.factorUnidadBase === 1
    const suggestedPriceCents = Math.round(basePriceCents * factor)
    const priceOverridden = form.unitPriceCents !== suggestedPriceCents
    onSave({
      quantity: form.quantity,
      presentacionId: isBase ? undefined : chosenPresentation?.id,
      presentacionNombre: isBase ? undefined : chosenPresentation?.nombre,
      factorUnidadBase: isBase ? undefined : chosenPresentation?.factorUnidadBase,
      unitPriceCents: form.unitPriceCents,
      discountBasisPoints: form.discountBasisPoints,
      priceOverridden,
      maskName: form.maskName.trim() || undefined,
      sourceLocation: form.sourceLocation,
      note: form.note || undefined,
    })
    onClose()
  }

  return (
    <Modal title="Editar línea" subtitle={line.name} onClose={onClose}>
      <div className="modal-body form-grid edit-quote-line-modal">
        <label>Cantidad<NumberField value={form.quantity} min={1} allowDecimals={false} onCommit={(quantity) => setForm((f) => ({ ...f, quantity }))} /></label>
        {presentations.length > 0 && (
          <label>Presentación
            <select value={form.presentacionId ?? ''} onChange={(e) => applyPresentation(Number(e.target.value))}>
              {presentations.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
        )}
        <label>Precio unitario (Bs)<NumberField value={form.unitPriceCents / 100} min={0} step={0.5} onCommit={(bs) => setForm((f) => ({ ...f, unitPriceCents: Math.max(0, Math.round(bs * 100)) }))} /></label>
        <label>Descuento (%)<NumberField value={form.discountBasisPoints / 100} min={0} max={100} onCommit={(pct) => setForm((f) => ({ ...f, discountBasisPoints: Math.min(10_000, Math.max(0, Math.round(pct * 100))) }))} /></label>
        <label className="full">Nombre para el cliente<input value={form.maskName} placeholder={line.name} onChange={(e) => setForm((f) => ({ ...f, maskName: e.target.value }))} /></label>
        <label>Origen
          <select value={form.sourceLocation} onChange={(e) => setForm((f) => ({ ...f, sourceLocation: e.target.value as OriginLocation }))}>
            {originOptions.map((opt) => (
              <option key={opt.location} value={opt.location} disabled={Boolean(opt.disabledReason)} title={opt.disabledReason}>
                {opt.location}{opt.stock != null ? ` (${opt.stock})` : ''}{opt.disabledReason ? ` — ${opt.disabledReason}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="full">Observación<textarea rows={2} placeholder="Añadir una nota a esta línea..." value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></label>

        <div className="full edit-quote-line-readonly">
          <p><span>Producto de catálogo</span><strong>{line.name}</strong></p>
          <p><span>SKU</span><strong>{line.sku || '—'}</strong></p>
          <p><span>Código de barra</span><strong>{identifiers?.barra || '—'}</strong></p>
          <p><span>Stock Tienda</span><strong>{stock ? stock.tienda.toLocaleString('es-BO') : '—'}</strong></p>
          <p><span>Stock Almacén</span><strong>{stock ? stock.almacen.toLocaleString('es-BO') : '—'}</strong></p>
          <p className="edit-quote-line-total"><span>Total de la línea</span><strong>{formatMoney(money(totalCents))}</strong></p>
        </div>
      </div>
      <footer className="modal-actions">
        <button className="secondary-button" onClick={onClose}>Cancelar</button>
        <button className="primary-button" onClick={save}>Guardar cambios</button>
      </footer>
    </Modal>
  )
}
