import { useEffect, useState } from 'react'
import { Warehouse } from 'lucide-react'
import { ventaDirectaService } from '../infrastructure/services'
import type { UbicacionOption } from '../infrastructure/supabase/VentaDirectaRepository.supabase'

/**
 * Brief VTD 2.1: "no hardcodear la ubicación... si hay más de una, el cajero elige".
 * Se carga una vez por montaje (Almacén Central puede tener varias ubicaciones — hoy 16
 * en producción) y, si solo hay una, se preselecciona sola sin mostrar el selector.
 */
export function VtdUbicacionPicker({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const [options, setOptions] = useState<UbicacionOption[] | null>(null)
  useEffect(() => {
    void ventaDirectaService.listUbicaciones().then((list) => {
      setOptions(list)
      if (list.length === 1 && value == null) onChange(list[0].id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!options) return <div className="vtd-ubicacion-picker vtd-ubicacion-loading"><Warehouse /><span>Cargando ubicaciones de Almacén Central…</span></div>
  if (!options.length) return <div className="vtd-ubicacion-picker vtd-ubicacion-empty"><Warehouse /><span>Almacén Central no tiene ubicaciones configuradas.</span></div>
  return (
    <div className="vtd-ubicacion-picker">
      <Warehouse />
      <label>
        <small>UBICACIÓN DE ORIGEN</small>
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
          <option value="" disabled>Elegí una ubicación…</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </label>
    </div>
  )
}
