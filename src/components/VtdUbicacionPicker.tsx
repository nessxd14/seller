import { useEffect, useState } from 'react'
import { Warehouse } from 'lucide-react'
import { ventaDirectaService } from '../infrastructure/services'

/**
 * Brief VTD ubicación fija: Venta Directa ya no despacha desde cualquiera de las 16
 * ubicaciones de Almacén Central — desde ahora siempre desde la única ubicación
 * 'VENTAS DIRECTAS' (sucursal_id=1), resuelta en runtime (nunca hardcodeada, el id lo
 * asigna la base). No hay nada para que el cajero elija; se resuelve sola al montar.
 */
export function VtdUbicacionPicker({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    void ventaDirectaService.getUbicacionVentasDirectas().then((id) => { onChange(id); setLoaded(true) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!loaded) return <div className="vtd-ubicacion-picker vtd-ubicacion-loading"><Warehouse /><span>Cargando ubicación de Almacén Central…</span></div>
  return (
    <div className="vtd-ubicacion-picker">
      <Warehouse />
      <label>
        <small>UBICACIÓN DE ORIGEN</small>
        <span className="vtd-ubicacion-fija">Almacén Central</span>
      </label>
    </div>
  )
}
