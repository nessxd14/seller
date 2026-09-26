import { ArrowLeftRight, BarChart3, Boxes, ClipboardList, FileText, LayoutGrid, PackageSearch, PauseCircle, Percent, Save, Settings, ShoppingBag, Users, WalletCards, Warehouse } from 'lucide-react'
import { useEffect, useState } from 'react'
import { empresaStore as empresa } from '../config/empresaStore'
import { useCashSession } from '../context/CashSessionContext'
import { turnoService } from '../infrastructure/services'
import { featureFlags } from '../config/featureFlags'

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
  ['Inventario', Boxes], ['Traslados', ArrowLeftRight], ['Caja', WalletCards], ['Reportes', BarChart3], ['Comisiones', Percent], ['Configuración', Settings],
] as const

// Brief Caja-1 B2: el pie ya no es texto fijo — refleja el turno real ("Caja Tienda ·
// Turno de <nombre>" o "Caja cerrada"). En modo mock no hay turno de cajero (ver
// CashPage.tsx), así que conserva el texto de siempre.
function useTurnoFooterLabel(sessionId: string | null): string {
  const [label, setLabel] = useState('Caja 01 · En línea')
  useEffect(() => {
    if (!featureFlags.supabase) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refleja el turno abierto/cerrado en cuanto cambia sessionId
    if (!sessionId) { setLabel('Caja cerrada'); return }
    let cancelled = false
    void turnoService.getSesionAbierta().then((sesion) => {
      if (cancelled) return
      setLabel(sesion ? `${sesion.cajaNombre} · Turno de ${sesion.abiertaPor ?? 'cajero'}` : 'Caja cerrada')
    })
    return () => { cancelled = true }
  }, [sessionId])
  return label
}

export function PosSidebar({ active = 'Venta', onNavigate = () => undefined }: { active?: string; onNavigate?: (name: string) => void }) {
  const { sessionId } = useCashSession()
  const turnoLabel = useTurnoFooterLabel(sessionId)
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark"><PackageSearch /></div><div><strong>{empresa.razonSocial}</strong><span>{empresa.ciudad}</span></div></div>
    <nav aria-label="Navegación principal">{nav.map(([name, Icon]) => <button key={name} onClick={() => onNavigate(name)} className={name === active ? 'active' : ''} title={name}><Icon /><span>{name}</span>{name === 'Pedidos' && <b>3</b>}</button>)}</nav>
    <div className="sidebar-footer"><span className={`status-dot ${sessionId ? '' : 'status-dot-off'}`} /><div><strong>Sucursal Central</strong><small>{turnoLabel}</small></div></div>
  </aside>
}
