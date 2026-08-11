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
// Brief S10 — la compuerta de reserva: tienda/almacen ya no son stock físico, son
// vendible (saldo_vendible en Cation), neto de lo comprometido por otros pedidos.
// reservado/motivo identifican esa reserva para poder explicarla, no solo bloquear.
export interface StockControlInfo {
  tienda: number
  almacen: number
  tiendaLibre: boolean
  almacenLibre: boolean
  reservado: number
  motivo: string | null
}

/** ¿Esta línea IMPIDE cobrar? Falta stock Y (su origen exige stock estricto, O hay una
 *  reserva de por medio). Brief S10: la reserva gana sobre el control libre — una
 *  sucursal en LIBRE permite vender sin inventario, pero no permite vender unidades
 *  reservadas para un pedido concreto. Sin reserva, la regla de S9 sigue igual: en
 *  control libre, faltar stock es lo esperado hasta que se inventaríe, no un error.
 *  Ver permite_sobregiro_sucursal() y saldo_vendible() en Cation. */
export const isLineBlocking = (line: StockCheckLine, stock?: StockControlInfo): boolean => {
  if (!stock) return false
  if (!isLineUnderstocked(line, stock)) return false
  if (stock.reservado > 0) return true
  return line.ubicacion === 'Tienda' ? !stock.tiendaLibre : !stock.almacenLibre
}
