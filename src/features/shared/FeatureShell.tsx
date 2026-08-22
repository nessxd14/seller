import { AlertCircle, LoaderCircle, Search } from 'lucide-react'
import type { ReactNode } from 'react'

export function FeatureShell({ eyebrow, title, subtitle, action, children }: { eyebrow: string; title: string; subtitle: string; action?: ReactNode; children: ReactNode }) {
  return <main className="feature-page"><header className="feature-header"><div><span>{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>{action}</header>{children}</main>
}

export function FeatureToolbar({ query, onQuery, placeholder, children }: { query: string; onQuery: (value: string) => void; placeholder: string; children?: ReactNode }) {
  return <div className="feature-toolbar"><label><Search /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={placeholder} /></label>{children}</div>
}

export function FeatureState({ type, text, rows = 4 }: { type: 'loading' | 'skeleton' | 'empty' | 'error' | 'no-results'; text: string; rows?: number }) {
  if (type === 'skeleton') return <div className="feature-state-skeleton" aria-busy="true" aria-label={text}>{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton-row"><span className="skeleton-block" /><span className="skeleton-block" /><span className="skeleton-block short" /></div>)}</div>
  return <div className={`feature-state ${type}`}>{type === 'loading' ? <LoaderCircle className="spin" /> : <AlertCircle />}<strong>{text}</strong><span>{type === 'error' ? 'Intenta nuevamente.' : type === 'no-results' ? 'Ajusta la búsqueda o los filtros.' : 'Los datos mock aparecerán aquí.'}</span></div>
}

export const statusLabel: Record<string, string> = { draft: 'Borrador', sent: 'Enviada', negotiating: 'Negociando', approved: 'Aprobada', rejected: 'Rechazada', expired: 'Vencida', converted: 'Convertida', confirmed: 'Confirmado', awaiting_stock: 'Esperando stock', reserved: 'Reservado', preparing: 'Preparando', ready: 'Listo', dispatched: 'Despachado', delivered: 'Entregado', cancelled: 'Cancelado' }

// Brief S-E: chip corto de condición de pago en listados/detalle de pedidos y
// cotizaciones — solo se muestra cuando conditionPago viene especificado (documentos
// viejos o sin especificar quedan en null y no muestran chip, nunca un valor inventado).
export const condicionPagoLabel: Record<string, string> = { CONTADO: 'Contado', CREDITO: 'Crédito' }

// Semantic 3-bucket status color system, shared across Pedidos/Cotizaciones/Inventario.
const statusOk = new Set(['approved', 'converted', 'confirmed', 'delivered', 'ready', 'dispatched', 'ok'])
const statusPending = new Set(['draft', 'sent', 'negotiating', 'awaiting_stock', 'reserved', 'preparing', 'low-stock'])
const statusProblem = new Set(['rejected', 'expired', 'cancelled', 'no-stock'])
export const statusChipClass = (status: string): 'ok' | 'pending' | 'problem' => statusOk.has(status) ? 'ok' : statusProblem.has(status) ? 'problem' : statusPending.has(status) ? 'pending' : 'pending'
