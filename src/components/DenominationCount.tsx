import type { Denominaciones } from '../application/shared/models'
import { NumberField } from './NumberField'

// Brief Caja-1 A5: billetes 200/100/50/20/10, monedas 5/2/1/0.5 — exactamente lo que
// _total_denominaciones acepta en el backend (ver db/migrations/2026-09-27_caja_turno_
// cajero.sql). Reutilizado por Abrir turno, Cerrar turno y Arqueo sorpresa (A5/A8): un
// solo formulario, tres llamadores.
const BILLETES = [200, 100, 50, 20, 10] as const
const MONEDAS = [5, 2, 1, 0.5] as const

const bs = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function DenominationCount({ value, onChange }: { value: Denominaciones; onChange: (next: Denominaciones) => void }) {
  const total = [...BILLETES, ...MONEDAS].reduce((sum, d) => sum + (value[String(d)] ?? 0) * d, 0)
  const setQty = (key: number, qty: number) => onChange({ ...value, [String(key)]: Math.max(0, Math.floor(qty)) })
  const row = (d: number) => {
    const key = String(d)
    const qty = value[key] ?? 0
    return <div className="denomination-row" key={key}>
      <span className="denomination-label">Bs {d}</span>
      <NumberField ariaLabel={`Cantidad de billetes/monedas de ${d}`} min={0} allowDecimals={false} value={qty} onCommit={(next) => setQty(d, next)} />
      <strong className="denomination-subtotal">Bs {bs(qty * d)}</strong>
    </div>
  }
  return <div className="denomination-count">
    <div className="denomination-group"><h4>Billetes</h4>{BILLETES.map(row)}</div>
    <div className="denomination-group"><h4>Monedas</h4>{MONEDAS.map(row)}</div>
    <div className="denomination-total"><span>Total contado</span><strong>Bs {bs(total)}</strong></div>
  </div>
}

export const denominacionesTotal = (value: Denominaciones): number =>
  [...BILLETES, ...MONEDAS].reduce((sum, d) => sum + (value[String(d)] ?? 0) * d, 0)
