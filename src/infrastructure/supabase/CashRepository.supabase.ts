import { supabase } from './supabaseClient'
import type { CashRepository, MutationContext, Page, PageRequest, Versioned } from '../../application/ports/repositories'
import type { CashSessionRecord } from '../../application/shared/models'
import { NotFoundError } from '../../application/errors/AppError'
import { centsToNumeric, methodToMetodoPago, metodoPagoToMethod, methodExtToMetodoPago, methodExtNotaExtra, numericToCents, tipoMovimientoToType, type MetodoPago, type PosPaymentMethodExt } from './mappers'

const CAJA_ID = 1

type EstadoSesionCaja = 'ABIERTA' | 'CERRADA'

interface SesionCajaRow {
  id: number
  caja_id: number
  estado: EstadoSesionCaja
  monto_apertura: number | string
  monto_cierre_contado: number | string | null
  diferencia: number | string | null
  abierta_por: string | null
  abierta_en: string
  cerrada_por: string | null
  cerrada_en: string | null
  caja?: { nombre: string } | null
}

interface MovimientoCajaRow {
  id: number
  sesion_caja_id: number
  tipo: 'VENTA' | 'ANTICIPO' | 'INGRESO' | 'EGRESO' | 'ANULACION'
  metodo: MetodoPago | null
  monto: number | string
  venta_id: number | null
  pedido_id: number | null
  nota: string | null
  creado_por: string | null
  creado_en: string
}

const num = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v))

const rowToSession = (session: SesionCajaRow, movimientos: MovimientoCajaRow[]): CashSessionRecord & Versioned => ({
  id: String(session.id),
  register: session.caja?.nombre ?? 'Caja Tienda',
  openedAt: session.abierta_en,
  openingCents: numericToCents(num(session.monto_apertura)),
  status: session.estado === 'ABIERTA' ? 'open' : 'closed',
  movements: movimientos.map((m) => ({
    id: String(m.id),
    type: tipoMovimientoToType(m.tipo),
    method: metodoPagoToMethod(m.metodo),
    amountCents: numericToCents(num(m.monto)),
    note: m.nota ?? '',
    at: m.creado_en,
  })),
  countedCents: session.monto_cierre_contado != null ? numericToCents(num(session.monto_cierre_contado)) : undefined,
  closedAt: session.cerrada_en ?? undefined,
  differenceCents: session.diferencia != null ? numericToCents(num(session.diferencia)) : undefined,
  // sesion_caja has no version column, same pattern as pedido/cliente.
  version: 1,
  updatedAt: session.cerrada_en ?? session.abierta_en,
})

const fetchSession = async (id: number): Promise<(CashSessionRecord & Versioned) | null> => {
  const { data: session, error } = await supabase.from('sesion_caja').select('*, caja(nombre)').eq('id', id).maybeSingle()
  if (error) throw error
  if (!session) return null
  const { data: movimientos, error: movError } = await supabase.from('movimiento_caja').select('*').eq('sesion_caja_id', id).order('creado_en', { ascending: true })
  if (movError) throw movError
  return rowToSession(session as SesionCajaRow, (movimientos ?? []) as MovimientoCajaRow[])
}

/** Used by useCashSession() in Supabase mode and by SaleRepository.supabase.ts's cancel(). */
export const getOpenSession = async (): Promise<(CashSessionRecord & Versioned) | null> => {
  const { data, error } = await supabase.from('sesion_caja').select('id').eq('caja_id', CAJA_ID).eq('estado', 'ABIERTA').limit(1).maybeSingle()
  if (error) throw error
  if (!data) return null
  return fetchSession(data.id as number)
}

export const getAdvancesForOrder = async (orderId: string): Promise<Array<{ id: string; amountCents: number; method: string; note: string; at: string }>> => {
  const { data, error } = await supabase.from('movimiento_caja').select('*').eq('pedido_id', Number(orderId)).order('creado_en', { ascending: false })
  if (error) throw error
  return ((data ?? []) as MovimientoCajaRow[]).map((m) => ({ id: String(m.id), amountCents: numericToCents(num(m.monto)), method: metodoPagoToMethod(m.metodo), note: m.nota ?? '', at: m.creado_en }))
}

export class SupabaseCashRepository implements CashRepository {
  async list(input: { register?: string; status?: CashSessionRecord['status']; page: PageRequest }): Promise<Page<CashSessionRecord & Versioned>> {
    const { status, page } = input
    const from = (page.page - 1) * page.pageSize
    const to = from + page.pageSize - 1
    let builder = supabase.from('sesion_caja').select('*, caja(nombre)', { count: 'exact' }).eq('caja_id', CAJA_ID)
    if (status) builder = builder.eq('estado', status === 'open' ? 'ABIERTA' : 'CERRADA')
    const { data, error, count } = await builder.order('abierta_en', { ascending: false }).range(from, to)
    if (error) throw error
    const sessions = (data ?? []) as SesionCajaRow[]
    const ids = sessions.map((s) => s.id)
    const { data: allMovs, error: movError } = ids.length
      ? await supabase.from('movimiento_caja').select('*').in('sesion_caja_id', ids)
      : { data: [] as MovimientoCajaRow[], error: null }
    if (movError) throw movError
    const items = sessions.map((s) => rowToSession(s, (allMovs ?? []).filter((m) => m.sesion_caja_id === s.id) as MovimientoCajaRow[]))
    return { items, page: page.page, pageSize: page.pageSize, total: count ?? 0 }
  }

