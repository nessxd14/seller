// Brief S11 Bloque B4: puede_eliminarse_cliente + verificar-cliente (Hermes) son la única
// fuente de verdad — esto solo mapea sus resultados a una decisión de UI. Orden estricto:
// primero el historial local (Cation), después Hermes — y si Hermes no responde, se
// bloquea igual (decisión de Ness: más seguro no borrar que borrar algo que estaba allá).
export interface PuedeEliminarseClienteInfo {
  existe: boolean
  nombre: string
  ventas: number
  pedidos: number
  cotizaciones: number
  movimientosCaja: number
  puedeBorrarse: boolean
}

export type VerificarHermesEstado = 'existe' | 'no-existe' | 'no-disponible'

export type DeleteClienteDecision = { kind: 'ready' } | { kind: 'blocked'; reason: string }

/** `hermesEstado` es `null` cuando el chequeo local ya bloqueó y nunca hizo falta
 *  consultar Hermes (el llamador no tiene por qué haber hecho esa llamada). */
export const decidirEliminacionCliente = (local: PuedeEliminarseClienteInfo, hermesEstado: VerificarHermesEstado | null): DeleteClienteDecision => {
  if (!local.existe) return { kind: 'blocked', reason: 'Este cliente ya no existe.' }
  if (!local.puedeBorrarse) {
    return {
      kind: 'blocked',
      reason: `"${local.nombre}" tiene historial (${local.ventas} venta${local.ventas === 1 ? '' : 's'}, ${local.pedidos} pedido${local.pedidos === 1 ? '' : 's'}, ${local.cotizaciones} cotización${local.cotizaciones === 1 ? '' : 'es'}, ${local.movimientosCaja} movimiento${local.movimientosCaja === 1 ? '' : 's'} de caja): no se puede eliminar, hay que desactivarlo.`,
    }
  }
  if (hermesEstado === 'existe') return { kind: 'blocked', reason: 'Este cliente existe en Hermes. Hay que eliminarlo primero desde el Conciliador.' }
  if (hermesEstado === 'no-disponible' || hermesEstado === null) return { kind: 'blocked', reason: 'No se pudo verificar si el cliente existe en Hermes. Por seguridad, no se elimina — probá de nuevo más tarde.' }
  return { kind: 'ready' }
}
