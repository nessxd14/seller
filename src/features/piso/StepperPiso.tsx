import { Minus, Plus } from 'lucide-react'
import { useState } from 'react'

const fmt = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',')

/** Stepper de 44 px para cantidades en el celular: − / número editable / +. */
export function StepperPiso({ etiqueta, valor, min = 0, max, onCambio }: { etiqueta: string; valor: number; min?: number; max?: number; onCambio: (n: number) => void }) {
  const [texto, setTexto] = useState<string | null>(null)
  const acotar = (n: number) => Math.min(max ?? Infinity, Math.max(min, n))
  return <div className="traslado-stepper" role="group" aria-label={etiqueta}>
    <button type="button" aria-label={`Menos ${etiqueta}`} disabled={valor <= min} onClick={() => onCambio(acotar(valor - 1))}><Minus /></button>
    <input type="text" inputMode="decimal" aria-label={etiqueta} value={texto ?? fmt(valor)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        setTexto(e.target.value)
        const n = Number(e.target.value.replace(',', '.'))
        if (e.target.value.trim() !== '' && Number.isFinite(n)) onCambio(acotar(n))
      }}
      onBlur={() => setTexto(null)} />
    <button type="button" aria-label={`Más ${etiqueta}`} disabled={max != null && valor >= max} onClick={() => onCambio(acotar(valor + 1))}><Plus /></button>
  </div>
}
