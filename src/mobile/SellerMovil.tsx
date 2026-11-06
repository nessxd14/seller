import { ArrowLeftRight, BarChart3, Boxes, ClipboardList, FileText, HandCoins, LayoutGrid, LogOut, MoreHorizontal, PauseCircle, Percent, Save, ScanLine, Settings, ShoppingBag, Users, WalletCards, Warehouse, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AuthSession } from '../application/auth/AuthSessionProvider'
import { modulosMas, pestanasPara, type Modulo } from './navegacionMovil'
import './seller-movil.css'

export { VentaMovil } from './VentaMovil'

const ICONOS: Record<Modulo, LucideIcon> = {
  'Venta': ShoppingBag, 'Suspendidas': PauseCircle, 'Borradores': Save, 'Cotizaciones': FileText, 'Pedidos': ClipboardList,
  'Venta Directa': Warehouse, 'Clientes': Users, 'Productos': LayoutGrid, 'Inventario': Boxes, 'Traslados': ArrowLeftRight,
  'Caja': WalletCards, 'Reportes': BarChart3, 'Comisiones': Percent, 'Configuración': Settings,
}
// Nombres cortos para la barra inferior (el espacio es de ~80 px por botón).
const CORTO: Partial<Record<Modulo, string>> = { 'Venta Directa': 'VTD', 'Cotizaciones': 'Cotizar', 'Configuración': 'Ajustes' }

const iniciales = (nombre: string) => nombre.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'

export interface SellerMovilProps {
  session: AuthSession | null
  activo: string
  onNavegar: (modulo: string) => void
  puedeAbrir: (modulo: Modulo) => boolean
  /** true cuando la URL abrió directo un detalle (/pedidos/:id…): no se cambia de módulo al arrancar. */
  rutaDetalle: boolean
  /** Contenido del módulo activo cuando no es Venta (o el aviso de bloqueo). */
  contenido: ReactNode
  /** Pantalla de Venta para celular. */
  venta: ReactNode
  /** Modales, aviso flotante y selector de sesión de prueba: se montan igual que en escritorio. */
  extras: ReactNode
  onRegistrarPago?: () => void
  onPedidoPiso?: () => void
  onCerrarSesion?: () => void
}

export function SellerMovil({ session, activo, onNavegar, puedeAbrir, rutaDetalle, contenido, venta, extras, onRegistrarPago, onPedidoPiso, onCerrarSesion }: SellerMovilProps) {
  const role = session?.user.role
  const pestanas = pestanasPara(role, puedeAbrir)
  const mas = modulosMas(pestanas, puedeAbrir)
  const [masAbierto, setMasAbierto] = useState(false)
  const principal = useRef<HTMLElement>(null)

  // Arranque: el celular abre en la pantalla principal del rol (cajero → Venta, gerente → Caja, reponedor → Traslados).
  // Solo una vez por rol y nunca si la URL ya pidió un detalle.
  const arrancado = useRef<string | null>(null)
  const inicio = pestanas[0]
  useEffect(() => {
    if (!role || !inicio || arrancado.current === role) return
    const cambioDeUsuario = arrancado.current !== null
    arrancado.current = role
    if (cambioDeUsuario) { onNavegar(inicio); return }
    if (rutaDetalle) return
    if (activo === 'Venta' || !puedeAbrir(activo as Modulo)) onNavegar(inicio)
  }, [role, inicio, rutaDetalle, activo, puedeAbrir, onNavegar])

  // Al cambiar de módulo, la vista vuelve arriba.
  useEffect(() => { principal.current?.scrollTo?.({ top: 0 }); window.scrollTo?.({ top: 0 }) }, [activo])

  const ir = (m: string) => { setMasAbierto(false); if (m !== activo) onNavegar(m) }
  const enMas = !pestanas.includes(activo as Modulo)

  return <div className="movil-app" data-modulo={activo}>
    <header className="movil-barra">
      <div className="movil-barra-titulo"><h1>{activo}</h1>{session?.user.name && <small>{session.user.name}</small>}</div>
      <button type="button" className="movil-avatar" aria-label="Cuenta y más opciones" onClick={() => setMasAbierto(true)}>{iniciales(session?.user.name ?? 'Usuario')}</button>
    </header>

    <main ref={principal} className={`movil-contenido ${activo === 'Venta' ? 'es-venta' : 'es-modulo'}`}>
      {activo === 'Venta' ? venta : contenido}
    </main>

    <nav className="movil-tabs" aria-label="Navegación principal">
      {pestanas.map((m) => { const Icono = ICONOS[m]; return <button key={m} type="button" aria-current={m === activo ? 'page' : undefined} onClick={() => ir(m)}><Icono aria-hidden="true" /><span>{CORTO[m] ?? m}</span></button> })}
      <button type="button" aria-current={enMas ? 'page' : undefined} aria-expanded={masAbierto} onClick={() => setMasAbierto(true)}><MoreHorizontal aria-hidden="true" /><span>Más</span></button>
    </nav>

    {masAbierto && <div className="movil-hoja-fondo" role="presentation" onClick={() => setMasAbierto(false)}>
      <section className="movil-hoja" role="dialog" aria-modal="true" aria-label="Más opciones" onClick={(e) => e.stopPropagation()}>
        <header><div><strong>{session?.user.name || 'Usuario'}</strong><small>{role ?? ''}</small></div><button type="button" className="movil-cerrar" aria-label="Cerrar" onClick={() => setMasAbierto(false)}><X /></button></header>
        {(onRegistrarPago || onPedidoPiso) && <div className="movil-acciones">
          {onRegistrarPago && <button type="button" onClick={() => { setMasAbierto(false); onRegistrarPago() }}><HandCoins aria-hidden="true" /> Registrar pago</button>}
          {onPedidoPiso && <button type="button" onClick={() => { setMasAbierto(false); onPedidoPiso() }}><ScanLine aria-hidden="true" /> Pedido de piso</button>}
        </div>}
        {mas.length > 0 && <ul className="movil-modulos">
          {mas.map((m) => { const Icono = ICONOS[m]; return <li key={m}><button type="button" aria-current={m === activo ? 'page' : undefined} onClick={() => ir(m)}><Icono aria-hidden="true" /><span>{m}</span></button></li> })}
        </ul>}
        {onCerrarSesion && <button type="button" className="movil-salir" onClick={onCerrarSesion}><LogOut aria-hidden="true" /> Cerrar sesión</button>}
      </section>
    </div>}

    {extras}
  </div>
}
