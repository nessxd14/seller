// Brief P1: única fuente de verdad para qué categorías componen cada segmento de la
// pantalla de Pedidos. Nunca repetir estos literales en un componente — si mañana se
// agrega una categoría, se toca este archivo y nada más.
//
// Filtrar SIEMPRE por `pedido.categoria`, nunca por el prefijo de `pedido.numero`: desde
// la migración del 2026-08-17 los pedidos retail nuevos llevan TKT-2026-NNNNN, pero los
// 221 pedidos retail históricos conservan PED-2026-NNNNN (inmutable, un trigger lo
// impide). El prefijo indica cuándo se creó el pedido, no qué tipo es.
export type CategoriaPedido = 'TIENDA' | 'MAYOR' | 'INSTITUCIONAL' | 'MUNICIPAL'
export type SegmentoPedido = 'retail' | 'wholesale' | 'todos'

export const SEGMENTOS_PEDIDO: Record<Exclude<SegmentoPedido, 'todos'>, CategoriaPedido[]> = {
  retail: ['TIENDA'],
  wholesale: ['MAYOR', 'INSTITUCIONAL', 'MUNICIPAL'],
}

/** undefined = sin filtro (todas las categorías). */
export const categoriasDeSegmento = (segmento: SegmentoPedido): CategoriaPedido[] | undefined =>
  segmento === 'todos' ? undefined : SEGMENTOS_PEDIDO[segmento]
