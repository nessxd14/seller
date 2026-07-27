import { ArrowLeftRight, BarChart3, Boxes, ClipboardList, FileText, LayoutGrid, PackageSearch, PauseCircle, Settings, ShoppingBag, Users, WalletCards } from 'lucide-react'
import { empresaStore as empresa } from '../config/empresaStore'

const nav = [
  ['Venta', ShoppingBag], ['Suspendidas', PauseCircle], ['Cotizaciones', FileText], ['Pedidos', ClipboardList], ['Clientes', Users], ['Productos', LayoutGrid],
  ['Inventario', Boxes], ['Traslados', ArrowLeftRight], ['Caja', WalletCards], ['Reportes', BarChart3], ['Configuración', Settings],
] as const

export function PosSidebar({ active = 'Venta', onNavigate = () => undefined }: { active?: string; onNavigate?: (name: string) => void }) {
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark"><PackageSearch /></div><div><strong>{empresa.razonSocial}</strong><span>{empresa.ciudad}</span></div></div>
    <nav aria-label="Navegación principal">{nav.map(([name, Icon]) => <button key={name} onClick={() => onNavigate(name)} className={name === active ? 'active' : ''} title={name}><Icon /><span>{name}</span>{name === 'Pedidos' && <b>3</b>}</button>)}</nav>
    <div className="sidebar-footer"><span className="status-dot" /><div><strong>Sucursal Central</strong><small>Caja 01 · En línea</small></div></div>
  </aside>
}
