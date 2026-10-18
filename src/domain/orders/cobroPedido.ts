export type EstadoCobroPedido = 'pagado' | 'parcial' | 'por_verificar' | 'pendiente' | 'sin_pendiente' | 'cancelado' | 'revisar' | 'sin_partida' | 'no_aplica' | 'no_disponible'

export interface CobroPedido {
  estado: EstadoCobroPedido
  totalCents: number
  aplicadoCents: number
  enRevisionCents: number
  pendienteCents: number
  porCobrarCents: number
  partidas: number
  partidasSaldadas?: number
}

export const etiquetasCobro: Record<EstadoCobroPedido, string> = {
  pagado: 'Pagado', parcial: 'Abono parcial', por_verificar: 'Por verificar', pendiente: 'Pendiente',
  sin_pendiente: 'Sin importe pendiente', cancelado: 'Cancelado', revisar: 'Revisar cobro',
  sin_partida: 'Sin partida', no_aplica: 'Cobro en Caja', no_disponible: 'Cobro no disponible',
}

export const cobroNoDisponible: CobroPedido = {
  estado: 'no_disponible', totalCents: 0, aplicadoCents: 0, enRevisionCents: 0,
  pendienteCents: 0, porCobrarCents: 0, partidas: 0,
}
