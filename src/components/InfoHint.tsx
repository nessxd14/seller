import { Info } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'

/**
 * Brief Caja "i": botón chico que abre un popover con título y un párrafo. Mismo trigger
 * visual que ProductInfoPopover (product-info-trigger + lucide Info). Se abre con clic/toque
 * y con Enter/Espacio; se cierra con Escape y con clic fuera. Vive dentro de filas clicables
 * y de <summary>, así que ningún evento propio sube al padre.
 */
export function InfoHint({ title, text, className }: { title: string; text: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: globalThis.MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    // Captura + stopPropagation: dentro de un Modal, un solo Escape cierra solo el popover.
    const onKeyDown = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); triggerRef.current?.focus() } }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown as unknown as EventListener)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown as unknown as EventListener)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  // Dentro de un <summary> un clic alterna el <details>: preventDefault + stopPropagation lo evitan.
  const swallow = (event: MouseEvent) => { event.stopPropagation(); event.preventDefault() }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); setOpen((value) => !value) }
  }

  return <span ref={rootRef} className={`info-hint ${className ?? ''}`.trim()} onClick={swallow} onKeyUp={(event) => { if (event.key === ' ') { event.preventDefault(); event.stopPropagation() } }}>
    <button
      ref={triggerRef}
      type="button"
      className="product-info-trigger info-hint-trigger"
      aria-label={`Qué es ${title}`}
      aria-expanded={open}
      aria-controls={open ? popoverId : undefined}
      onClick={(event) => { swallow(event); setOpen((value) => !value) }}
      onKeyDown={onKeyDown}
    ><Info /></button>
    {open && <span id={popoverId} role="dialog" aria-label={title} className="info-hint-popover">
      <strong>{title}</strong>
      <span>{text}</span>
    </span>}
  </span>
}
