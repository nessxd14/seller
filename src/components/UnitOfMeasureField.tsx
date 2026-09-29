import { useId } from 'react'
import { UNIDADES_SUGERIDAS, UNIT_MAX_LENGTH, normalizeUnit } from '../domain/sales/unitOfMeasure'

// Texto libre con sugerencias (datalist). Normaliza al salir del campo. Con
// `emptyAllowed` (líneas históricas sin unidad) un valor vacío se queda vacío en vez de
// pasar a 'UNIDAD', para que guardar sin tocarlo no invente una unidad.
export function UnitOfMeasureField({ value, onChange, emptyAllowed = false, autoFocus }: { value: string; onChange: (next: string) => void; emptyAllowed?: boolean; autoFocus?: boolean }) {
  const listId = useId()
  return <>
    <input
      list={listId}
      value={value}
      maxLength={UNIT_MAX_LENGTH}
      autoFocus={autoFocus}
      placeholder="UNIDAD"
      aria-label="Unidad de medida"
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => { if (!(emptyAllowed && value.trim() === '')) onChange(normalizeUnit(value)) }}
    />
    <datalist id={listId}>{UNIDADES_SUGERIDAS.map((unit) => <option key={unit} value={unit} />)}</datalist>
  </>
}
