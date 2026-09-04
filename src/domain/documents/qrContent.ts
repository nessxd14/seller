import { pedidoPath } from '../../router/appRoute'

// Brief "Rediseño de documentos exportables": el contenido exacto de la URL que va en
// el QR de la nota de entrega y del pedido queda pendiente de coordinar (el agente de
// Telegram y el personal de almacén tienen que poder resolverlo). Mientras eso se
// define, se apunta al detalle del pedido dentro del propio Seller — es lo único
// navegable hoy y sirve para escanear-y-verificar en el momento. Cambiar SOLO acá si
// se define un esquema distinto (ej. un endpoint propio para el bot de Telegram).
const appOrigin = (): string => (typeof window !== 'undefined' ? window.location.origin : '')

/** QR del pedido: identifica el pedido para consultar su estado escaneando un papel viejo. */
export const qrContentForPedido = (orderId: string): string => `${appOrigin()}${pedidoPath(orderId)}`

/** QR de la nota de entrega: identifica el despacho — el agente de Telegram la usa como
 * fuente de verdad en vez del caption escrito a mano. Lleva el número de NE como
 * referencia además del pedido de origen. */
export const qrContentForNotaEntrega = (orderId: string, notaEntregaNumber: string): string =>
  `${appOrigin()}${pedidoPath(orderId)}?ne=${encodeURIComponent(notaEntregaNumber)}`
