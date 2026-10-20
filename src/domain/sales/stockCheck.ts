// TAREA 5: shared "is this line understocked at its chosen origin" formula — extracted
// out of CartItem.tsx (where the check originally lived, retail-only) so CartReview can
// flag the same lines without duplicating the arithmetic. Pure function, no state.
export interface StockCheckLine {
  cantidad: number
  ubicacion: 'Tienda' | 'Almacén'
  factorUnidadBase?: number
}

export const cantidadBaseFor = (line: StockCheckLine) => line.cantidad * (line.factorUnidadBase ?? 1)

export const isLineUnderstocked = (line: StockCheckLine, originStock?: { tienda: number; almacen: number }): boolean => {
  if (!originStock) return false
  const available = line.ubicacion === 'Tienda' ? originStock.tienda : originStock.almacen
  return available < cantidadBaseFor(line)
}

// Brief S9: control de stock por sucursal. Tienda puede estar en modo LIBRE (se vende sin
// inventario porque todavía no se inventarió — registrar_venta lo permite y deja
// stock_actual en negativo a propósito) mientras Almacén está en ESTRICTO. "Falta stock"
// (isLineUnderstocked) y "esto bloquea la venta" dejan de ser la misma pregunta.
//
// Brief S10 (reserva de stock): tienda/almacen siguen siendo el físico crudo (lo que
// isLineUnderstocked compara, para el aviso informativo). vendible/reservado/motivo
// salen de saldo_vendible() — la única fuente de verdad, junto con v_pedido_linea_reserva,
// para cuánto hay realmente disponible para VENDER (físico menos lo comprometido con
// otros pedidos, con FIFO por antigüedad). motivo nombra los pedidos que reservan, para
// que el mensaje de bloqueo nunca sea "sin stock" a secas.
export interface StockControlInfo {
  tienda: number
  almacen: number
  tiendaLibre: boolean
  almacenLibre: boolean
  tiendaVendible: number
  almacenVendible: number
  tiendaReservado: number
  almacenReservado: number
  tiendaMotivo: string | null
  almacenMotivo: string | null
}

/** ¿Esta línea IMPIDE cobrar? Compara contra lo VENDIBLE (físico menos reservado por
 *  otros pedidos), no contra el físico crudo — eso es lo que S10 corrige.
 *
 *  Decisión de Ness (2026-10-19, reemplaza la regla S10 "la reserva gana sobre el control
 *  libre"): en una sucursal en control LIBRE (Tienda) la venta pasa siempre, haya o no
 *  reservas de pedidos sobre el producto. En una sucursal ESTRICTO (Almacén) la reserva
 *  sigue protegiendo: si falta lo vendible, bloquea. Mismo criterio que
 *  _registrar_venta_nucleo (compuerta 2.5) en Cation desde 2026-10-19_tienda_libre_ignora_reservas.sql. */
export const isLineBlocking = (line: StockCheckLine, stock?: StockControlInfo): boolean => {
  if (!stock) return false
  const needed = cantidadBaseFor(line)
  const vendible = line.ubicacion === 'Tienda' ? stock.tiendaVendible : stock.almacenVendible
  if (needed <= vendible) return false
  return line.ubicacion === 'Tienda' ? !stock.tiendaLibre : !stock.almacenLibre
}
