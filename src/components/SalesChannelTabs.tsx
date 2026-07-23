import { Building2, Store, Warehouse } from 'lucide-react'
import { usePos } from '../context/PosContext'
import type { SalesChannel } from '../types'

const tabs: { id: SalesChannel; label: string; note: string; icon: typeof Store }[] = [
  { id: 'retail', label: 'Retail', note: 'Venta directa', icon: Store },
  { id: 'mayoreo', label: 'Mayoreo', note: 'Precio mayorista', icon: Warehouse },
  { id: 'institucional', label: 'Institucional', note: 'Convenios', icon: Building2 },
]

export function SalesChannelTabs() {
  const { channel, setChannel } = usePos()
  return <div className="channel-wrap"><span className="eyebrow">CANAL COMERCIAL</span><div className="channel-tabs">{tabs.map(({ id, label, note, icon: Icon }) => <button key={id} className={channel === id ? 'active' : ''} onClick={() => setChannel(id)}><Icon /><span><strong>{label}</strong><small>{note}</small></span></button>)}</div></div>
}
