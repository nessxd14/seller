// Brief B — línea muda debajo del precio, en DraftOrderEditor y EditQuoteLineModal.
// El cálculo de qué mostrar vive en buildPrecioSugeridoView (pura, testeable sin DOM);
// el componente solo la renderiza y conecta los clics de "aplicar".
import { categoriaLabel } from '../../domain/pricing/categoriaPrecio'
import type { PrecioSugerido } from '../../infrastructure/supabase/PreciosRepository.supabase'

const bs = (value: number) => `Bs ${value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtShortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit' })

export interface PrecioSugeridoView {
  ultimoLabel: string | null
  ultimoPrecioBs: number | null
  ultimoNumero: string | null
  ultimoFecha: string | null
  categoriaLabel: string | null
  categoriaPrecioBs: number | null
  categoriaLineas: number | null
  categoriaDias: number | null
  distintoChip: string | null
}

/**
 * Null cuando no hay nada que mostrar (ni último ni mediana de categoría) — el llamador
 * no renderiza nada en ese caso. `unitPriceCents` es el precio ACTUAL de la línea, para
 * el chip "Distinto al último" (>5% de diferencia, brief B).
 */
export const buildPrecioSugeridoView = (sugerido: PrecioSugerido | null | undefined, unitPriceCents: number): PrecioSugeridoView | null => {
  if (!sugerido || (!sugerido.ultimoCliente && !sugerido.categoria)) return null
  const ultimo = sugerido.ultimoCliente
  const categoria = sugerido.categoria
  const ultimoCents = ultimo ? Math.round(ultimo.precio * 100) : null
  const distinto = ultimoCents != null && ultimoCents > 0 && Math.abs(unitPriceCents - ultimoCents) / ultimoCents > 0.05
  return {
    ultimoLabel: ultimo ? (ultimo.fuente === 'COTIZACION' ? 'Última cotización a este cliente' : 'Último a este cliente') : null,
    ultimoPrecioBs: ultimo?.precio ?? null,
    ultimoNumero: ultimo?.numero ?? null,
    ultimoFecha: ultimo ? fmtShortDate(ultimo.fecha) : null,
    categoriaLabel: categoria ? categoriaLabel(categoria.categoria) : null,
    categoriaPrecioBs: categoria?.mediana ?? null,
    categoriaLineas: categoria?.lineas ?? null,
    categoriaDias: categoria?.dias ?? null,
    distintoChip: distinto && ultimo ? `Distinto al último (${bs(ultimo.precio)})` : null,
  }
}

export function PrecioSugeridoHint({ sugerido, unitPriceCents, onApply }: {
  sugerido: PrecioSugerido | null | undefined
  unitPriceCents: number
  onApply: (precioBs: number) => void
}) {
  const view = buildPrecioSugeridoView(sugerido, unitPriceCents)
  if (!view) return null
  return (
    <div className="precio-sugerido-hint">
      {view.ultimoPrecioBs !== null && (
        <button type="button" onClick={() => onApply(view.ultimoPrecioBs!)}>
          {view.ultimoLabel}: <strong>{bs(view.ultimoPrecioBs)}</strong> · {view.ultimoNumero} · {view.ultimoFecha}
        </button>
      )}
      {view.categoriaPrecioBs !== null && (
        <button type="button" onClick={() => onApply(view.categoriaPrecioBs!)}>
          Mediana {view.categoriaLabel} ({view.categoriaDias} días): <strong>{bs(view.categoriaPrecioBs)}</strong> · {view.categoriaLineas} pedido{view.categoriaLineas === 1 ? '' : 's'}
        </button>
      )}
      {view.distintoChip && <span className="precio-sugerido-chip">{view.distintoChip}</span>}
    </div>
  )
}
