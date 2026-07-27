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
