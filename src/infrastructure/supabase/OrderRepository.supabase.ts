import { supabase } from './supabaseClient'
import type { DateRange, MutationContext, OrderRepository, Page, PageRequest, Versioned } from '../../application/ports/repositories'
import type { OrderView, OrderWorkflowStatus, WorkflowLine } from '../../application/shared/models'
import { NotFoundError } from '../../application/errors/AppError'
import {
  bpToPct, categoriaToChannel, centsToNumeric, channelToCategoria, defaultSucursalForChannel,
  locationToSucursalId, numericToCents, sucursalIdToLocation, type CategoriaPedido, type CondicionPago, type MedioPago,
} from './mappers'

type EstadoPedido = 'ABIERTO' | 'COMPLETADO' | 'CANCELADO'
type EstadoLinea = 'POR_DESPACHAR' | 'DESPACHADA' | 'PENDIENTE' | 'COMPRADO_DIRECTO' | 'ESPECIAL' | 'RECHAZADO' | 'CAMBIADA' | 'RETIRADA'

const estadoPedidoToStatus = (estado: EstadoPedido): OrderWorkflowStatus => {
  switch (estado) {
    case 'ABIERTO': return 'confirmed'
    case 'COMPLETADO': return 'delivered'
    case 'CANCELADO': return 'cancelled'
  }
}

interface PedidoRow {
  id: number
  numero: string
  categoria: 'TIENDA' | 'MAYOR' | 'INSTITUCIONAL' | 'CORPORATIVO'
  referencia: string | null
  estado: EstadoPedido
  creado_por: string | null
  creado_en: string
  cliente_id: number | null
  subtotal: number | string | null
  descuento_general: number | string | null
  total: number | string | null
  cliente?: { nombre: string } | null
  // Brief S-C: mismo criterio que en CotizacionRow — columnas planas, ya cubiertas por select('*').
  solicitante_id: number | null
  solicitado_por: string | null
  condicion_pago: CondicionPago | null
  medio_pago: MedioPago | null
  alerta_lineas_en: string | null
  alerta_lineas_vista_en: string | null
}

interface PedidoLineaRow {
  id: number
  pedido_id: number
  producto_id: number | null
  cantidad_base: number | string
  estado: EstadoLinea
  cantidad_despachada: number | string | null
  sucursal_origen_id: number | null
  es_personalizado: boolean
  descripcion: string | null
  nota: string | null
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
  // Brief: reemplazada_por_id tiene FK propia a pedido_linea(id) — PostgREST la resuelve
  // anidada igual que producto:producto_id(...). Solo se pide en fetchOrderById (detalle
  // puntual), nunca en list() — que ya no trae líneas en absoluto (tope de 1.000 filas).
  reemplazada_por?: { id: number; cantidad_base: number | string; cantidad_presentacion: number | string | null; es_personalizado: boolean; descripcion: string | null; producto?: { nombre: string } | null } | null
}

interface PedidoEventoRow {
  id: number
  accion: 'ANULADO' | 'RESTAURADO' | 'LINEA_RECHAZADA' | 'LINEA_CAMBIADA' | 'LINEA_RETIRADA' | 'LINEAS_AGREGADAS'
  motivo: string | null
  estado_previo: string | null
  usuario: string
  creado_en: string
}

const estadoLabel: Record<string, string> = { ABIERTO: 'Abierto', COMPLETADO: 'Completado', CANCELADO: 'Cancelado' }

// El select('*') de pedido_evento no filtra por `accion` — además de ANULADO/RESTAURADO
// también trae LINEA_RECHAZADA/LINEA_CAMBIADA/LINEA_RETIRADA/LINEAS_AGREGADAS (eventos que
// Almacén dispara al rechazar/cambiar/retirar una línea, o al agregar ítems). El ternario
// viejo (ANULADO ? 'anulado' : 'restaurado') etiquetaba cualquiera de esos como "Pedido
// restaurado" — dato falso en el historial.
const accionLabel: Record<PedidoEventoRow['accion'], string> = {
  ANULADO: 'Pedido anulado',
  RESTAURADO: 'Pedido restaurado',
  LINEA_RECHAZADA: 'Línea rechazada',
  LINEA_CAMBIADA: 'Línea cambiada',
  LINEA_RETIRADA: 'Línea retirada',
  LINEAS_AGREGADAS: 'Ítems agregados',
}

