import { navigate } from './history'

/**
 * Brief S3 Parte A: "Ctrl+clic en la lista abre pestaña nueva — si no es un enlace, el
 * clic con rueda o Ctrl+clic no abre pestaña". Ancla real, superpuesta a toda la fila
 * (stretched-link) para no tocar el grid/CSS existente de `.feature-table>article` — un
 * click normal navega por SPA (pushState, sin recargar); Ctrl/Cmd/click-rueda quedan sin
 * `preventDefault` y el navegador abre la pestaña nueva con su comportamiento nativo.
 */
export function RowLink({ href, label, onNavigate }: { href: string; label: string; onNavigate?: () => void }) {
  return (
    <a
      className="row-stretched-link"
      href={href}
      aria-label={label}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        navigate(href)
        onNavigate?.()
      }}
    />
  )
}
