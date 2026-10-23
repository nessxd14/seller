import type { OrderView } from '../../../application/shared/models'
import type { PedidoCabecera } from '../../../domain/orders/pedidoEdicion.types'
import type { Product, SalesChannel } from '../../../types'

export const priceForOrderChannel = (product: Product, channel: OrderView['channel'] | SalesChannel): number =>
  channel === 'mayoreo' ? product.precioMayoreo : channel === 'institucional' ? product.precioInstitucional : channel === 'corporativo' ? product.precioCorporativo : product.precioRetail

/** pedido.categoria → canal de precios (el mismo que usa el resto del POS). */
export const canalDeCategoria = (categoria: PedidoCabecera['categoria']): SalesChannel =>
  categoria === 'MAYOR' ? 'mayoreo' : categoria === 'INSTITUCIONAL' ? 'institucional' : categoria === 'CORPORATIVO' ? 'corporativo' : 'retail'