const eventoRowToEvent = (row: PedidoEventoRow) => ({
  at: new Date(row.creado_en).toLocaleString('es-BO'),
  label: accionLabel[row.accion] ?? row.accion,
  // estado_previo no aplica a los eventos de línea — viene null.
  detail: row.accion === 'ANULADO' || row.accion === 'RESTAURADO'
    ? `${row.usuario} · ${row.motivo} · antes: ${estadoLabel[row.estado_previo ?? ''] ?? row.estado_previo}`
    : `${row.usuario}${row.motivo ? ' · ' + row.motivo : ''}`,
})

const num = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v))

// convertir_cotizacion_a_pedido escribe 'Cotización #<id>[ — <referencia de la cotización>]'
// en pedido.referencia — texto automático, no algo que el vendedor tipeó. No mostrarlo como
// asunto (Tarea 1: "hoy se usa la referencia como si fuera el identificador; eso sale") ni
// como si fuera el número del pedido — de ahí se saca únicamente el id de la cotización de
// origen, para resolver su número real (sourceQuoteNumber) en fetchOrderById/list.
const CONVERTED_FROM_QUOTE_RE = /^Cotizaci[oó]n #(\d+)/

type OrderLine = WorkflowLine & { prepared: number; allocations: { location: 'Tienda' | 'Almacén'; quantity: number }[] }

const lineaRowToOrderLine = (row: PedidoLineaRow): OrderLine => {
  const baseQuantity = num(row.cantidad_base)
  const quantity = row.presentacion_id != null ? num(row.cantidad_presentacion) : baseQuantity
  const prepared = row.estado === 'DESPACHADA' || row.estado === 'COMPRADO_DIRECTO' ? baseQuantity : 0
  return {
    id: String(row.id),
    productId: row.producto_id != null ? String(row.producto_id) : '',
    name: row.es_personalizado ? (row.descripcion ?? 'Ítem especial') : (row.producto?.nombre ?? row.descripcion ?? ''),
    sku: row.producto?.sku_interno ?? '',
    quantity,
    unitPriceCents: numericToCents(num(row.precio_unitario)),
    discountBasisPoints: bpToPctSafe(num(row.descuento_pct)),
    listPriceCents: row.precio_lista != null ? numericToCents(num(row.precio_lista)) : undefined,
    isCustomItem: row.es_personalizado || row.estado === 'ESPECIAL',
    note: row.nota ?? undefined,
    sourceLocation: row.sucursal_origen_id != null ? sucursalIdToLocation(row.sucursal_origen_id) : undefined,
    priceOverridden: row.precio_modificado,
    modifiedBy: row.modificado_por ?? undefined,
    modifiedAt: row.modificado_en ?? undefined,
    maskName: !row.es_personalizado ? (row.descripcion ?? undefined) : undefined,
    presentacionId: row.presentacion_id ?? undefined,
    presentacionNombre: row.presentacion?.nombre,
    factorUnidadBase: row.presentacion?.factor_unidad_base != null ? num(row.presentacion.factor_unidad_base) : undefined,
    cantidadPresentacion: row.cantidad_presentacion != null ? num(row.cantidad_presentacion) : undefined,
    prepared,
    allocations: row.sucursal_origen_id != null ? [{ location: sucursalIdToLocation(row.sucursal_origen_id), quantity: baseQuantity }] : [],
    lineStatus: row.estado,
    replacedByName: row.reemplazada_por
      ? (row.reemplazada_por.es_personalizado ? (row.reemplazada_por.descripcion ?? 'Ítem especial') : (row.reemplazada_por.producto?.nombre ?? row.reemplazada_por.descripcion ?? ''))
      : undefined,
    replacedByQuantity: row.reemplazada_por
      ? num(row.reemplazada_por.cantidad_presentacion ?? row.reemplazada_por.cantidad_base)
      : undefined,
  }
}
// local alias to avoid importing pctToBp under a name collision with bpToPct import above
const bpToPctSafe = (pct: number) => Math.round(pct * 100)

