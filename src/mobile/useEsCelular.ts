import { useSyncExternalStore } from 'react'

/** Por debajo de este ancho el Seller usa la versión celular; desde aquí hacia arriba, el escritorio de siempre. */
export const CONSULTA_CELULAR = '(max-width: 767px)'

const consulta = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(CONSULTA_CELULAR) : null)

const suscribir = (avisar: () => void) => {
  const mq = consulta()
  if (!mq) return () => undefined
  mq.addEventListener('change', avisar)
  return () => mq.removeEventListener('change', avisar)
}

/** true solo en pantallas angostas (teléfonos). Sin matchMedia (pruebas, SSR) siempre es false: escritorio. */
export function useEsCelular(): boolean {
  return useSyncExternalStore(suscribir, () => consulta()?.matches ?? false, () => false)
}
