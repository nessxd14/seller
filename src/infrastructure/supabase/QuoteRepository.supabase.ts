import { supabase } from './supabaseClient'
import type { DateRange, MutationContext, Page, PageRequest, QuoteRepository, Versioned } from '../../application/ports/repositories'
import type { QuoteDraft, QuoteWorkflowStatus, WorkflowLine } from '../../application/shared/models'
import { ConflictError, NotFoundError } from '../../application/errors/AppError'
import {
  bpToPct, categoriaToChannel, centsToNumeric, channelToCategoria, defaultSucursalForChannel,
  locationToSucursalId, numericToCents, pctToBp, sucursalIdToLocation, type CondicionPago, type MedioPago,
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
  numero: string
  cliente_id: number | null
  categoria: 'TIENDA' | 'MAYOR' | 'INSTITUCIONAL' | 'CORPORATIVO'
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
  asunto: string | null
  condicion_pago: CondicionPago | null
  medio_pago: MedioPago | null
  fecha: string | null
  // Brief S-C: solicitante_id (vivo, id de cliente_contacto) y solicitado_por (nombre
  // congelado al guardar) — ambos columnas planas de cotizacion, ya cubiertas por select('*').
  solicitante_id: number | null
  solicitado_por: string | null
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
  presentacion_id: number | null
  cantidad_presentacion: number | string | null
  presentacion?: { nombre: string; factor_unidad_base: number | string } | null
}

const num = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v))

const lineaRowToWorkflowLine = (row: CotizacionLineaRow): WorkflowLine => ({
  id: String(row.id),
  productId: row.producto_id != null ? String(row.producto_id) : '',
  name: row.es_personalizado ? (row.descripcion ?? 'Ítem personalizado') : (row.producto?.nombre ?? row.descripcion ?? ''),
  sku: row.producto?.sku_interno ?? '',
  quantity: row.presentacion_id != null ? num(row.cantidad_presentacion) : num(row.cantidad_base),
  unitPriceCents: numericToCents(num(row.precio_unitario)),
  discountBasisPoints: pctToBp(num(row.descuento_pct)),
  listPriceCents: row.precio_lista != null ? numericToCents(num(row.precio_lista)) : undefined,
  isCustomItem: row.es_personalizado,
  note: row.nota ?? undefined,
  maskName: !row.es_personalizado ? (row.descripcion ?? undefined) : undefined,
  sourceLocation: row.sucursal_origen_id != null ? sucursalIdToLocation(row.sucursal_origen_id) : undefined,
  priceOverridden: row.precio_modificado,
  modifiedBy: row.modificado_por ?? undefined,
  modifiedAt: row.modificado_en ?? undefined,
  presentacionId: row.presentacion_id ?? undefined,
  presentacionNombre: row.presentacion?.nombre,
  factorUnidadBase: row.presentacion?.factor_unidad_base != null ? num(row.presentacion.factor_unidad_base) : undefined,
  cantidadPresentacion: row.cantidad_presentacion != null ? num(row.cantidad_presentacion) : undefined,
})

const rowToQuoteDraft = (header: CotizacionRow, lines: CotizacionLineaRow[]): QuoteDraft & Versioned => ({
  id: String(header.id),
  // Brief T3: `number` es el correlativo real de cotizacion.numero — asignado por trigger,
  // inmutable, nunca lo que había acá antes (header.referencia, que es un campo vestigial
  // y hoy siempre null; el asunto libre del vendedor ya vive aparte en `asunto`).
  number: header.numero,
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
  asunto: header.asunto ?? undefined,
  conditionPago: header.condicion_pago ?? undefined,
  medioPago: header.medio_pago ?? undefined,
  documentDate: header.fecha ?? undefined,
  creadoPor: header.creado_por ?? undefined,
  solicitanteId: header.solicitante_id != null ? String(header.solicitante_id) : undefined,
  solicitanteNombre: header.solicitado_por ?? undefined,
  totalCents: numericToCents(num(header.total)),
  subtotalCents: numericToCents(num(header.subtotal)),
})

// Exportado para test directo (Brief S11: serialización carrito → buildLineasJsonb con
// ítem personalizado). Sigue siendo puro — nada de I/O acá.
export const buildLineasJsonb = (lines: WorkflowLine[], channel: QuoteDraft['channel'], actor: string) =>
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
      descripcion: line.maskName || null,
      ...(line.priceOverridden ? { precio_modificado: true, modificado_por: line.modifiedBy ?? actor } : {}),
      ...(line.presentacionId != null ? { presentacion_id: line.presentacionId, cantidad_presentacion: line.quantity } : {}),
    }
  })

// small local helper: channel is already a SalesChannel value at this point
const categoriaToChannelSafe = (channel: QuoteDraft['channel']) => channel

