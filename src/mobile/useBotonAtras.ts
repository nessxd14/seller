import { useEffect, useEffectEvent } from 'react'

/** Evento para que la pantalla de Venta cierre su hoja del carrito (Atrás de Android). */
export const CERRAR_CARRITO = 'movil:cerrar-carrito'

// Capas que el botón Atrás debe cerrar antes de salir del módulo: ventanas modales
// (las de escritorio y la hoja "Más") y la hoja del carrito.
const DIALOGOS = '[role="dialog"][aria-modal="true"]'
const contarCapas = () => document.querySelectorAll(DIALOGOS).length + (document.querySelector('.movil-carrito.abierto') ? 1 : 0)

/**
 * Atrás de Android en la versión celular:
 * 1) si hay una ventana o el carrito abiertos, los cierra (la ventana de arriba recibe Escape, como en escritorio);
 * 2) si no, vuelve al módulo anterior; desde el primer módulo, Android sale de la app como siempre.
 * Cada capa abierta suma una entrada al historial con la misma URL, así que las rutas
 * (/pedidos/:id…) y la versión de escritorio no se enteran.
 */
export function useBotonAtras(activo: string, onNavegar: (modulo: string) => void) {
  const navegar = useEffectEvent((modulo: string) => { if (modulo !== activo) onNavegar(modulo) })

  // Una entrada por módulo visitado.
  useEffect(() => {
    const estado = window.history.state as { movilModulo?: string } | null
    if (estado?.movilModulo === activo) return
    if (estado?.movilModulo) window.history.pushState({ ...estado, movilModulo: activo, movilCapa: 0 }, '')
    else window.history.replaceState({ ...(estado ?? {}), movilModulo: activo, movilCapa: 0 }, '')
  }, [activo])

  useEffect(() => {
    let apiladas = 0 // entradas de historial que agregamos por capas abiertas
    let ignorar = 0 // retrocesos que hicimos nosotros al cerrar una capa con su propio botón

    const sincronizar = () => {
      const abiertas = contarCapas()
      while (apiladas < abiertas) {
        apiladas += 1
        window.history.pushState({ ...(window.history.state ?? {}), movilCapa: apiladas }, '')
      }
      if (apiladas > abiertas) {
        // Se cerró con su botón: devolvemos esas entradas para que Atrás no "cierre" algo que ya no está.
        // Solo si la entrada de arriba sigue siendo nuestra: si la ventana se cerró navegando
        // (p. ej. "Editar pedido" → /pedidos/:id/editar), retroceder desharía esa navegación.
        const sobran = apiladas - abiertas
        const tope = (window.history.state as { movilCapa?: number } | null)?.movilCapa
        apiladas = abiertas
        if (tope === abiertas + sobran) { ignorar += 1; window.history.go(-sobran) }
      }
    }

    const alRetroceder = (evento: PopStateEvent) => {
      if (ignorar > 0) { ignorar -= 1; return }
      if (apiladas > 0) {
        apiladas -= 1
        const dialogos = document.querySelectorAll(DIALOGOS)
        if (dialogos.length) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        else window.dispatchEvent(new Event(CERRAR_CARRITO))
        return
      }
      const modulo = (evento.state as { movilModulo?: string } | null)?.movilModulo
      if (modulo) navegar(modulo)
    }

    const observador = new MutationObserver(() => sincronizar())
    observador.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-modal'] })
    window.addEventListener('popstate', alRetroceder)
    sincronizar()
    return () => { observador.disconnect(); window.removeEventListener('popstate', alRetroceder) }
  }, [])
}
