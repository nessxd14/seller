import { ArrowLeftRight, BarChart3, Boxes, ClipboardList, FileText, LayoutGrid, PackageSearch, PauseCircle, Save, Settings, ShoppingBag, Users, WalletCards, Warehouse } from 'lucide-react'
import { empresaStore as empresa } from '../config/empresaStore'

const nav = [
  ['Venta', ShoppingBag], ['Suspendidas', PauseCircle],
  // Brief S1: guardado explícito cross-device (borrador_operacion) — pestaña propia,
  // distinta de Suspendidas (localStorage, solo retail).
  ['Borradores', Save],
  ['Cotizaciones', FileText], ['Pedidos', ClipboardList],
  // Brief VTD, B2: pestaña propia dentro de Ventas — un VTD es una `venta`, no un
  // `pedido`, y el selector Retail/Wholesale de Pedidos no la va a mostrar.
  ['Venta Directa', Warehouse],
  ['Clientes', Users], ['Productos', LayoutGrid],
  ['Inventario', Boxes], ['Traslados', ArrowLeftRight], ['Caja', WalletCards], ['Reportes', BarChart3], ['Configuración', Settings],
] as const

export function PosSidebar({ active = 'Venta', onNavigate = () => undefined }: { active?: string; onNavigate?: (name: string) => void }) {
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark"><PackageSearch /></div><div><strong>{empresa.razonSocial}</strong><span>{empresa.ciudad}</span></div></div>
    <nav aria-label="Navegación principal">{nav.map(([name, Icon]) => <button key={name} onClick={() => onNavigate(name)} className={name === active ? 'active' : ''} title={name}><Icon /><span>{name}</span>{name === 'Pedidos' && <b>3</b>}</button>)}</nav>
    <div className="sidebar-footer"><span className="status-dot" /><div><strong>Sucursal Central</strong><small>Caja 01 · En línea</small></div></div>
  </aside>
}