const fetchQuoteById = async (id: number): Promise<(QuoteDraft & Versioned) | null> => {
  const { data: header, error: headerError } = await supabase.from('cotizacion').select('*, cliente(nombre)').eq('id', id).maybeSingle()
  if (headerError) throw headerError
  if (!header) return null
  const { data: lines, error: linesError } = await supabase.from('cotizacion_linea').select('*, producto(nombre,sku_interno), presentacion(nombre,factor_unidad_base)').eq('cotizacion_id', id)
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
      // Dentro de un or=(...) de PostgREST, la coma separa condiciones y el paréntesis
      // cierra el grupo: sin escapar, cualquiera de los dos rompe el filtro (400).
      const escaped = query.trim().replace(/[%,()]/g, '')
      builder = builder.ilike('referencia', `%${escaped}%`)
    }
    const { data, error, count } = await builder.order('id', { ascending: false }).range(from, to)
    if (error) throw error
    const headers = (data ?? []) as CotizacionRow[]
    const ids = headers.map((h) => h.id)
    // Sin `.range()` explícito, PostgREST recorta en silencio a 1.000 filas — con 145+
    // cotizaciones reales la suma de sus líneas ya supera eso, y las que caen del lado
    // cortado llegan con `lines: []` sin ningún error. El total de la lista ya no depende
    // de esto (viene de header.total/subtotal), pero el fetch se arregla igual para no
    // dejar la misma trampa para lo próximo que sí use `lines` acá.
    const { data: allLines, error: linesError } = ids.length
      ? await supabase.from('cotizacion_linea').select('*, producto(nombre,sku_interno), presentacion(nombre,factor_unidad_base)').in('cotizacion_id', ids).range(0, 9999)
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
        // Nunca mandar el número acá: cotizacion.numero lo asigna la base sola y es
        // inmutable. p_referencia es un campo vestigial distinto del asunto (que va en
        // p_asunto); no hay nada del vendedor que mandarle.
        p_referencia: null,
        p_descuento_general: centsToNumeric(value.generalDiscountCents),
        p_vigencia_hasta: value.validUntil || null,
        p_usuario: actor,
        p_asunto: value.asunto || null,
        p_condicion_pago: value.conditionPago || null,
        p_medio_pago: value.medioPago || null,
        p_fecha: value.documentDate || null,
        p_solicitante_id: value.solicitanteId ? Number(value.solicitanteId) : null,
      })
      if (error) throw error
      const created = await fetchQuoteById(newId as number)
      if (!created) throw new NotFoundError('No se pudo releer la cotización recién creada')
      return created
    }

    const numericId = Number(value.id)
    // Chequeo previo liviano, de solo lectura: da un NotFoundError inmediato sin armar el
    // payload de líneas si la cotización ya no existe. Todo lo que MUTA datos (borrar
    // líneas viejas, insertar nuevas, actualizar el encabezado) va en una sola llamada a
    // actualizar_cotizacion — antes eran tres llamadas HTTP separadas sin transacción que
    // las uniera, y si la tercera (el update con control de versión) fallaba, el delete de
    // las líneas viejas ya se había ejecutado y no había forma de deshacerlo desde acá.
    // Ver Brief S7: cinco cotizaciones en producción quedaron con encabezado correcto y
    // cero líneas por exactamente este motivo.
    const { data: current, error: currentError } = await supabase.from('cotizacion').select('id, version, estado').eq('id', numericId).maybeSingle()
    if (currentError) throw currentError
    if (!current) throw new NotFoundError('Cotización no encontrada')
    if (context.expectedVersion !== undefined && current.version !== context.expectedVersion) {
      throw new ConflictError('La cotización fue modificada por otra sesión', { expected: context.expectedVersion, actual: current.version })
    }
    if (current.estado !== 'BORRADOR') {
      throw new ConflictError('Solo una cotización en borrador puede editarse')
    }

    const { error: rpcError } = await supabase.rpc('actualizar_cotizacion', {
      p_cotizacion_id: numericId,
      p_version_actual: current.version,
      p_categoria: channelToCategoria(value.channel),
      p_lineas: buildLineasJsonb(value.lines, value.channel, actor),
      p_cliente_id: value.customerId ? Number(value.customerId) : null,
      p_referencia: null,
      p_notas: value.notes || null,
      p_descuento_general: centsToNumeric(value.generalDiscountCents),
      p_vigencia_hasta: value.validUntil || null,
      p_asunto: value.asunto || null,
      p_condicion_pago: value.conditionPago || null,
      p_medio_pago: value.medioPago || null,
      p_fecha: value.documentDate || null,
      p_usuario: actor,
      p_solicitante_id: value.solicitanteId ? Number(value.solicitanteId) : null,
    })
    if (rpcError) {
      if (rpcError.message.includes('no existe')) throw new NotFoundError('Cotización no encontrada')
      if (rpcError.message.includes('modificada por otra sesión')) throw new ConflictError('La cotización fue modificada por otra sesión', { expected: current.version })
      if (rpcError.message.includes('en borrador puede editarse')) throw new ConflictError('Solo una cotización en borrador puede editarse')
      throw rpcError
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
