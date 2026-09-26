import { X } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// `escapeToClose` (default true): lets a modal that currently has ANOTHER modal
// nested/portalled on top of it (e.g. DraftOrderEditor's custom-item capture modal)
// suppress its own Escape handler while the inner one is open — otherwise a single
// Escape press would fire BOTH modals' window keydown listeners and close both at
// once, when the intent is only to close the topmost one.
export function Modal({ title, subtitle, onClose, children, wide = false, side = false, escapeToClose = true, className = '' }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean; side?: boolean; escapeToClose?: boolean; className?: string }) {
  const dialogRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const closeCurrent = useEffectEvent(() => { if (escapeToClose) onClose() })
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previousFocus = returnFocusRef.current
    const isTopmost = () => Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).at(-1) === dialog
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
    const focusFirst = () => {
      const available = controls()
      const field = available.find((element) => element.matches('input, select, textarea'))
      ;(field ?? available[0] ?? dialog).focus({ preventScroll: true })
    }
    const frame = requestAnimationFrame(() => {
      if (isTopmost() && !dialog.contains(document.activeElement)) focusFirst()
    })
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopmost() || event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        closeCurrent()
      } else if (event.key === 'Tab') {
        const available = controls()
        const current = available.indexOf(document.activeElement as HTMLElement)
        const next = current < 0 ? (event.shiftKey ? available.length - 1 : 0) : (current + (event.shiftKey ? -1 : 1) + available.length) % available.length
        event.preventDefault()
        ;(available[next] ?? dialog).focus()
      }
    }
    const onFocusIn = (event: FocusEvent) => {
      if (isTopmost() && !dialog.contains(event.target as Node)) focusFirst()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('focusin', onFocusIn)
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])
  return createPortal(
    <div className={`modal-backdrop ${side ? 'side-backdrop' : ''}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section ref={dialogRef} tabIndex={-1} className={`modal ${wide ? 'wide' : ''} ${side ? 'side-panel' : ''} ${className}`} role="dialog" aria-modal="true" aria-label={title}><header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" onClick={onClose} aria-label="Cerrar"><X /></button></header>{children}</section></div>,
    document.body
  )
}
