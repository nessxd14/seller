import { supabase } from './supabaseClient'
import type { DateRange, MutationContext, Page, PageRequest, QuoteRepository, Versioned } from '../../application/ports/repositories'
import type { QuoteDraft, QuoteWorkflowStatus, WorkflowLine } from '../../application/shared/models'
import { ConflictError, NotFoundError } from '../../application/errors/AppError'
import {
  bpToPct, categoriaToChannel, centsToNumeric, channelToCategoria, defaultSucursalForChannel,
  locationToSucursalId, numericToCents, pctToBp, sucursalIdToLocation,
} from './mappers'

type EstadoCotizacion = 'BORRADOR' | 'APROBADA' | 'CONVERTIDA' | 'VENCIDA' | 'ANULADA'

// estado_cotizacion -> QuoteWorkflowStatus. VENCIDA -> expired and ANULADA -> rejected
// are the closest sensible mappings available in the POS's status vocabulary; there is
// no dedicated "cancelled quote" state in QuoteWorkflowStatus.
const estadoToStatus = (estado: EstadoCotizacion): QuoteWorkflowStatus => {
  switch (estado) {
    case 'BORRADOR': return 'draft'
    case 'APROBADA': return 'approved'
    case 'CONVERTIDA': return 'converted'
    case 'VENCIDA': return 'expired'
    case 'ANULADA': return 'rejected'
  }
}

// Only 'draft' maps back to BORRADOR unambiguously for writes; other POS statuses
// (sent/negotiating) have no DB equivalent and are UI-only concepts for this schema.
const statusToEstado = (status: QuoteWorkflowStatus): EstadoCotizacion => {
  switch (status) {
    case 'draft': return 'BORRADOR'
    case 'approved': return 'APROBADA'
    case 'converted': return 'CONVERTIDA'
    case 'expired': return 'VENCIDA'
    case 'rejected': return 'ANULADA'
    default: return 'BORRADOR'
  }
}

interface CotizacionRow {
  id: number
  cliente_id: number | null
  categoria: 'TIENDA' | 'MAYOR' | 'INSTITUCIONAL' | 'MUNICIPAL'
  referencia: string | null
  estado: EstadoCotizacion
  subtotal: number | string
  descuento_general: number | string
  total: number | string
  notas: string | null
  vigencia_hasta: string | null
  version: number
  creado_por: string | null
  creado_en: string
  actualizado_en: string | null
  cliente?: { nombre: string } | null
}

interface CotizacionLineaRow {
  id: number
  cotizacion_id: number
  producto_id: number | null
  es_personalizado: boolean
  descripcion: string | null
  nota: string | null
  sucursal_origen_id: number | null
  cantidad_base: number | string
  precio_lista: number | string | null
  precio_unitario: number | string
  descuento_pct: number | string
  precio_modificado: boolean
  modificado_por: string | null
  modificado_en: string | null
  subtotal: number | string
  producto?: { nombre: string; sku_interno: string | null } | null
}

const num = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v))

const lineaRowToWorkflowLine = (row: CotizacionLineaRow): WorkflowLine => ({
  id: String(row.id),
  productId: row.producto_id != null ? String(row.producto_id) : '',
  name: row.es_personalizado ? (row.descripcion ?? 'Ítem personalizado') : (row.producto?.nombre ?? row.descripcion ?? ''),
  sku: row.producto?.sku_interno ?? '',
  quantity: num(row.cantidad_base),
  unitPriceCents: numericToCents(num(row.precio_unitario)),
  discountBasisPoints: pctToBp(num(row.descuento_pct)),
  listPriceCents: row.precio_lista != null ? numericToCents(num(row.precio_lista)) : undefined,
  isCustomItem: row.es_personalizado,
  note: row.nota ?? undefined,
  sourceLocation: row.sucursal_origen_id != null ? sucursalIdToLocation(row.sucursal_origen_id) : undefined,
  priceOverridden: row.precio_modificado,
  modifiedBy: row.modificado_por ?? undefined,
  modifiedAt: row.modificado_en ?? undefined,
})

const rowToQuoteDraft = (header: CotizacionRow, lines: CotizacionLineaRow[]): QuoteDraft & Versioned => ({
  id: String(header.id),
  number: header.referencia ?? `COT-${header.id}`,
  customerId: header.cliente_id != null ? String(header.cliente_id) : '',
  customerName: header.cliente?.nombre ?? '',
  channel: categoriaToChannel(header.categoria) as QuoteDraft['channel'],
  status: estadoToStatus(header.estado),
  validUntil: header.vigencia_hasta ?? '',
  terms: '',
  notes: header.notas ?? '',
  generalDiscountCents: numericToCents(num(header.descuento_general)),
  createdAt: header.creado_en,
  lines: lines.map(lineaRowToWorkflowLine),
  version: header.version,
  updatedAt: header.actualizado_en ?? header.creado_en,
})

