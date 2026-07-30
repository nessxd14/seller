import { ArrowRightLeft, Truck } from 'lucide-react'

// Brief J: 1 = Almacén Central, 2 = Tienda (ver nota en PosContext.tsx).
const sucursalLabel: Record<number, string> = { 1: 'Almacén Central', 2: 'Tienda' }

/**
 * Reemplaza a <CustomerPicker> en modo traslado ("selector superior" del brief). La
 * dirección Almacén → Tienda es el default; solo el rol admin puede invertirla (el
 * operario ve la dirección fija, sin controles).
 */
export function TrasladoTargetPicker({ origenId, destinoId, isAdmin, onInvertir }: { origenId: number; destinoId: number; isAdmin: boolean; onInvertir: () => void }) {
  return (
    <div className="traslado-target">
      <Truck />
      <span>
        <small>TRASLADO A</small>
        <strong>{sucursalLabel[origenId] ?? `Sucursal ${origenId}`} → {sucursalLabel[destinoId] ?? `Sucursal ${destinoId}`}</strong>
      </span>
      {isAdmin && (
        <button type="button" className="traslado-target-swap" title="Invertir dirección" aria-label="Invertir dirección del traslado" onClick={onInvertir}>
          <ArrowRightLeft />
        </button>
      )}
    </div>
  )
}
