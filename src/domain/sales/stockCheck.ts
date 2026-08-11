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
 *  Decisión de negocio confirmada por Ness: "la reserva gana sobre el control libre de
 *  W3". El control libre es una concesión temporal a que la sucursal no se inventarió;
 *  la reserva es una obligación con un cliente concreto. Por eso la reserva se evalúa
 *  PRIMERO: si falta lo que falta porque hay algo reservado de este producto (reservado
 *  > 0), bloquea sin importar tiendaLibre/almacenLibre. Solo cuando no hay ninguna
 *  reserva de por medio (el faltante es puramente "todavía no se inventarió") entra a
 *  jugar el control libre de W3. Ver permite_sobregiro_sucursal() en Cation (W3) y
 *  saldo_vendible()/v_pedido_linea_reserva (W8/S10) — no reimplementar ese cálculo acá. */
export const isLineBlocking = (line: StockCheckLine, stock?: StockControlInfo): boolean => {
  if (!stock) return false
  const needed = cantidadBaseFor(line)
  const vendible = line.ubicacion === 'Tienda' ? stock.tiendaVendible : stock.almacenVendible
  if (needed <= vendible) return false
  const reservado = line.ubicacion === 'Tienda' ? stock.tiendaReservado : stock.almacenReservado
  if (reservado > 0) return true
  return line.ubicacion === 'Tienda' ? !stock.tiendaLibre : !stock.almacenLibre
}
