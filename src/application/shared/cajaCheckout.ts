import type { SaleCheckoutLine, SaleCheckoutPayment } from '../ports/repositories'
import type { PedidoVendedorRecord, VtdPorCobrar } from './models'
import type { LineaCaja } from '../../domain/sales/pedidoCaja'
export interface PedidoEnCarrito { pedido: PedidoVendedorRecord; lineas: LineaCaja[] }
export interface CajaCheckoutInput {
  lines: SaleCheckoutLine[]; payments: SaleCheckoutPayment[]; cashSessionId: string; customerId?: string
  discountCents: number; balanceCents: number; operationId: string; vendedorId?: string
  pedido?: PedidoEnCarrito | null; vtds: VtdPorCobrar[]
}
export interface CajaReceipt {
  id: string; numero: string; totalCents: number; saleIds: string[]; isRetry: boolean
  vendedor: string | null; cliente: string | null
  lineas: { descripcion: string; cantidad: number; precio: number; subtotal: number; origen: string }[]
  pagos: { metodo: string; monto: number; recibido?: number }[]; creadoEn: string
  balanceCents: number; discountCents: number; changeCents: number
}
