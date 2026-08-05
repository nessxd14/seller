import type { CartItem } from '../../types'

// TAREA 4 (Ronda 9): customerId/customerName/customerDocument are optional — sales
// suspended before that round never wrote them, and older records must still load
// without crashing.
export interface SuspendedSale {
  id: string
  date: string
  seller: string
  channel: string
  customer: string
  cart: CartItem[]
  discount: number
  total: number
  customerId?: string
  customerName?: string
  customerDocument?: string
}

const KEY = 'roari-suspended-sales-v2'

// TAREA 6 (Tanda 3): único mecanismo de venta suspendida. Antes convivía con un
// `roari-suspended-sale` legado de una sola ranura, sin usuario, y cada lugar que leía
// esta clave lo hacía con su propio JSON.parse sin try/catch — una entrada corrupta (un
// F5 en el momento justo de la escritura alcanza) tiraba una excepción no capturada y
// dejaba el POS en pantalla blanca. Todo acceso pasa por acá ahora.
export const readSuspendedSales = (): SuspendedSale[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]') as unknown
    return Array.isArray(parsed) ? (parsed as SuspendedSale[]) : []
  } catch {
    return []
  }
}

const writeSuspendedSales = (sales: SuspendedSale[], replacer?: (key: string, value: unknown) => unknown): void => {
  localStorage.setItem(KEY, JSON.stringify(sales, replacer))
}

/**
 * `replacer` opcional, pasado tal cual a JSON.stringify — TAREA 12 (Tanda 3) lo usa para
 * excluir stockTienda/stockAlmacen del carrito en modo Supabase, donde rowToProduct los
 * deja siempre en 0 (el stock real vive en un batch aparte): persistirlos sería guardar
 * un dato falso, no uno viejo.
 */
export const addSuspendedSale = (sale: SuspendedSale, replacer?: (key: string, value: unknown) => unknown): void => {
  writeSuspendedSales([sale, ...readSuspendedSales()], replacer)
}

export const removeSuspendedSale = (id: string): void => {
  writeSuspendedSales(readSuspendedSales().filter((sale) => sale.id !== id))
}
