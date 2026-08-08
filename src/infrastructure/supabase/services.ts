import type { CashSessionRecord, CustomerRecord, OrderView, QuoteDraft } from '../../application/shared/models'
import { supabase } from './supabaseClient'
import { quoteRepository } from './QuoteRepository.supabase'
import { orderRepository } from './OrderRepository.supabase'
import { customerRepository } from './CustomerRepository.supabase'
import { productRepository as supabaseProductRepository, getStockByProduct as supabaseGetStockByProduct, getStockBySucursalBatch as supabaseGetStockBySucursalBatch, listPresentations as supabaseListPresentations, listIdentifiersForProducts as supabaseListLineIdentifiers, listBrands as supabaseListBrands, listFrecuentes as supabaseListFrecuentes } from './ProductRepository.supabase'
import { cashRepository, getAdvancesForOrder, getOpenSession } from './CashRepository.supabase'
import { saleRepository } from './SaleRepository.supabase'
import { supabaseAuthSessionProvider } from './SupabaseAuthSessionProvider'
import { transferRepository, type CreateTransferInput } from './TransferRepository.supabase'
import type { TransferEstado, TransferRecord } from '../../application/shared/models'
import { configRepository } from './ConfigRepository.supabase'
import { reportsRepository } from './ReportsRepository.supabase'
import { sensitiveOperations } from '../mock/services'
import { checkoutFingerprint } from '../../domain/sales/checkoutFingerprint'
import { expectedCash } from '../../application/cash/CashService'

export const configService = configRepository
export const reportsService = reportsRepository

const currentActorId = async (): Promise<string> => {
  const session = await supabaseAuthSessionProvider.getSession()
  return session?.user.email ?? session?.user.name ?? 'pos'
}

const bigPage = { page: 1, pageSize: 200 }

export const quoteService = {
  async list(): Promise<QuoteDraft[]> {
    const { items } = await quoteRepository.list({ page: bigPage })
    return items
  },
  async save(quote: QuoteDraft): Promise<QuoteDraft> {
    const actorId = await currentActorId()
    const existing = quote.id ? await quoteRepository.getById(quote.id) : null
    return quoteRepository.save(quote, { actorId, expectedVersion: existing?.version })
  },
  async duplicate(id: string): Promise<QuoteDraft> {
    const actorId = await currentActorId()
    return quoteRepository.duplicate(id, { actorId })
  },
  /**
   * In the mock backend, converting a quote is a two-step client-side flow
   * (quoteService.markConverted then orderService.save). Against Supabase, the
   * `convertir_cotizacion_a_pedido` RPC does this atomically, so this stub only
   * exists to keep the facade's type shape uniform with the mock service — the
   * supabase-flagged branch in QuotationsPage.convert() never calls it, it calls
   * orderService.save({ sourceQuoteId }) directly instead.
   */
  async markConverted(id: string, orderId: string): Promise<never> {
    void id; void orderId
    throw new Error('En modo Supabase, usa orderService.save({ sourceQuoteId }) para convertir una cotización.')
  },
}

export const orderService = {
  async list(): Promise<OrderView[]> {
    const { items } = await orderRepository.list({ page: bigPage })
    return items
  },
  async save(order: OrderView): Promise<OrderView> {
    const actorId = await currentActorId()
    return orderRepository.save(order, { actorId })
  },
  /** Dispatch is a warehouse/WMS operation (entregar_personalizado / kardex) out of scope for this POS feature. */
  async partialDispatch(id: string): Promise<never> {
    void id
    throw new Error('El despacho se gestiona desde el WMS en modo Supabase.')
  },
  // TAREA 2 (Ronda 9): anular_pedido/restaurar_pedido do the estado change + bitácora
  // insert atomically server-side (see db/migrations/2026-07-28_pedido_evento.sql, not
  // yet applied). p_usuario is the real session email, never a free-text field.
  async cancel(id: string, motivo: string): Promise<OrderView> {
    const actorId = await currentActorId()
    const { error } = await supabase.rpc('anular_pedido', { p_pedido_id: Number(id), p_motivo: motivo, p_usuario: actorId })
    if (error) throw error
    const updated = await orderRepository.getById(id)
    if (!updated) throw new Error('No se pudo releer el pedido anulado')
    return updated
  },
  async restore(id: string, motivo: string): Promise<OrderView> {
    const actorId = await currentActorId()
    const { error } = await supabase.rpc('restaurar_pedido', { p_pedido_id: Number(id), p_motivo: motivo, p_usuario: actorId })
    if (error) throw error
    const updated = await orderRepository.getById(id)
    if (!updated) throw new Error('No se pudo releer el pedido restaurado')
    return updated
  },
}

export const customerService = {
  // TAREA 4: optional {query, page} so the inline cart customer picker can search
  // server-side (nombre/documento, see CustomerRepository.supabase.ts's list()) with a
  // small page size, while existing no-arg callers (DraftOrderEditor) keep getting the
  // full list exactly as before.
  async list(input?: { query?: string; page?: { page: number; pageSize: number } }): Promise<CustomerRecord[]> {
    const { items } = await customerRepository.list({ query: input?.query, page: input?.page ?? bigPage })
    return items
  },
  async save(customer: CustomerRecord): Promise<CustomerRecord> {
    const actorId = await currentActorId()
    return customerRepository.save(customer, { actorId })
  },
}

