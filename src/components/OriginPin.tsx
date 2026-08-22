import { MapPin } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { configService } from '../infrastructure/services'
import type { SucursalSummary } from '../application/ports/configRepository'

export type OriginLocation = 'Tienda' | 'Almacén'

// TAREA 2: the underlying `sourceLocation`/`ubicacion` TYPE stays the literal
// union 'Tienda' | 'Almacén' — it's threaded through the whole checkout payload
// and changing it would ripple everywhere. What must NOT be hardcoded is the
// DISPLAY label shown to the user, which has to come from configService.listSucursales()'s
// real `nombre` (e.g. "Almacén Central", not the bare literal "Almacén"). This
// keyword match is only used to find WHICH real sucursal row corresponds to a
// given literal — it never becomes the label itself.
const matchesLocation = (sucursalNombre: string, location: OriginLocation) =>
  sucursalNombre.toLocaleLowerCase('es').includes(location.toLocaleLowerCase('es'))

const LOCATIONS: OriginLocation[] = ['Tienda', 'Almacén']

export interface OriginPinOption {
  location: OriginLocation
  stock?: number
  disabledReason?: string
}

/**
 * Shared pin-button + popover for picking a line's origin sucursal. Replaces the
 * old segmented Tienda/Almacén toggle in both CartItem.tsx (retail) and
 * DraftOrderEditor.tsx (mayoreo/institucional/corporativo). Reads real sucursal
 * names from configService.listSucursales() rather than hardcoding labels.
 */
export function OriginPin({ value, options, onChange, ariaLabel }: {
  value: OriginLocation
  options: OriginPinOption[]
  onChange: (location: OriginLocation) => void
  ariaLabel: string
}) {
  const [sucursales, setSucursales] = useState<SucursalSummary[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => { void configService.listSucursales().then(setSucursales) }, [])

  const nameFor = (location: OriginLocation) =>
    sucursales.find((s) => matchesLocation(s.nombre, location))?.nombre ?? location

  useEffect(() => {
    if (!open) return
    const onClickOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  useEffect(() => {
    if (!open) return
    const idx = Math.max(0, options.findIndex((o) => o.location === value))
    // eslint-disable-next-line react-hooks/set-state-in-effect -- popover just opened: activeIndex must reflect the currently-selected option before the first keypress, no external event to defer to
    setActiveIndex(idx)
    // Move focus onto the popover's option list once it's mounted.
    requestAnimationFrame(() => optionRefs.current[idx]?.focus())
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const close = (returnFocus = true) => { setOpen(false); if (returnFocus) triggerRef.current?.focus() }

  const select = (option: OriginPinOption) => {
    if (option.disabledReason) return
    onChange(option.location)
    close()
  }

  const onOptionKeyDown = (event: KeyboardEvent, index: number) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const next = (index + 1) % options.length
      setActiveIndex(next)
      optionRefs.current[next]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      const prev = (index - 1 + options.length) % options.length
      setActiveIndex(prev)
      optionRefs.current[prev]?.focus()
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      select(options[index])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  return <div className="origin-pin-root" ref={rootRef}>
    <button
      type="button"
      ref={triggerRef}
      className="origin-pin-trigger"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label={ariaLabel}
      onClick={() => setOpen((v) => !v)}
    >
      <MapPin /><span>{nameFor(value)}</span>
    </button>
    {open && (
      <div className="origin-pin-popover" role="listbox" aria-label={ariaLabel}>
        {options.map((option, index) => (
          <button
            type="button"
            key={option.location}
            ref={(el) => { optionRefs.current[index] = el }}
            role="option"
            aria-selected={option.location === value}
            tabIndex={index === activeIndex ? 0 : -1}
            className={`origin-pin-option ${option.location === value ? 'active' : ''} ${option.disabledReason ? 'disabled' : ''}`}
            disabled={Boolean(option.disabledReason)}
            onClick={() => select(option)}
            onKeyDown={(e) => onOptionKeyDown(e, index)}
          >
            <span className="origin-pin-option-name">{nameFor(option.location)}</span>
            {option.stock !== undefined && (
              <span className={`origin-pin-option-stock ${option.stock === 0 ? 'zero' : ''}`}>{option.stock.toLocaleString('es-BO')}</span>
            )}
            {option.disabledReason && <small className="origin-pin-option-reason">{option.disabledReason}</small>}
          </button>
        ))}
      </div>
    )}
  </div>
}

// Convenience builder shared by both callers: two fixed rows (Tienda, Almacén),
// each carrying its own stock number and (optionally) a disabled reason.
export const buildOriginOptions = (
  stock: { tienda: number; almacen: number } | undefined,
  disabledReasons?: Partial<Record<OriginLocation, string>>
): OriginPinOption[] =>
  LOCATIONS.map((location) => ({
    location,
    stock: stock ? (location === 'Tienda' ? stock.tienda : stock.almacen) : undefined,
    disabledReason: disabledReasons?.[location],
  }))
