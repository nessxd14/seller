/** Separación mínima entre refrescos disparados por focus / visibilitychange. */
export const FOCUS_REFRESH_MIN_GAP_MS = 15_000

/**
 * Al volver a la ventana el navegador dispara `focus` y `visibilitychange` casi a la vez, y
 * varios proveedores refrescan por cada uno. El gate deja pasar solo la primera ejecución
 * dentro de `minGapMs` e ignora las que llegan con la pestaña oculta. Los intervalos y los
 * `refresh()` explícitos no pasan por el gate.
 */
export function createRefreshGate(minGapMs: number = FOCUS_REFRESH_MIN_GAP_MS): (fn: () => void) => void {
  let lastRunAt = Number.NEGATIVE_INFINITY
  return (fn) => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    const now = Date.now()
    if (now - lastRunAt < minGapMs) return
    lastRunAt = now
    fn()
  }
}
