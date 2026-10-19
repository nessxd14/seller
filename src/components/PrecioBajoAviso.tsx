import { AlertTriangle } from 'lucide-react'
import { esPrecioBajo, textoPrecioBajo } from '../domain/pricing/precioPresentacion'

/**
 * Aviso ámbar y no bloqueante: el precio unitario de la línea es menos de la mitad del precio
 * resuelto de su presentación. Sin precio resuelto (null) no muestra nada.
 */
export function PrecioBajoAviso({ precio, sugerido, presentacionNombre, factor, baseNombre }: {
  precio: number
  sugerido: number | null | undefined
  presentacionNombre?: string
  factor: number
  baseNombre: string
}) {
  if (sugerido == null || !esPrecioBajo(precio, sugerido)) return null
  return <small className="line-price-warning" role="status"><AlertTriangle aria-hidden />{textoPrecioBajo(presentacionNombre, factor, baseNombre, sugerido)}</small>
}
