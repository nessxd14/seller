import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from 'react'

export interface NumberFieldProps {
  value: number
  onCommit: (value: number) => void
  min?: number
  max?: number
  step?: number | 'any'
  /** default true — false trunca a entero al confirmar (cantidades, no montos). */
  allowDecimals?: boolean
  placeholder?: string
  className?: string
  ariaLabel?: string
  autoFocus?: boolean
  disabled?: boolean
  id?: string
}

const clamp = (n: number, min?: number, max?: number): number => {
  let v = n
  if (min != null) v = Math.max(min, v)
  if (max != null) v = Math.min(max, v)
  return v
}

/**
 * Lógica pura de confirmación, separada del componente para poder testearla sin
 * un DOM: dado el texto crudo tipeado y el último valor válido, decide el valor
 * final. Vacío o no-numérico revierte al último válido (nunca al `min`) — eso es
 * justamente lo que evita el "no me deja escribir" del antipatrón original.
 */
export const resolveNumberFieldCommit = (
  text: string,
  lastValid: number,
  options: { min?: number; max?: number; allowDecimals?: boolean } = {},
): number => {
  const { min, max, allowDecimals = true } = options
  const trimmed = text.trim()
  if (trimmed === '') return lastValid
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return lastValid
  return clamp(allowDecimals ? parsed : Math.trunc(parsed), min, max)
}

/**
 * Input numérico que mantiene el texto crudo mientras se escribe y solo convierte
 * al confirmar (onBlur o Enter). El antipatrón que reemplaza —estado número,
 * convertido en cada tecla con `Number(e.target.value)`— produce tres síntomas:
 * borrar el campo vuelve al mínimo (Number('') es 0, Math.max(1,0) es 1, y React
 * repinta el 1 en el medio de escribir), el 0 queda pegado adelante por lo mismo,
 * y tipear "12." pierde el punto antes de llegar al decimal (Number('12.') es 12).
 *
 * Mismo criterio que el editor de precio en línea del carrito (CartItem.tsx).
 */
export function NumberField({ value, onCommit, min, max, step, allowDecimals = true, placeholder, className, ariaLabel, autoFocus, disabled, id }: NumberFieldProps) {
  const [text, setText] = useState(String(value))
  const [focused, setFocused] = useState(false)

  // Se resincroniza con `value` desde afuera, salvo mientras el campo tiene foco —
  // si no, un valor que cambia por otra vía (p. ej. otro campo que recalcula este)
  // pisaría lo que el usuario está tipeando en este instante.
  useEffect(() => {
    if (focused) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resincroniza el texto visible con `value` en cuanto cambia desde afuera (y no mientras el campo tiene foco, ver el comentario de arriba)
    setText(String(value))
  }, [value, focused])

  const revert = () => setText(String(value))

  const commit = () => {
    const next = resolveNumberFieldCommit(text, value, { min, max, allowDecimals })
    setText(String(next))
    onCommit(next)
  }

  const onChange = (e: ChangeEvent<HTMLInputElement>) => setText(e.target.value)
  const onBlur = () => { setFocused(false); commit() }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); e.currentTarget.blur() }
    else if (e.key === 'Escape') { e.preventDefault(); revert(); e.currentTarget.blur() }
  }

  return (
    <input
      id={id}
      type="number"
      inputMode={allowDecimals ? 'decimal' : 'numeric'}
      step={step ?? (allowDecimals ? 0.01 : 1)}
      min={min}
      max={max}
      className={className}
      aria-label={ariaLabel}
      placeholder={placeholder}
      autoFocus={autoFocus}
      disabled={disabled}
      value={text}
      onFocus={() => setFocused(true)}
      onChange={onChange}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    />
  )
}