export const productRepository = supabaseProductRepository
export const getStockByProduct = supabaseGetStockByProduct
export const getStockBySucursalBatch = supabaseGetStockBySucursalBatch
export const listPresentations = supabaseListPresentations
export const listLineIdentifiers = supabaseListLineIdentifiers
export const listBrands = supabaseListBrands
export const listFrecuentes = supabaseListFrecuentes

const bigPageCash = { page: 1, pageSize: 200 }

export const cashService = {
  async list(): Promise<CashSessionRecord[]> {
    const { items } = await cashRepository.list({ page: bigPageCash })
    return items
  },
  getOpenSession,
  async open(openingCents: number): Promise<CashSessionRecord> {
    const actorId = await currentActorId()
    return cashRepository.open({ register: 'Caja Tienda', openingCents }, { actorId })
  },
  async close(id: string, countedCents: number): Promise<CashSessionRecord> {
    const actorId = await currentActorId()
    return cashRepository.close(id, countedCents, { actorId })
  },
  async addMovement(sessionId: string, type: 'income' | 'expense', method: 'cash' | 'qr' | 'transfer', amountCents: number, note: string): Promise<CashSessionRecord> {
    const actorId = await currentActorId()
    return cashRepository.addMovement(sessionId, { type, method, amountCents, note }, { actorId })
  },
  async registerAdvance(orderId: string, amountCents: number, method: 'cash' | 'qr' | 'transfer', sessionId: string): Promise<{ movementId: string }> {
    const actorId = await currentActorId()
    return cashRepository.registerAdvance({ orderId, amountCents, method, sessionId }, { actorId })
  },
  async registerPayment(input: { customerId: string; orderId?: string; amountCents: number; method: 'cash' | 'qr' | 'transfer' | 'deposit' | 'sigep' | 'check'; sessionId: string; idempotencyKey?: string }): Promise<{ movementId: string }> {
    const actorId = await currentActorId()
    // Brief S5: si el llamador (PagoModal, vía sensitiveOperations.ejecutarIdempotente) no
    // manda una clave estable, se genera una al vuelo — mismo comportamiento que antes de
    // este brief, un pago sin protección de reintento.
    return cashRepository.registerPayment(input, { actorId, idempotencyKey: input.idempotencyKey ?? crypto.randomUUID() })
  },
  getAdvancesForOrder,
  // Backend truth is authoritative (esperado_efectivo comes from cerrar_caja's RPC
  // response); this client-side estimate is only used for the pre-close preview.
  expected(session: CashSessionRecord): number {
    return expectedCash(session)
  },
}

export const saleService = {
  /**
   * `operationId` (de PosContext, persistido en sessionStorage) por sí solo identifica
   * "la operación en curso", no "este cobro exacto": si sobreviviera a un F5 sin más,
   * un cobro fallido + recarga + carrito distinto reusaría la clave de la venta vieja y
   * el carrito nuevo nunca se cobraría. Por eso el aggregateId combina operationId con
   * checkoutFingerprint(input) — cualquier cambio en lo que se cobra (línea agregada,
   * cantidad, descuento, cliente, caja) da una huella distinta y por lo tanto una venta
   * nueva; el mismo contenido reusa la clave, que es exactamente el reintento legítimo.
   */
  async checkout(input: { lines: Array<{ productId: string; quantity: number; unitPriceCents: number; listPriceCents?: number; sourceLocation?: 'Tienda' | 'Almacén'; presentacionId?: number }>; payments: Array<{ method: 'cash' | 'qr' | 'transfer'; amountCents: number }>; cashSessionId: string; customerId?: string; discountCents?: number; operationId: string }) {
    const actorId = await currentActorId()
    const aggregateId = `${input.operationId}:${checkoutFingerprint({ ...input, discountCents: input.discountCents ?? 0 })}`
    const result = await sensitiveOperations.execute('checkout', aggregateId, (idempotencyKey) =>
      saleRepository.checkout(input, { actorId, idempotencyKey }),
    )
    // Barre las claves huérfanas de intentos abandonados de esta misma operación (carritos
    // que se editaron tras un fallo y nunca se volvieron a cobrar) — SensitiveOperationExecutor
    // ya limpió la del intento que salió bien.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k?.startsWith(`roari-idempotency:checkout:${input.operationId}:`)) localStorage.removeItem(k)
    }
    return result
  },
}

export const transferService = {
  async list(filters?: { estado?: TransferEstado }): Promise<TransferRecord[]> {
    return transferRepository.list(filters)
  },
  async create(input: CreateTransferInput): Promise<TransferRecord> {
    const actorId = await currentActorId()
    return transferRepository.create(input, actorId)
  },
  async dispatch(id: string): Promise<TransferRecord> {
    const actorId = await currentActorId()
    return transferRepository.dispatch(id, actorId)
  },
  async revert(id: string, nota?: string): Promise<TransferRecord> {
    const actorId = await currentActorId()
    return transferRepository.revert(id, actorId, nota)
  },
  async receive(id: string, lines: null | Array<{ lineaId: string; cantidadBase: number }>): Promise<TransferRecord> {
    const actorId = await currentActorId()
    return transferRepository.receive(id, lines, actorId)
  },
  async cancel(id: string, nota?: string): Promise<TransferRecord> {
    const actorId = await currentActorId()
    return transferRepository.cancel(id, actorId, nota)
  },
}