const rowToOrderView = (header: PedidoRow, lines: PedidoLineaRow[], eventos: PedidoEventoRow[]): OrderView & Versioned => {
  const convertedMatch = header.referencia?.match(CONVERTED_FROM_QUOTE_RE)
  return {
    id: String(header.id),
    // Brief T3: `number` es el correlativo real de pedido.numero — asignado por trigger,
    // inmutable. El viejo fallback `PED-${id}` desaparece: si numero llega vacío es un bug
    // que hay que ver, no algo que disimular.
    number: header.numero,
    customerId: header.cliente_id != null ? String(header.cliente_id) : undefined,
    customerName: header.cliente?.nombre ?? '',
    channel: categoriaToChannel(header.categoria) as OrderView['channel'],
    status: estadoPedidoToStatus(header.estado),
    createdAt: header.creado_en,
    lines: lines.map(lineaRowToOrderLine),
    events: eventos.map(eventoRowToEvent),
    subtotalCents: header.subtotal != null ? numericToCents(num(header.subtotal)) : undefined,
    generalDiscountCents: header.descuento_general != null ? numericToCents(num(header.descuento_general)) : undefined,
    totalCents: header.total != null ? numericToCents(num(header.total)) : undefined,
    // pedido has no version column: orders are created/converted/dispatched, not
    // optimistically edited, so we synthesize a constant version.
    version: 1,
    updatedAt: header.creado_en,
    sourceQuoteId: convertedMatch ? convertedMatch[1] : undefined,
    asunto: convertedMatch ? undefined : (header.referencia ?? undefined),
    creadoPor: header.creado_por ?? undefined,
    solicitanteId: header.solicitante_id != null ? String(header.solicitante_id) : undefined,
    solicitanteNombre: header.solicitado_por ?? undefined,
    conditionPago: header.condicion_pago ?? undefined,
    medioPago: header.medio_pago ?? undefined,
    needsAttention: !!header.alerta_lineas_en &&
      (!header.alerta_lineas_vista_en || header.alerta_lineas_vista_en < header.alerta_lineas_en),
  }
}

// Brief: marca pedido.alerta_lineas_vista_en = now() cuando alguien abre el pedido en
// Seller, para apagar el flag de "necesita atención" de la grilla (OrdersPage.tsx la
// llama fire-and-forget al abrir el detalle, sin bloquear el render).
export const marcarPedidoAtencionVista = async (pedidoId: number, usuario?: string): Promise<void> => {
  const { error } = await supabase.rpc('marcar_pedido_atencion_vista', { p_pedido_id: pedidoId, p_usuario: usuario ?? null })
  if (error) throw error
}

// Batch-resuelve numero de cotizacion para los pedidos convertidos de una página/detalle —
// un solo roundtrip por lista, no uno por fila.
const resolveSourceQuoteNumeros = async (orders: Array<OrderView & Versioned>): Promise<Array<OrderView & Versioned>> => {
  const ids = Array.from(new Set(orders.map((o) => o.sourceQuoteId).filter((id): id is string => !!id).map(Number)))
  if (!ids.length) return orders
  const { data, error } = await supabase.from('cotizacion').select('id, numero').in('id', ids)
  if (error) throw error
  const numeroById = new Map((data ?? []).map((row) => [String((row as { id: number }).id), (row as { numero: string }).numero]))
  return orders.map((order) => order.sourceQuoteId ? { ...order, sourceQuoteNumber: numeroById.get(order.sourceQuoteId) } : order)
}

