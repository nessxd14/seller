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
export interface StockControlInfo {
  tienda: number
  almacen: number
  tiendaLibre: boolean
  almacenLibre: boolean
}

/** ¿Esta línea IMPIDE cobrar? Falta stock Y su origen exige stock estricto.
 *  En una sucursal en control libre, faltar stock es lo esperado hasta que se
 *  inventaríe — no es un error. Ver permite_sobregiro_sucursal() en Cation. */
export const isLineBlocking = (line: StockCheckLine, stock?: StockControlInfo): boolean => {
  if (!stock) return false
  if (!isLineUnderstocked(line, stock)) return false
  return line.ubicacion === 'Tienda' ? !stock.tiendaLibre : !stock.almacenLibre
}
