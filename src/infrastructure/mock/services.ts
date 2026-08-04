import { QuoteService } from '../../application/quotations/QuoteService'
import { OrderService } from '../../application/orders/OrderService'
import { CustomerService } from '../../application/customers/CustomerService'
import { CashService } from '../../application/cash/CashService'
import type { CashSessionRecord, CustomerRecord, OrderView, QuoteDraft } from '../../application/shared/models'
import { LocalStorageRepository } from './localStore'
import { cashSeeds, customerSeeds, orderSeeds, quoteSeeds } from './seeds'
import { LocalIdempotencyService } from '../../application/idempotency/IdempotencyService'
import { SensitiveOperationExecutor } from '../../application/idempotency/SensitiveOperationExecutor'
import { transferService as rawTransferService, type CreateTransferInput } from './TransferRepository.mock'
import { mockAuthSessionProvider } from './MockAuthSessionProvider'
import type { TransferEstado, TransferRecord } from '../../application/shared/models'
import { configRepository } from './ConfigRepository.mock'
import { reportsRepository } from './ReportsRepository.mock'

export const configService = configRepository
export const reportsService = reportsRepository

export const quoteService = new QuoteService(new LocalStorageRepository<QuoteDraft>('roari-quotes-v1', quoteSeeds))
const rawOrderService = new OrderService(new LocalStorageRepository<OrderView>('roari-orders-v1', orderSeeds))
const currentMockActorId = async (): Promise<string> => {
  const session = await mockAuthSessionProvider.getSession()
  return session?.user.email ?? session?.user.name ?? 'pos'
}
export const orderService = {
  list: () => rawOrderService.list(),
  save: (order: OrderView) => rawOrderService.save(order),
  partialDispatch: (id: string) => rawOrderService.partialDispatch(id),
  cancel: async (id: string, motivo: string) => rawOrderService.cancel(id, motivo, await currentMockActorId()),
  restore: async (id: string, motivo: string) => rawOrderService.restore(id, motivo, await currentMockActorId()),
}
export const customerService = new CustomerService(new LocalStorageRepository<CustomerRecord>('roari-customers-v1', customerSeeds))
const rawCashService = new CashService(new LocalStorageRepository<CashSessionRecord>('roari-cash-v1', cashSeeds))
export const sensitiveOperations = new SensitiveOperationExecutor(new LocalIdempotencyService())
export { productRepository, getStockByProduct, getStockBySucursalBatch, listPresentations, listLineIdentifiers, listBrands } from './ProductRepository.mock'

// Only one mock caja exists, mirroring the real backend's single "Caja Tienda".
const MOCK_REGISTER = 'Caja 01 · Sucursal Central'

/**
 * Facade over CashService that exposes a call shape shared with the Supabase
 * adapter (src/infrastructure/supabase/services.ts's cashService), so
 * CashPage/PaymentModal/OrdersPage can call one shape regardless of backend.
 */
