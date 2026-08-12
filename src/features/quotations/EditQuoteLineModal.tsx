import { useState } from 'react'
import type { WorkflowLine } from '../../application/shared/models'
import { Modal } from '../../components/Modal'
import { NumberField } from '../../components/NumberField'
import { formatMoney, money } from '../../domain/common/money'
import type { OriginPinOption, OriginLocation } from '../../components/OriginPin'
import type { LineIdentifiers } from '../../components/LineIdentifiersRow'

export type LinePresentation = { id: number; nombre: string; factorUnidadBase: number; esBase: boolean }
export type LineStock = { tienda: number; almacen: number }

interface FormState {
  cantidad: number
  presentacionId?: number
  presentacionNombre?: string
  factorUnidadBase?: number
  precioUnitario: number
  descuento: number
  maskName: string
  origen: OriginLocation
  observacion: string
}

const toFormState = (line: WorkflowLine): FormState => ({
  cantidad: line.quantity,
  presentacionId: line.presentacionId,
  presentacionNombre: line.presentacionNombre,
  factorUnidadBase: line.factorUnidadBase,
  precioUnitario: line.unitPriceCents / 100,
  descuento: line.discountBasisPoints / 100,
  maskName: line.maskName ?? '',
  origen: line.sourceLocation ?? 'Almacén',
  observacion: line.note ?? '',
})

/**
 * TAREA 1 — reemplaza a PricePopover + MaskPopover (recortados por el overflow:auto del
 * .modal ancestro en cotizaciones largas). Un solo modal centrado, molde EditCartItemModal,
 * con toda la edición de la línea junta y un bloque de solo lectura con los datos reales de
 * catálogo debajo.
 */
export function EditQuoteLineModal({ line, presentations, stock, identifiers, basePriceCents, originOptions, actorId, onClose, onSave }: {
  line: WorkflowLine
  presentations: LinePresentation[]
  stock?: LineStock
  identifiers?: LineIdentifiers
  basePriceCents: number
  originOptions: OriginPinOption[]
  actorId: string
  onClose: () => void
  onSave: (patch: Partial<WorkflowLine>) => void
}) {
  const [form, setForm] = useState<FormState>(() => toFormState(line))

  const applyPresentation = (presentationId: number) => {
    const presentation = presentations.find((p) => p.id === presentationId)
    if (!presentation) return
    const isBase = presentation.esBase || presentation.factorUnidadBase === 1
    const suggestedPriceCents = Math.round(basePriceCents * presentation.factorUnidadBase)
    setForm((f) => ({
      ...f,
      presentacionId: isBase ? undefined : presentation.id,
      presentacionNombre: isBase ? undefined : presentation.nombre,
      factorUnidadBase: isBase ? undefined : presentation.factorUnidadBase,
      precioUnitario: suggestedPriceCents / 100,
    }))
  }

  const totalCents = Math.round(form.precioUnitario * 100 * form.cantidad * (10_000 - Math.round(form.descuento * 100)) / 10_000)

  const save = () => {
    const unitPriceCents = Math.max(0, Math.round(form.precioUnitario * 100))
    onSave({
      quantity: Math.max(1, form.cantidad),
      presentacionId: form.presentacionId,
      presentacionNombre: form.presentacionNombre,
      factorUnidadBase: form.factorUnidadBase,
      unitPriceCents,
      discountBasisPoints: Math.min(10_000, Math.max(0, Math.round(form.descuento * 100))),
      maskName: form.maskName.trim() || undefined,
      sourceLocation: form.origen,
      note: form.observacion,
      priceOverridden: unitPriceCents !== (line.listPriceCents ?? line.unitPriceCents),
      modifiedBy: actorId,
      modifiedAt: new Date().toISOString(),
    })
    onClose()
  }

  return (
    <Modal title="Editar línea" subtitle={line.name} onClose={onClose}>
      <div className="modal-body form-grid edit-quote-line-modal">
        <label>Cantidad<NumberField value={form.cantidad} min={1} allowDecimals={false} onCommit={(cantidad) => setForm((f) => ({ ...f, cantidad }))} /></label>
        {presentations.length > 0 && (
          <label>Presentación
            <select value={form.presentacionId ?? presentations.find((p) => p.esBase)?.id ?? presentations[0]?.id} onChange={(e) => applyPresentation(Number(e.target.value))}>
              {presentations.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
        )}
        <label>Precio unitario (Bs)<NumberField value={form.precioUnitario} min={0} step={0.5} onCommit={(precioUnitario) => setForm((f) => ({ ...f, precioUnitario }))} /></label>
        <label>Descuento (%)<NumberField value={form.descuento} min={0} max={100} onCommit={(descuento) => setForm((f) => ({ ...f, descuento }))} /></label>
        <label>Nombre para el cliente<input value={form.maskName} placeholder={line.name} onChange={(e) => setForm((f) => ({ ...f, maskName: e.target.value }))} /></label>
        <label>Origen
          <select value={form.origen} onChange={(e) => setForm((f) => ({ ...f, origen: e.target.value as OriginLocation }))}>
            {originOptions.map((o) => (
              <option key={o.location} value={o.location} disabled={Boolean(o.disabledReason)}>
                {o.location}{o.stock !== undefined ? ` (${o.stock.toLocaleString('es-BO')})` : ''}{o.disabledReason ? ` — ${o.disabledReason}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="full">Observación<textarea rows={2} value={form.observacion} onChange={(e) => setForm((f) => ({ ...f, observacion: e.target.value }))} /></label>

        <div className="full edit-quote-line-info">
          <div><span>Catálogo</span><strong>{line.name}</strong></div>
          <div><span>SKU</span><strong>{line.sku || '—'}</strong></div>
          <div><span>Código de barra</span><strong>{identifiers?.barra || '—'}</strong></div>
          <div><span>Stock Tienda</span><strong>{stock ? stock.tienda.toLocaleString('es-BO') : '—'}</strong></div>
          <div><span>Stock Almacén</span><strong>{stock ? stock.almacen.toLocaleString('es-BO') : '—'}</strong></div>
          <div className="total"><span>Total de la línea</span><strong>{formatMoney(money(totalCents))}</strong></div>
        </div>
      </div>
      <footer className="modal-actions">
        <button className="secondary-button" onClick={onClose}>Cancelar</button>
        <button className="primary-button" onClick={save}>Guardar cambios</button>
      </footer>
    </Modal>
  )
}