const fetchOrderById = async (id: number): Promise<(OrderView & Versioned) | null> => {
  const { data: header, error: headerError } = await supabase.from('pedido').select('*, cliente(nombre)').eq('id', id).maybeSingle()
  if (headerError) throw headerError
  if (!header) return null
  const { data: lines, error: linesError } = await supabase.from('pedido_linea')
    .select('*, producto(nombre,sku_interno), presentacion(nombre,factor_unidad_base), reemplazada_por:reemplazada_por_id(id, cantidad_base, cantidad_presentacion, es_personalizado, descripcion, producto(nombre))')
    .eq('pedido_id', id)
  if (linesError) throw linesError
  const { data: eventos, error: eventosError } = await supabase.from('pedido_evento').select('*').eq('pedido_id', id).order('creado_en', { ascending: true })
  // pedido_evento is created by TAREA 2's migration — not applied yet, so a missing-table
  // error here shouldn't break order loading; just show no history until it lands.
  const eventRows = eventosError ? [] : ((eventos ?? []) as PedidoEventoRow[])
  const [view] = await resolveSourceQuoteNumeros([rowToOrderView(header as PedidoRow, (lines ?? []) as PedidoLineaRow[], eventRows)])
  return view
}

export const buildLineasJsonb = (lines: WorkflowLine[], channel: OrderView['channel']) =>
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
      sucursal_origen_id: line.sourceLocation ? locationToSucursalId(line.sourceLocation) : defaultSucursalForChannel(channel),
      precio_lista: line.listPriceCents != null ? centsToNumeric(line.listPriceCents) : centsToNumeric(line.unitPriceCents),
      precio_unitario: centsToNumeric(line.unitPriceCents),
      descuento_pct: bpToPct(line.discountBasisPoints),
      descripcion: line.maskName || null,
      ...(line.presentacionId != null ? { presentacion_id: line.presentacionId, cantidad_presentacion: line.quantity } : {}),
    }
  })

export class SupabaseOrderRepository implements OrderRepository {
  async list(input: { query?: string; status?: OrderView['status']; channel?: OrderView['channel']; categorias?: CategoriaPedido[]; dates?: DateRange; page: PageRequest }): Promise<Page<OrderView & Versioned>> {
    const { status, channel, categorias, dates, page } = input
    const from = (page.page - 1) * page.pageSize
    const to = from + page.pageSize - 1
    let builder = supabase.from('pedido').select('*, cliente(nombre)', { count: 'exact' })
    if (status === 'confirmed') builder = builder.eq('estado', 'ABIERTO')
    else if (status === 'delivered') builder = builder.eq('estado', 'COMPLETADO')
    else if (status === 'cancelled') builder = builder.eq('estado', 'CANCELADO')
    if (channel) builder = builder.eq('categoria', channelToCategoria(channel))
    // Brief P1: segmento Retail/Wholesale — filtra por categoria del lado del servidor,
    // nunca por prefijo de numero (los 221 retail históricos son PED-, no TKT-).
    if (categorias?.length) builder = builder.in('categoria', categorias)
    if (dates?.from) builder = builder.gte('creado_en', dates.from)
    if (dates?.to) builder = builder.lte('creado_en', dates.to)
    const { data, error, count } = await builder.order('id', { ascending: false }).range(from, to)
    if (error) throw error
    const headers = (data ?? []) as PedidoRow[]
    // La lista no trae líneas: mismo bug que en Cotizaciones (ver QuoteRepository.supabase.ts
    // list()) — Supabase aplica un tope propio de 1.000 filas (db-max-rows) a nivel de
    // proyecto que ningún .range() del cliente puede levantar, y con 397+ pedidos reales
    // (1.422+ líneas combinadas) un .in('pedido_id', ids) sin paginar ya lo supera — los
    // pedidos cuyas líneas caían del lado cortado llegaban con `lines: []` sin ningún
    // error. El total de la lista no depende de esto (rowToOrderView ya lee
    // totalCents/subtotalCents de header.total/subtotal); cada item se arma con
    // `lines: []` y quien necesite las líneas reales de un pedido puntual las trae
    // fresco por su propio id (getById/fetchOrderById, nunca sujeto a este límite).
    // List rows don't need the bitácora — only the detail panel does — so events stay
    // empty here rather than fetching pedido_evento for every row on every page load.
    const items = await resolveSourceQuoteNumeros(headers.map((header) => rowToOrderView(header, [], [])))
    return { items, page: page.page, pageSize: page.pageSize, total: count ?? 0 }
  }

