import type { StockByLocation } from '../../infrastructure/supabase/ProductRepository.supabase'

/**
 * Aggregates a product's onHand rows by sucursal. Supabase-sourced rows carry a
 * `sucursalId` (via the ubicacion(sucursal_id) join); mock-sourced rows never set
 * it. When no row has a sucursalId we can't split Tienda/Almacén, so callers fall
 * back to a single aggregate total.
 */
export function aggregateStockBySucursal(onHand: StockByLocation[]): { hasSucursalSplit: boolean; tienda: number; almacen: number; total: number } {
  const total = onHand.filter((row) => row.excluyeDisponible !== true).reduce((sum, row) => sum + row.cantidadBase, 0)
  const hasSucursalSplit = onHand.some((row) => row.sucursalId !== undefined)
  if (!hasSucursalSplit) return { hasSucursalSplit: false, tienda: 0, almacen: 0, total }
  const tienda = onHand.filter((row) => row.sucursalId === 2 && row.excluyeDisponible !== true).reduce((sum, row) => sum + row.cantidadBase, 0)
  const almacen = onHand.filter((row) => row.sucursalId === 1 && row.excluyeDisponible !== true).reduce((sum, row) => sum + row.cantidadBase, 0)
  return { hasSucursalSplit: true, tienda, almacen, total }
}
