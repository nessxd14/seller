// Brief S3 — router mínimo sin dependencias: no hay react-router instalado y agregarlo
// implicaría reescribir toda la navegación por `activeModule` (fuera de alcance de este
// brief). Esto solo cubre lo que S3 pide: rutas compartibles /pedidos/:id,
// /cotizaciones/:id, /ventas/:id que sobrevivan al refresco y se puedan abrir en pestaña
// nueva — no un router general para toda la app.
type Listener = () => void
const listeners = new Set<Listener>()

export const getPathname = (): string => window.location.pathname

export const navigate = (path: string, options?: { replace?: boolean }): void => {
  if (window.location.pathname === path) return
  if (options?.replace) window.history.replaceState({}, '', path)
  else window.history.pushState({}, '', path)
  listeners.forEach((listener) => listener())
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => listeners.forEach((listener) => listener()))
}

export const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