  async getById(id: string): Promise<(OrderView & Versioned) | null> {
    const numericId = Number(id)
    if (!Number.isFinite(numericId)) return null
    return fetchOrderById(numericId)
  }

  async save(value: OrderView & Partial<Versioned>, context: MutationContext): Promise<OrderView & Versioned> {
    const actor = context.actorId ?? 'pos'
    if (value.sourceQuoteId) {
      // Brief S-C: si no se cambió el solicitante en la pantalla de conversión, value.solicitanteId
      // ya viene precargado con el de la cotización de origen (el editor arranca desde esa
      // cotización) — pasarlo explícito acá es idempotente. Si se cambió, este es justamente
      // el valor nuevo, que tiene que ganarle al heredado.
      const { data: newId, error } = await supabase.rpc('convertir_cotizacion_a_pedido', {
        p_cotizacion_id: Number(value.sourceQuoteId),
        p_usuario: actor,
        p_solicitante_id: value.solicitanteId ? Number(value.solicitanteId) : null,
      })
      if (error) throw error
      // Brief S11 Bloque B1: versión 1 al crear, para que haya algo que navegar/comparar
      // el día que el pedido se edite (desde acá o desde el WMS — pedido_version es
      // compartida). Best-effort a propósito: nunca puede tumbar la creación, que ya
      // ocurrió; si falla, el pedido queda sin historial hasta la próxima edición exitosa.
      await guardarVersionPedidoSilencioso(newId as number, 'Pedido creado desde cotización', actor)
      const created = await fetchOrderById(newId as number)
      if (!created) throw new NotFoundError('No se pudo releer el pedido recién convertido')
      return created
    }
    const { data: newId, error } = await supabase.rpc('crear_pedido', {
      p_categoria: channelToCategoria(value.channel),
      // Nunca el número acá: pedido.numero lo asigna la base sola y es inmutable.
      // p_referencia es el asunto libre del vendedor.
      p_referencia: value.asunto || null,
      p_lineas: buildLineasJsonb(value.lines, value.channel),
      p_usuario: actor,
      p_cliente_id: value.customerId ? Number(value.customerId) : null,
      p_descuento_general: centsToNumeric(value.generalDiscountCents ?? 0),
      p_solicitante_id: value.solicitanteId ? Number(value.solicitanteId) : null,
      p_condicion_pago: value.conditionPago || null,
      p_medio_pago: value.medioPago || null,
    })
    if (error) throw error
    await guardarVersionPedidoSilencioso(newId as number, 'Pedido creado', actor)
    const created = await fetchOrderById(newId as number)
    if (!created) throw new NotFoundError('No se pudo releer el pedido recién creado')
    return created
  }
}

const guardarVersionPedidoSilencioso = async (pedidoId: number, motivo: string, usuario: string): Promise<void> => {
  try {
    await supabase.rpc('guardar_version_pedido', { p_pedido_id: pedidoId, p_motivo: motivo, p_usuario: usuario })
  } catch {
    // Ver comentario en el call site: nunca bloquea la creación del pedido.
  }
}

export const orderRepository = new SupabaseOrderRepository()
