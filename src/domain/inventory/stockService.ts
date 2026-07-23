import type { SalesChannel } from '../common/types'
import type { InventoryAllocation, StockBalance } from './entities'

export const stockDisponible = (balance: StockBalance) => Math.max(0, balance.stockFisico - balance.stockReservado - balance.stockDanado)

export const locationPriority = (channel: SalesChannel): Array<'tienda' | 'almacen'> => channel === 'retail' ? ['tienda', 'almacen'] : ['almacen', 'tienda']

export const validateAllocations = (requestedQuantity: number, allocations: InventoryAllocation[], balances: StockBalance[]) => {
  if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1) throw new Error('Cantidad solicitada inválida')
  const allocated = allocations.reduce((sum, allocation) => sum + allocation.quantity, 0)
  if (allocated > requestedQuantity) throw new Error('Las asignaciones exceden la cantidad solicitada')
  for (const allocation of allocations) {
    if (!Number.isInteger(allocation.quantity) || allocation.quantity < 1) throw new Error('Asignación inválida')
    const balance = balances.find((candidate) => candidate.locationId === allocation.locationId)
    if (!balance || stockDisponible(balance) < allocation.quantity) throw new Error(`Stock insuficiente en ${allocation.locationId}`)
  }
  return { allocated, pending: requestedQuantity - allocated, complete: allocated === requestedQuantity }
}

export const reserveStock = (balance: StockBalance, quantity: number): StockBalance => {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Cantidad de reserva inválida')
  if (stockDisponible(balance) < quantity) throw new Error('Stock insuficiente para reservar')
  return { ...balance, stockReservado: balance.stockReservado + quantity }
}

export const releaseStock = (balance: StockBalance, quantity: number): StockBalance => {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > balance.stockReservado) throw new Error('Cantidad de liberación inválida')
  return { ...balance, stockReservado: balance.stockReservado - quantity }
}

export const registerDamage = (balance: StockBalance, quantity: number): StockBalance => {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > balance.stockFisico - balance.stockDanado) throw new Error('Cantidad dañada inválida')
  return { ...balance, stockDanado: balance.stockDanado + quantity }
}

