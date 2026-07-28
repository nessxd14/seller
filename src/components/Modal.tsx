import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// `escapeToClose` (default true): lets a modal that currently has ANOTHER modal
// nested/portalled on top of it (e.g. DraftOrderEditor's custom-item capture modal)
// suppress its own Escape handler while the inner one is open — otherwise a single
// Escape press would fire BOTH modals' window keydown listeners and close both at
// once, when the intent is only to close the topmost one.
export function Modal({ title, subtitle, onClose, children, wide = false, side = false, escapeToClose = true }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean; side?: boolean; escapeToClose?: boolean }) {
  useEffect(() => {
    if (!escapeToClose) return
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose, escapeToClose])
  return createPortal(
    <div className={`modal-backdrop ${side ? 'side-backdrop' : ''}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`modal ${wide ? 'wide' : ''} ${side ? 'side-panel' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button onClick={onClose} aria-label="Cerrar"><X /></button></header>{children}</section></div>,
    document.body
  )
}
