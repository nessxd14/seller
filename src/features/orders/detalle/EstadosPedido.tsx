import type { PedidoEstados } from '../../../domain/orders/pedidoEdicion.types'
import { Chip, type ChipTone } from './Chip'
import { bs } from './formato'

const COMERCIAL: Record<PedidoEstados['comercial'], { texto: string; tono: ChipTone }> = {
  ABIERTO: { texto: 'Abierto', tono: 'gray' },
  CERRADO: { texto: 'Cerrado', tono: 'green' },
  CANCELADO: { texto: 'Cancelado', tono: 'red' },
}
const SURTIDO: Record<PedidoEstados['surtido'], { texto: string; tono: ChipTone }> = {
  SIN_DESPACHAR: { texto: 'Por despachar', tono: 'gray' },
  PARCIAL: { texto: 'Parcial', tono: 'amber' },
  DESPACHADO: { texto: 'Despachada', tono: 'green' },
}
const PAGO: Record<PedidoEstados['pago'], { texto: string; tono: ChipTone }> = {
  PENDIENTE: { texto: 'Pendiente', tono: 'gray' },
  PARCIAL: { texto: 'Pago parcial', tono: 'blue' },
  PAGADO: { texto: 'Pagado', tono: 'green' },
}
const DEVOLUCION: Record<PedidoEstados['devolucion'], { texto: string; tono: ChipTone }> = {
  NINGUNA: { texto: 'Ninguna', tono: 'gray' },
  PARCIAL: { texto: 'Parcial', tono: 'amber' },
  TOTAL: { texto: 'Total', tono: 'red' },
}

/** Cuatro mosaicos: Comercial, Surtido, Pago y Devolución. */
export function EstadosPedido({ estados, total }: { estados: PedidoEstados; total: number }) {
  const comercial = COMERCIAL[estados.comercial]
  const surtido = SURTIDO[estados.surtido]
  const pago = PAGO[estados.pago]
  const devolucion = DEVOLUCION[estados.devolucion]
  return <ul className="ped-estados" aria-label="Estados del pedido">
    <li><span className="ped-estado-titulo">Comercial</span><Chip tone={comercial.tono}>{comercial.texto}</Chip></li>
    <li><span className="ped-estado-titulo">Surtido</span><Chip tone={surtido.tono}>{surtido.texto}</Chip><small>{estados.lineas_despachadas} de {estados.lineas_total} líneas despachadas</small></li>
    <li><span className="ped-estado-titulo">Pago</span><Chip tone={pago.tono}>{pago.texto}</Chip><small>{bs(estados.pagado)} de {bs(total)}</small></li>
    <li><span className="ped-estado-titulo">Devolución</span><Chip tone={devolucion.tono}>{devolucion.texto}</Chip></li>
  </ul>
}