  async getById(id: string): Promise<(CashSessionRecord & Versioned) | null> {
    const numericId = Number(id)
    if (!Number.isFinite(numericId)) return null
    return fetchSession(numericId)
  }

  async open(input: { register: string; openingCents: number }, context: MutationContext): Promise<CashSessionRecord & Versioned> {
    const actor = context.actorId ?? 'pos'
    const { data: sessionId, error } = await supabase.rpc('abrir_caja', { p_caja_id: CAJA_ID, p_monto_apertura: centsToNumeric(input.openingCents), p_usuario: actor })
    if (error) throw error
    const created = await fetchSession(sessionId as number)
    if (!created) throw new NotFoundError('No se pudo releer la sesión de caja recién abierta')
    return created
  }

  async close(id: string, countedCents: number, context: MutationContext): Promise<CashSessionRecord & Versioned> {
    const actor = context.actorId ?? 'pos'
    const numericId = Number(id)
    const { error } = await supabase.rpc('cerrar_caja', { p_sesion_id: numericId, p_monto_contado: centsToNumeric(countedCents), p_usuario: actor })
    if (error) throw error
    const closed = await fetchSession(numericId)
    if (!closed) throw new NotFoundError('No se pudo releer la sesión de caja recién cerrada')
    return closed
  }

  async addMovement(sessionId: string, input: { type: 'income' | 'expense'; method: 'cash' | 'qr' | 'transfer'; amountCents: number; note: string }, context: MutationContext): Promise<CashSessionRecord & Versioned> {
    const actor = context.actorId ?? 'pos'
    const numericId = Number(sessionId)
    const { error } = await supabase.rpc('registrar_movimiento', {
      p_sesion_id: numericId,
      p_tipo: input.type === 'income' ? 'INGRESO' : 'EGRESO',
      p_monto: centsToNumeric(input.amountCents),
      p_metodo: methodToMetodoPago(input.method),
      p_nota: input.note,
      p_usuario: actor,
    })
    if (error) throw error
    const updated = await fetchSession(numericId)
    if (!updated) throw new NotFoundError('No se pudo releer la sesión de caja tras el movimiento')
    return updated
  }

  async registerAdvance(input: { orderId: string; amountCents: number; method: 'cash' | 'qr' | 'transfer'; sessionId: string }, context: MutationContext): Promise<{ movementId: string }> {
    const actor = context.actorId ?? 'pos'
    // registrar_anticipo ahora recibe p_cliente_id (segundo parámetro) — se manda null
    // explícito acá porque este flujo (anticipo desde un pedido) no lo necesita, la RPC
    // resuelve el cliente a través del pedido. Todos los parámetros van por nombre, así
    // que el orden real de la firma no afecta este call site.
    const { data: movementId, error } = await supabase.rpc('registrar_anticipo', {
      p_pedido_id: Number(input.orderId),
      p_cliente_id: null,
      p_monto: centsToNumeric(input.amountCents),
      p_metodo: methodToMetodoPago(input.method),
      p_sesion_id: Number(input.sessionId),
      p_usuario: actor,
    })
    if (error) throw error
    return { movementId: String(movementId) }
  }

  // "Registrar pago" del header: pago libre del cliente, sobre el total adeudado o sobre
  // un pedido específico — a diferencia de registerAdvance (siempre atado a un pedido),
  // acá el cliente es obligatorio y el pedido es opcional.
  async registerPayment(input: { customerId: string; orderId?: string; amountCents: number; method: PosPaymentMethodExt; sessionId: string }, context: MutationContext): Promise<{ movementId: string }> {
    const actor = context.actorId ?? 'pos'
    const { data: movementId, error } = await supabase.rpc('registrar_anticipo', {
      p_pedido_id: input.orderId ? Number(input.orderId) : null,
      p_cliente_id: Number(input.customerId),
      p_monto: centsToNumeric(input.amountCents),
      p_metodo: methodExtToMetodoPago(input.method),
      p_sesion_id: Number(input.sessionId),
      p_usuario: actor,
    })
    if (error) throw error
    // El pago ya quedó registrado — si esta nota cosmética falla, no vale la pena
    // reportarlo como error al cajero.
    const nota = methodExtNotaExtra(input.method)
    if (nota) {
      try {
        await supabase.from('movimiento_caja').update({ nota }).eq('id', movementId)
      } catch {
        // ver comentario arriba
      }
    }
    return { movementId: String(movementId) }
  }
}

export const cashRepository = new SupabaseCashRepository()
