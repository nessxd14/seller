import type { CobroDestino } from './useCobroDestino'

/** Elección obligatoria (gerente/admin, efectivo): ¿el efectivo entró al cajón o lo recibe gerencia? */
export function CobroDestinoField({ value, onChange, disabled = false }: { value: CobroDestino | null; onChange: (value: CobroDestino) => void; disabled?: boolean }) {
  return <fieldset className="full cobro-destino" disabled={disabled}>
    <span>¿Dónde queda el efectivo?</span>
    <label><input type="radio" name="cobro-destino" checked={value === 'cajon'} onChange={() => onChange('cajon')} /> En el cajón del turno</label>
    <label><input type="radio" name="cobro-destino" checked={value === 'fuera'} onChange={() => onChange('fuera')} /> Lo recibo yo — fuera del arqueo</label>
  </fieldset>
}
