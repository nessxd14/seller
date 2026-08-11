// Brief S11 Bloque B3: puede_eliminarse_pedido es la única fuente de verdad — esto solo
// mapea su jsonb a una decisión de UI (ofrecer eliminar / no ofrecer y explicar por qué).
// No reimplementa la regla (append-only del Kardex): el jsonb ya trae `puedeBorrarse`
// calculado; acá solo se decide qué mostrarle al cajero.
export interface PuedeEliminarsePedidoInfo {
  existe: boolean
  despachadas: number
  movioKardex: boolean
  puedeBorrarse: boolean
}

export type DeletePedidoDecision = { kind: 'ready' } | { kind: 'blocked'; reason: string }

export const decidirEliminacionPedido = (check: PuedeEliminarsePedidoInfo): DeletePedidoDecision => {
  if (!check.existe) return { kind: 'blocked', reason: 'El pedido ya no existe.' }
  if (!check.puedeBorrarse) {
    return {
      kind: 'blocked',
      reason: check.despachadas > 0 || check.movioKardex
        ? `Este pedido ya despachó mercadería (${check.despachadas} línea${check.despachadas === 1 ? '' : 's'} despachada${check.despachadas === 1 ? '' : 's'}) y movió Kardex — no se puede eliminar sin dejar movimientos huérfanos. Anulalo en vez de borrarlo, para conservar la trazabilidad.`
        : 'Este pedido no se puede eliminar.',
    }
  }
  return { kind: 'ready' }
}