export const cashService = {
  list: () => rawCashService.list(),
  async getOpenSession(): Promise<CashSessionRecord | null> {
    const sessions = await rawCashService.list()
    return sessions.find((session) => session.status === 'open') ?? null
  },
  open: (openingCents: number) => rawCashService.open(MOCK_REGISTER, openingCents),
  close: async (id: string, countedCents: number) => {
    const session = (await rawCashService.list()).find((s) => s.id === id)
    if (!session) throw new Error('Sesión de caja no encontrada')
    return rawCashService.close(session, countedCents)
  },
  addMovement: async (sessionId: string, type: 'income' | 'expense', method: 'cash' | 'qr' | 'transfer', amountCents: number, note: string) => {
    const session = (await rawCashService.list()).find((s) => s.id === sessionId)
    if (!session) throw new Error('Sesión de caja no encontrada')
    return rawCashService.addMovement(session, type, amountCents, note, method)
  },
  // Mock retail flow has never modeled orden-linked advances against a real pedido table;
  // deliberately kept minimal per the brief ("don't over-build this for mock") — it just
  // records an income movement tagged with the order id in the note.
  registerAdvance: async (orderId: string, amountCents: number, method: 'cash' | 'qr' | 'transfer', sessionId: string) => {
    const session = (await rawCashService.list()).find((s) => s.id === sessionId)
    if (!session) throw new Error('Sesión de caja no encontrada')
    const updated = await rawCashService.addMovement(session, 'income', amountCents, `Anticipo pedido ${orderId}`, method)
    const movement = updated.movements[updated.movements.length - 1]
    return { movementId: movement.id }
  },
  // No real pedido/movimiento_caja link exists in the mock store; history is deliberately
  // skipped rather than faking a persistence layer that doesn't otherwise exist in mock mode.
  getAdvancesForOrder: async (orderId: string): Promise<Array<{ id: string; amountCents: number; method: string; note: string; at: string }>> => { void orderId; return [] },
  // Igual que registerAdvance: el mock no tiene una tabla movimiento_caja real, así que
  // depósito/SIGEP/cheque se registran como 'transfer' (el mock sólo distingue cash/qr/
  // transfer) con la nota indicando el método real. No hay puente a Hermes en modo mock.
  registerPayment: async (input: { customerId: string; orderId?: string; amountCents: number; method: 'cash' | 'qr' | 'transfer' | 'deposit' | 'sigep' | 'check'; sessionId: string }) => {
    const session = (await rawCashService.list()).find((s) => s.id === input.sessionId)
    if (!session) throw new Error('Sesión de caja no encontrada')
    const mockMethod: 'cash' | 'qr' | 'transfer' = input.method === 'cash' || input.method === 'qr' ? input.method : 'transfer'
    const extraNota = input.method === 'deposit' ? ' · Depósito bancario' : input.method === 'sigep' ? ' · SIGEP' : input.method === 'check' ? ' · Cheque' : ''
    const nota = `Pago cliente ${input.customerId}${input.orderId ? ` · Pedido ${input.orderId}` : ''}${extraNota}`
    const updated = await rawCashService.addMovement(session, 'income', input.amountCents, nota, mockMethod)
    const movement = updated.movements[updated.movements.length - 1]
    return { movementId: movement.id }
  },
  expected: (session: CashSessionRecord) => rawCashService.expected(session),
}

/**
 * Mock "checkout" facade matching the shape saleService.checkout will have in Supabase
 * mode. Since mock retail has no inventory/Kardex to touch, this simply requires an open
 * cash session, records the sale total as an income movement per payment leg, and returns
 * a synthetic result. PaymentModal in mock mode does NOT currently call this (see report -
 * mock UX kept exactly as-is to avoid requiring a cash session for retail checkout that
 * never needed one); it exists so the facade shapes are symmetric and testable.
 */
export const saleService = {
  async checkout(input: { lines: Array<{ productId: string; quantity: number; unitPriceCents: number }>; payments: Array<{ method: 'cash' | 'qr' | 'transfer'; amountCents: number }>; cashSessionId: string; discountCents?: number }) {
    const session = (await rawCashService.list()).find((s) => s.id === input.cashSessionId)
    if (!session || session.status !== 'open') throw new Error('No hay una sesión de caja abierta')
    const subtotalCents = input.lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0)
    const discountCents = input.discountCents ?? 0
    const totalCents = input.payments.reduce((sum, payment) => sum + payment.amountCents, 0)
    let current = session
    for (const payment of input.payments) {
      current = await rawCashService.addMovement(current, 'income', payment.amountCents, 'Venta mock', payment.method)
    }
    return { saleId: crypto.randomUUID(), subtotalCents, discountCents, totalCents, isRetry: false }
  },
}

const currentMockActor = async (): Promise<string> => {
  const session = await mockAuthSessionProvider.getSession()
  return session?.user.name ?? 'Usuario POS'
}

export const transferService = {
  async list(filters?: { estado?: TransferEstado }): Promise<TransferRecord[]> {
    return rawTransferService.list(filters)
  },
  async create(input: CreateTransferInput): Promise<TransferRecord> {
    const actor = await currentMockActor()
    return rawTransferService.create(input, actor)
  },
  async dispatch(id: string): Promise<TransferRecord> {
    const actor = await currentMockActor()
    return rawTransferService.dispatch(id, actor)
  },
  async revert(id: string, nota?: string): Promise<TransferRecord> {
    const actor = await currentMockActor()
    return rawTransferService.revert(id, actor, nota)
  },
  async receive(id: string, lines: null | Array<{ lineaId: string; cantidadBase: number }>): Promise<TransferRecord> {
    const actor = await currentMockActor()
    return rawTransferService.receive(id, lines, actor)
  },
  async cancel(id: string, nota?: string): Promise<TransferRecord> {
    const actor = await currentMockActor()
    return rawTransferService.cancel(id, actor, nota)
  },
}
