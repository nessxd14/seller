import { AlertCircle, LoaderCircle, Search } from 'lucide-react'
import type { ReactNode } from 'react'

export function FeatureShell({ eyebrow, title, subtitle, action, children }: { eyebrow: string; title: string; subtitle: string; action?: ReactNode; children: ReactNode }) {
  return <main className="feature-page"><header className="feature-header"><div><span>{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>{action}</header>{children}</main>
}

export function FeatureToolbar({ query, onQuery, placeholder, children }: { query: string; onQuery: (value: string) => void; placeholder: string; children?: ReactNode }) {
  return <div className="feature-toolbar"><label><Search /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={placeholder} /></label>{children}</div>
}

export function FeatureState({ type, text }: { type: 'loading' | 'empty' | 'error' | 'no-results'; text: string }) {
  return <div className={`feature-state ${type}`}>{type === 'loading' ? <LoaderCircle className="spin" /> : <AlertCircle />}<strong>{text}</strong><span>{type === 'error' ? 'Intenta nuevamente.' : type === 'no-results' ? 'Ajusta la búsqueda o los filtros.' : 'Los datos mock aparecerán aquí.'}</span></div>
}

export const statusLabel: Record<string, string> = { draft: 'Borrador', sent: 'Enviada', negotiating: 'Negociando', approved: 'Aprobada', rejected: 'Rechazada', expired: 'Vencida', converted: 'Convertida', confirmed: 'Confirmado', awaiting_stock: 'Esperando stock', reserved: 'Reservado', preparing: 'Preparando', ready: 'Listo', dispatched: 'Despachado', delivered: 'Entregado', cancelled: 'Cancelado' }

