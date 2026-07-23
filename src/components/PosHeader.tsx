import { Bell, Menu, Plus, ScanBarcode, Search, Settings } from 'lucide-react'

export function PosHeader({ search, setSearch, onNew }: { search: string; setSearch: (value: string) => void; onNew: () => void }) {
  return <header className="topbar">
    <button className="icon-button mobile-menu" aria-label="Abrir menú"><Menu /></button>
    <div className="global-search"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar productos por nombre, código o SKU..." aria-label="Buscar productos" /><kbd>F2</kbd><button aria-label="Escanear código de barras"><ScanBarcode /></button></div>
    <div className="header-actions"><button className="icon-button has-alert" aria-label="Notificaciones"><Bell /></button><button className="icon-button" aria-label="Configuración"><Settings /></button><div className="profile"><span>NS</span><div><strong>Natalia S.</strong><small>Cajera</small></div></div><button className="primary-button" onClick={onNew}><Plus /> Nueva operación</button></div>
  </header>
}
