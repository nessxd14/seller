import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function Modal({ title, subtitle, onClose, children, wide = false, side = false }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean; side?: boolean }) {
  useEffect(() => { const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose(); window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close) }, [onClose])
  return createPortal(
    <div className={`modal-backdrop ${side ? 'side-backdrop' : ''}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`modal ${wide ? 'wide' : ''} ${side ? 'side-panel' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button onClick={onClose} aria-label="Cerrar"><X /></button></header>{children}</section></div>,
    document.body
  )
}