const buildLineasJsonb = (lines: WorkflowLine[], channel: QuoteDraft['channel'], actor: string) =>
  lines.map((line) => {
    if (line.isCustomItem) {
      return {
        es_personalizado: true,
        descripcion: line.name,
        cantidad_base: line.quantity,
        precio_unitario: centsToNumeric(line.unitPriceCents),
        descuento_pct: bpToPct(line.discountBasisPoints),
        nota: line.note ?? null,
      }
    }
    return {
      producto_id: Number(line.productId),
      cantidad_base: line.quantity,
      sucursal_origen_id: line.sourceLocation ? locationToSucursalId(line.sourceLocation) : defaultSucursalForChannel(categoriaToChannelSafe(channel)),
      precio_lista: line.listPriceCents != null ? centsToNumeric(line.listPriceCents) : centsToNumeric(line.unitPriceCents),
      precio_unitario: centsToNumeric(line.unitPriceCents),
      descuento_pct: bpToPct(line.discountBasisPoints),
      ...(line.priceOverridden ? { precio_modificado: true, modificado_por: line.modifiedBy ?? actor } : {}),
    }
  })

// small local helper: channel is already a SalesChannel value at this point
const categoriaToChannelSafe = (channel: QuoteDraft['channel']) => channel

const fetchQuoteById = async (id: number): Promise<(QuoteDraft & Versioned) | null> => {
  const { data: header, error: headerError } = await supabase.from('cotizacion').select('*, cliente(nombre)').eq('id', id).maybeSingle()
  if (headerError) throw headerError
  if (!header) return null
  const { data: lines, error: linesError } = await supabase.from('cotizacion_linea').select('*, producto(nombre,sku_interno)').eq('cotizacion_id', id)
  if (linesError) throw linesError
  return rowToQuoteDraft(header as CotizacionRow, (lines ?? []) as CotizacionLineaRow[])
}

export class SupabaseQuoteRepository implements QuoteRepository {
  // Defensive client-side idempotency cache: the crear_cotizacion RPC has no
  // built-in idempotency key, so without this a retried "save" with the same
  // idempotencyKey would create a second row. Mirrors VersionedLocalRepository's
  // in-memory cache pattern.
  private idempotencyCache = new Map<string, QuoteDraft & Versioned>()

  async list(input: { query?: string; status?: QuoteDraft['status']; channel?: QuoteDraft['channel']; dates?: DateRange; page: PageRequest }): Promise<Page<QuoteDraft & Versioned>> {
    const { query, status, channel, dates, page } = input
    const from = (page.page - 1) * page.pageSize
    const to = from + page.pageSize - 1
    let builder = supabase.from('cotizacion').select('*, cliente(nombre)', { count: 'exact' })
    if (status) builder = builder.eq('estado', statusToEstado(status))
    if (channel) builder = builder.eq('categoria', channelToCategoria(channel))
    if (dates?.from) builder = builder.gte('creado_en', dates.from)
    if (dates?.to) builder = builder.lte('creado_en', dates.to)
    if (query && query.trim()) {
      const escaped = query.trim().replace(/[%,]/g, '')
      builder = builder.ilike('referencia', `%${escaped}%`)
    }
    const { data, error, count } = await builder.order('id', { ascending: false }).range(from, to)
    if (error) throw error
    const headers = (data ?? []) as CotizacionRow[]
    const ids = headers.map((h) => h.id)
    const { data: allLines, error: linesError } = ids.length
      ? await supabase.from('cotizacion_linea').select('*, producto(nombre,sku_interno)').in('cotizacion_id', ids)
      : { data: [] as CotizacionLineaRow[], error: null }
    if (linesError) throw linesError
    const items = headers.map((header) => rowToQuoteDraft(header, (allLines ?? []).filter((l) => l.cotizacion_id === header.id) as CotizacionLineaRow[]))
    return { items, page: page.page, pageSize: page.pageSize, total: count ?? 0 }
  }

  async getById(id: string): Promise<(QuoteDraft & Versioned) | null> {
    const numericId = Number(id)
    if (!Number.isFinite(numericId)) return null
    return fetchQuoteById(numericId)
  }

  async save(value: QuoteDraft & Partial<Versioned>, context: MutationContext): Promise<QuoteDraft & Versioned> {
    if (context.idempotencyKey && this.idempotencyCache.has(context.idempotencyKey)) {
      return structuredClone(this.idempotencyCache.get(context.idempotencyKey)!)
    }
    const result = await this.saveInternal(value, context)
    if (context.idempotencyKey) this.idempotencyCache.set(context.idempotencyKey, result)
    return result
  }

