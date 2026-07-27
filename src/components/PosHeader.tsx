import { Menu, Plus, ScanBarcode, Search, Settings } from 'lucide-react'

const initialsOf = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '').join('') || '?'

export function PosHeader({ search, setSearch, onNew, user, onOpenSettings }: { search: string; setSearch: (value: string) => void; onNew: () => void; user?: { name: string; role: string }; onOpenSettings?: () => void }) {
  return <header className="topbar">
    <button className="icon-button mobile-menu" aria-label="Abrir menú"><Menu /></button>
    <div className="global-search"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar productos por nombre, código o SKU..." aria-label="Buscar productos" /><kbd>F2</kbd><button aria-label="Escanear código de barras" onClick={() => document.querySelector<HTMLInputElement>('.global-search input')?.focus()}><ScanBarcode /></button></div>
    <div className="header-actions"><button className="icon-button" aria-label="Configuración" onClick={onOpenSettings}><Settings /></button><div className="profile"><span>{initialsOf(user?.name ?? 'Usuario POS')}</span><div><strong>{user?.name ?? 'Usuario POS'}</strong><small>{user?.role ?? ''}</small></div></div><button className="primary-button" onClick={onNew}><Plus /> Nueva operación</button></div>
  </header>
}
