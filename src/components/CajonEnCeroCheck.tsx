// Un conteo en cero solo se acepta si el cajero declara explícitamente "el cajón está en cero".
export function CajonEnCeroCheck({ checked, onChange, disabled }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className="cash-cero-check"><input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /> El cajón está en cero</label>
}