  private async saveInternal(value: QuoteDraft & Partial<Versioned>, context: MutationContext): Promise<QuoteDraft & Versioned> {
    const actor = context.actorId ?? 'pos'
    if (!value.id) {
      const { data: newId, error } = await supabase.rpc('crear_cotizacion', {
        p_categoria: channelToCategoria(value.channel),
        p_lineas: buildLineasJsonb(value.lines, value.channel, actor),
        p_cliente_id: value.customerId ? Number(value.customerId) : null,
        p_referencia: value.number || null,
        p_descuento_general: centsToNumeric(value.generalDiscountCents),
        p_vigencia_hasta: value.validUntil || null,
        p_usuario: actor,
      })
      if (error) throw error
      const created = await fetchQuoteById(newId as number)
      if (!created) throw new NotFoundError('No se pudo releer la cotización recién creada')
      return created
    }

    const numericId = Number(value.id)
    const { data: current, error: currentError } = await supabase.from('cotizacion').select('*').eq('id', numericId).maybeSingle()
    if (currentError) throw currentError
    if (!current) throw new NotFoundError('Cotización no encontrada')
    if (context.expectedVersion !== undefined && current.version !== context.expectedVersion) {
      throw new ConflictError('La cotización fue modificada por otra sesión', { expected: context.expectedVersion, actual: current.version })
    }
    if (current.estado !== 'BORRADOR') {
      throw new ConflictError('Solo una cotización en borrador puede editarse')
    }

    const { error: deleteError } = await supabase.from('cotizacion_linea').delete().eq('cotizacion_id', numericId)
    if (deleteError) throw deleteError

    const lineRows = buildLineasJsonb(value.lines, value.channel, actor).map((line) => {
      const base: Record<string, unknown> = { cotizacion_id: numericId, creado_en: new Date().toISOString() }
      if ('es_personalizado' in line && line.es_personalizado) {
        return { ...base, es_personalizado: true, descripcion: line.descripcion, cantidad_base: line.cantidad_base, precio_unitario: line.precio_unitario, descuento_pct: line.descuento_pct, nota: line.nota, subtotal: Math.round(line.precio_unitario * line.cantidad_base * (1 - line.descuento_pct / 100) * 100) / 100 }
      }
      const l = line as { producto_id: number; cantidad_base: number; sucursal_origen_id: number; precio_lista: number; precio_unitario: number; descuento_pct: number; precio_modificado?: boolean; modificado_por?: string }
      return { ...base, producto_id: l.producto_id, cantidad_base: l.cantidad_base, sucursal_origen_id: l.sucursal_origen_id, precio_lista: l.precio_lista, precio_unitario: l.precio_unitario, descuento_pct: l.descuento_pct, precio_modificado: l.precio_modificado ?? false, modificado_por: l.precio_modificado ? (l.modificado_por ?? actor) : null, modificado_en: l.precio_modificado ? new Date().toISOString() : null, subtotal: Math.round(l.precio_unitario * l.cantidad_base * (1 - l.descuento_pct / 100) * 100) / 100 }
    })
    if (lineRows.length) {
      const { error: insertError } = await supabase.from('cotizacion_linea').insert(lineRows)
      if (insertError) throw insertError
    }

    const subtotal = lineRows.reduce((sum, row) => sum + (row.subtotal as number), 0)
    const descuentoGeneral = centsToNumeric(value.generalDiscountCents)
    const { data: updated, error: updateError } = await supabase
      .from('cotizacion')
      .update({
        cliente_id: value.customerId ? Number(value.customerId) : null,
        categoria: channelToCategoria(value.channel),
        referencia: value.number || null,
        notas: value.notes || null,
        vigencia_hasta: value.validUntil || null,
        subtotal,
        descuento_general: descuentoGeneral,
        total: subtotal - descuentoGeneral,
        version: current.version + 1,
        actualizado_en: new Date().toISOString(),
      })
      .eq('id', numericId)
      .eq('version', current.version)
      .eq('estado', 'BORRADOR')
      .select('id')

    if (updateError) throw updateError
    if (!updated || updated.length === 0) {
      throw new ConflictError('La cotización fue modificada por otra sesión en el intervalo')
    }
    const result = await fetchQuoteById(numericId)
    if (!result) throw new NotFoundError('No se pudo releer la cotización actualizada')
    return result
  }

  async duplicate(id: string, context: MutationContext): Promise<QuoteDraft & Versioned> {
    const source = await this.getById(id)
    if (!source) throw new NotFoundError('Cotización no encontrada')
    return this.save({ ...source, id: '', number: '', status: 'draft' }, context)
  }
}

export const quoteRepository = new SupabaseQuoteRepository()
