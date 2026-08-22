import { ArrowLeftRight, Briefcase, Building2, PackageCheck, RotateCcw, Store, Warehouse } from 'lucide-react'
import { usePos } from '../context/PosContext'
import type { SalesChannel } from '../types'
import type { TransferMotivo } from '../application/shared/models'

const tabs: { id: SalesChannel; label: string; note: string; icon: typeof Store }[] = [
  { id: 'retail', label: 'Retail', note: 'Venta directa', icon: Store },
  { id: 'mayoreo', label: 'Mayoreo', note: 'Precio mayorista', icon: Warehouse },
  { id: 'institucional', label: 'Institucional', note: 'Convenios', icon: Building2 },
  { id: 'corporativo', label: 'Corporativo', note: 'Empresas privadas', icon: Briefcase },
]

// Brief J: en modo traslado esta misma fila de pestañas pasa a elegir el motivo del
// traslado en vez del canal de venta.
const motivoTabs: { id: TransferMotivo; label: string; note: string; icon: typeof Store }[] = [
  { id: 'REPOSICION', label: 'Reposición', note: 'Surtido de stock', icon: PackageCheck },
  { id: 'VENTA_DIRECTA', label: 'Venta directa', note: 'Contra un pedido', icon: ArrowLeftRight },
  { id: 'DEVOLUCION', label: 'Devolución', note: 'Vuelve a Almacén', icon: RotateCcw },
]

export function SalesChannelTabs() {
  const { channel, setChannel, mode, trasladoMotivo, setTrasladoMotivo } = usePos()
  if (mode === 'traslado') {
    return <div className="channel-wrap"><span className="eyebrow">MOTIVO DEL TRASLADO</span><div className="channel-tabs">{motivoTabs.map(({ id, label, note, icon: Icon }) => <button key={id} className={trasladoMotivo === id ? 'active' : ''} onClick={() => setTrasladoMotivo(id)}><Icon /><span><strong>{label}</strong><small>{note}</small></span></button>)}</div></div>
  }
  return <div className="channel-wrap"><span className="eyebrow">CANAL COMERCIAL</span><div className="channel-tabs">{tabs.map(({ id, label, note, icon: Icon }) => <button key={id} className={channel === id ? 'active' : ''} onClick={() => setChannel(id)}><Icon /><span><strong>{label}</strong><small>{note}</small></span></button>)}</div></div>
}
