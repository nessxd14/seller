import type { CartItem, SalesChannel } from '../../types'
import type { CartCustomer } from '../../context/PosContext'
import type { TransferMotivo } from '../../application/shared/models'

// Brief S1 — forma de `borrador_operacion.contenido` (jsonb) según `tipo`. Deliberadamente
// espejo de PosContext's cart + campos por modo: es la misma "foto" que ya arma
// CartPanel.borradorEstado para el autosave local, pero acá viaja al servidor.
export interface BorradorContenidoVenta {
  tipo: 'VENTA'
  channel: SalesChannel
  cart: CartItem[]
  discount: number
  customer: CartCustomer | null
}

export interface BorradorContenidoVentaDirecta {
  tipo: 'VENTA_DIRECTA'
  cart: CartItem[]
  vtdUbicacionId: number | null
  vtdPrecobrado: boolean
}

export interface BorradorContenidoTraslado {
  tipo: 'TRASLADO'
  cart: CartItem[]
  trasladoMotivo: TransferMotivo
  trasladoOrigenId: number
  trasladoDestinoId: number
}

export type BorradorContenido = BorradorContenidoVenta | BorradorContenidoVentaDirecta | BorradorContenidoTraslado

/** Todo contenido de borrador operativo carga un carrito — usado para revalidar. */
export const carritoDe = (contenido: BorradorContenido): CartItem[] => contenido.cart
