import type { Denominaciones } from '../application/shared/models'
import { NumberField } from './NumberField'

// Brief Caja-1 A5: billetes 200/100/50/20/10, monedas 5/2/1/0.5 — exactamente lo que
// _total_denominaciones acepta en el backend (ver db/migrations/2026-09-27_caja_turno_
// cajero.sql). Reutilizado por Abrir turno, Cerrar turno y Arqueo sorpresa (A5/A8): un
// solo formulario, tres llamadores.
export const BILLETES = [200, 100, 50, 20, 10] as const
export const MONEDAS = [5, 2, 1, 0.5] as const
export const DENOMINACIONES = [...BILLETES, ...MONEDAS] as const

const bs = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * `limites` (opcional): tope por denominación. Lo usa el paso "¿Cuánto entregas?" del
 * cierre — no se puede entregar más billetes de los que se contaron. Las denominaciones
 * con tope 0 no se muestran y cada fila dice cuántas hay ("de 4").
 */
export function DenominationCount({ value, onChange, disabled = false, limites, ariaLabelFor, totalLabel = 'Total contado' }: {
  value: Denominaciones
  onChange: (next: Denominaciones) => void
  disabled?: boolean
  limites?: Denominaciones
  ariaLabelFor?: (denominacion: number) => string
  totalLabel?: string
}) {
  const total = denominacionesTotal(value)
  const setQty = (key: number, qty: number) => {
    const tope = limites ? limites[String(key)] ?? 0 : Infinity
    onChange({ ...value, [String(key)]: Math.min(tope, Math.max(0, Math.floor(qty))) })
  }
  const visibles = (lista: readonly number[]) => (limites ? lista.filter((d) => (limites[String(d)] ?? 0) > 0) : lista)
  const row = (d: number) => {
    const key = String(d)
    const qty = value[key] ?? 0
    const tope = limites?.[key]
    return <div className="denomination-row" key={key}>
      <span className="denomination-label">Bs {d}{tope != null && <small className="denomination-limit">de {tope}</small>}</span>
      <NumberField ariaLabel={ariaLabelFor ? ariaLabelFor(d) : `Cantidad de billetes/monedas de ${d}`} disabled={disabled} min={0} max={tope} allowDecimals={false} selectOnFocus value={qty} onCommit={(next) => setQty(d, next)} />
      <strong className="denomination-subtotal">Bs {bs(qty * d)}</strong>
    </div>
  }
  const grupo = (titulo: string, lista: readonly number[]) => {
    const filas = visibles(lista)
    if (!filas.length) return null
    return <div className="denomination-group"><h4>{titulo}</h4><div className="denomination-head"><span>Valor</span><span>Cantidad</span><span>Subtotal</span></div>{filas.map(row)}</div>
  }
  return <div className={`denomination-count${limites ? ' denomination-count-limited' : ''}`}>
    {grupo('Billetes', BILLETES)}
    {grupo('Monedas', MONEDAS)}
    <div className="denomination-total" aria-live="polite"><span>{totalLabel}</span><strong>Bs {bs(total)}</strong></div>
  </div>
}

export const denominacionesTotal = (value: Denominaciones): number =>
  DENOMINACIONES.reduce((sum, d) => sum + (value[String(d)] ?? 0) * d, 0)

/** Quita las denominaciones en cero: lo que se manda a la base es solo lo que hay. */
export const denominacionesLimpias = (value: Denominaciones): Denominaciones =>
  Object.fromEntries(Object.entries(value).filter(([, qty]) => qty > 0))

/** contado − entregado, por denominación (nunca negativo). */
export const denominacionesRestantes = (contado: Denominaciones, entregado: Denominaciones): Denominaciones =>
  denominacionesLimpias(Object.fromEntries(DENOMINACIONES.map((d) => {
    const key = String(d)
    return [key, Math.max(0, (contado[key] ?? 0) - (entregado[key] ?? 0))]
  })))
