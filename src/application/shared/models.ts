import type { SalesChannel } from '../../domain/common/types'

export type UiStatus = 'idle' | 'loading' | 'error' | 'success'
export type QuoteWorkflowStatus = 'draft' | 'sent' | 'negotiating' | 'approved' | 'rejected' | 'expired' | 'converted'
export type OrderWorkflowStatus = 'draft' | 'confirmed' | 'awaiting_stock' | 'reserved' | 'preparing' | 'ready' | 'dispatched' | 'delivered' | 'cancelled'

export interface WorkflowLine {
  id: string
  productId: string
  name: string
  sku: string
  quantity: number
  unitPriceCents: number
  discountBasisPoints: number
  // Optional Supabase-backed extensions (all optional so mock consumers are unaffected):
  listPriceCents?: number
  isCustomItem?: boolean
  note?: string
  sourceLocation?: 'Tienda' | 'Almacén'
  priceOverridden?: boolean
  modifiedBy?: string
  modifiedAt?: string
  // Presentation (item 3): quantity is always expressed in the currently selected
  // presentation's unit; factorUnidadBase (default 1 = base unit) converts it to base
  // units for stock validation and for cantidad_base when no presentacionId is set.
  presentacionId?: number
  presentacionNombre?: string
  factorUnidadBase?: number
  cantidadPresentacion?: number
  // Ronda 10 — TAREA 1: catalog-line-only "print name" mask (backed by cotizacion_linea/
  // pedido_linea.descripcion, same column es_personalizado items already used). `name`
  // always stays the real catalog product name — never overwritten — so despacho/picking
  // views and the editor keep showing it regardless of this field. Irrelevant when
  // isCustomItem is true (there, `name` already IS the free-text descripcion).
  maskName?: string
  // Brief S-I Tarea 3: estado real de pedido_linea (Supabase mode únicamente — mock queda
  // undefined, sin líneas RECHAZADO/CAMBIADA/RETIRADA que distinguir). Las acciones que
  // producen estos tres estados se disparan desde Almacén (brief aparte); acá es de solo
  // lectura, para dar tratamiento visual distinto a una línea activa.
  lineStatus?: 'POR_DESPACHAR' | 'DESPACHADA' | 'PENDIENTE' | 'COMPRADO_DIRECTO' | 'ESPECIAL' | 'RECHAZADO' | 'CAMBIADA' | 'RETIRADA'
  // Brief: cuando lineStatus === 'CAMBIADA', esto trae un resumen de la línea que
  // la reemplazó (pedido_linea.reemplazada_por_id, ya con FK propia — PostgREST
  // la resuelve anidada sin nada especial del lado de la query).
  replacedByName?: string
  replacedByQuantity?: number
}

export interface QuoteDraft {
  id: string
  number: string
  customerId: string
  customerName: string
  channel: Extract<SalesChannel, 'mayoreo' | 'institucional' | 'corporativo'>
  status: QuoteWorkflowStatus
  validUntil: string
  terms: string
  notes: string
  generalDiscountCents: number
  createdAt: string
  lines: WorkflowLine[]
  // Item 3 bonus: quote-only fields backed by cotizacion.asunto/condicion_pago/fecha.
  // Optional/additive — undefined in mock mode and for older quote rows.
  asunto?: string
  // Brief S-E: dos ejes separados — conditionPago (CONTADO/CREDITO, término de pago) y
  // medioPago (cómo se paga: efectivo/QR/transferencia/SIGEP/cheque/depósito). Antes un
  // solo campo mezclaba ambos (p. ej. 'SIGEP' como si fuera una condición de pago).
  conditionPago?: 'CONTADO' | 'CREDITO'
  medioPago?: 'EFECTIVO' | 'QR' | 'TRANSFERENCIA' | 'SIGEP' | 'CHEQUE' | 'DEPOSITO'
  documentDate?: string
  // Brief S3 — cotizacion.creado_por (email). Resolver contra `perfil` para un nombre
  // legible; el email es el respaldo si no hay perfil (ver PerfilRepository.supabase.ts).
  creadoPor?: string
  // Brief S-C: solicitanteId (cliente_contacto.id) es el valor VIVO que se manda a
  // crear_cotizacion/actualizar_cotizacion — puede cambiar mientras se edita.
  // solicitanteNombre es el nombre CONGELADO (cotizacion.solicitado_por) que la base
  // guarda al momento de guardar; se muestra tal cual en listados/detalle, nunca se
  // vuelve a resolver contra cliente_contacto (si el contacto se desactivó después, el
  // documento tiene que seguir mostrando quién lo pidió en su momento).
  solicitanteId?: string
  solicitanteNombre?: string
  // Brief: total/subtotal ya calculados por la base (cotizacion.total/subtotal),
  // para que la lista no tenga que recomputarlos sumando `lines` — con el tope de
  // 1.000 filas de PostgREST, cotizaciones con líneas recortadas por la paginación
  // masiva de list() mostraban Bs 0,00 aunque el total real en la base fuera correcto.
  // Undefined en modo mock (donde `lines` siempre está completo y confiable).
  totalCents?: number
  subtotalCents?: number
}

export interface OrderView {
  id: string
  number: string
  customerId?: string
  customerName: string
  channel: Extract<SalesChannel, 'mayoreo' | 'institucional' | 'corporativo'>
  status: OrderWorkflowStatus
  createdAt: string
  sourceQuoteId?: string
  lines: Array<WorkflowLine & { prepared: number; allocations: { location: 'Tienda' | 'Almacén'; quantity: number }[] }>
  events: { at: string; label: string; detail: string }[]
  // Mock backend only: remembers the status a cancelled order had before anulación,
  // so restore() can return it there instead of always defaulting to 'confirmed'.
  // Supabase mode doesn't need this field — restaurar_pedido() reads estado_previo
  // straight from pedido_evento.
  previousStatus?: OrderWorkflowStatus
  // Totales del encabezado (pedido.subtotal / descuento_general / total).
  // De IDA: generalDiscountCents es lo que se manda a crear_pedido.
  // De VUELTA: los tres se leen tal cual de la fila; son la verdad, no se
  // recalculan. Quedan undefined en modo mock y en pedidos sin precios
  // (crear_pedido deja el header en NULL si ninguna línea trae precio_unitario).
  subtotalCents?: number
  generalDiscountCents?: number
  totalCents?: number
  // Brief T3: pedido.referencia es el asunto libre del vendedor (no el número — ese es
  // `number`, respaldado por pedido.numero). Ausente cuando el pedido nació de una
  // conversión de cotización — ahí referencia trae el texto automático "Cotización #<id>"
  // que no es asunto de nadie, y se resuelve en su lugar en sourceQuoteNumber.
  asunto?: string
  // Número real (COT-2026-XXXXX) de la cotización de origen, resuelto server-side a partir
  // del texto "Cotización #<id>" que crea_pedido — vía convertir_cotizacion_a_pedido — deja
  // en referencia. Ausente si el pedido no vino de una cotización.
  sourceQuoteNumber?: string
  // Brief S3 — pedido.creado_por (email, quién lo creó). Cuando sourceQuoteId no es null,
  // este mismo campo también identifica quién hizo la CONVERSIÓN (crear_pedido con
  // cotizacion_origen_id corre como el usuario que convierte, no hay un campo aparte).
  creadoPor?: string
  // Brief S-C: mismo criterio que en QuoteDraft — solicitanteId es el valor vivo (para
  // convertir_cotizacion_a_pedido/crear_pedido); solicitanteNombre es pedido.solicitado_por,
  // congelado al crear el pedido, nunca re-resuelto contra cliente_contacto.
  solicitanteId?: string
  solicitanteNombre?: string
  // Brief S-E: heredados de la cotización de origen al convertir (o mandados directo al
  // crear pedido sin pasar por cotización) — mismo par de campos que QuoteDraft.
  conditionPago?: 'CONTADO' | 'CREDITO'
  medioPago?: 'EFECTIVO' | 'QR' | 'TRANSFERENCIA' | 'SIGEP' | 'CHEQUE' | 'DEPOSITO'
  // pedido.alerta_lineas_en: se marca desde Cation cada vez que Almacén rechaza o
  // cambia una línea. pedido.alerta_lineas_vista_en: se marca cuando alguien abre
  // el pedido en Seller (marcar_pedido_atencion_vista). needsAttention es la
  // comparación de ambas, resuelta acá para no repetirla en cada consumidor.
  needsAttention?: boolean
}

export interface CustomerRecord {
  id: string
  name: string
  type: 'retail' | 'wholesale' | 'institutional' | 'corporate'
  document: string
  phone: string
  email: string
  address: string
  usualChannel: SalesChannel
  paymentTerms: string
  /** Solo modo mock. En Supabase el saldo real viene de Hermes, no de Cation. */
  creditLimitCents?: number
  pendingBalanceCents?: number
  // Optional Supabase-backed extensions (all optional so mock consumers/seeds are
  // unaffected). origin: cliente.origen ('shopify' rows come from
  // scripts/bootstrap_clientes.mjs; everything else is 'manual'). businessName/city:
  // cliente.razon_social/ciudad.
  origin?: 'shopify' | 'manual'
  businessName?: string
  city?: string
  // Brief S-H: tope de la institución (cliente.tope_autorizado) — solo aplica a
  // institutional/corporate (resolver_tope/evaluar_tope ni se llaman para retail/mayorista).
  // Bs, no centavos — mismo criterio que ContactoCliente.tope (brief S-C/S-G), no el de
  // creditLimitCents. undefined/null = sin tope, nunca 0.
  topeAutorizado?: number
}

// Traslados Almacén <-> Tienda (Parte 1). Mirrors solicitud_traslado/solicitud_traslado_linea
// closely rather than forcing it into the generic Versioned/CRUD repository shape — like
// SaleRepository/CashRepository, transfers are RPC-driven (create/receive/cancel actions,
// no optimistic-edit "save" verb) and solicitud_traslado has no version column.
// Brief J: DEVOLUCION added to the DB enum by 2026-07-30_traslado_devolucion_enum.sql
// (verified applied against production before adding this — see motivo_traslado in pg_enum).
export type TransferMotivo = 'VENTA_DIRECTA' | 'REPOSICION' | 'DEVOLUCION'
export type TransferEstado = 'SOLICITADO' | 'EN_TRANSITO' | 'RECIBIDO' | 'RECHAZADO' | 'CANCELADO'

export interface TransferLine {
  id: string
  productId: string
  name: string
  sku: string
  presentacionId?: number
  presentacionNombre?: string
  cantidadPresentacion?: number
  cantidadBase: number
  cantidadDespachada?: number
  cantidadRecibida?: number
  nota?: string
}

export interface TransferRecord {
  id: string
  motivo: TransferMotivo
  estado: TransferEstado
  sucursalOrigenId: number
  sucursalDestinoId: number
  // Número correlativo real (TRA-2026-XXXXX), respaldado por solicitud_traslado.numero —
  // asignado por trigger al insertar, inmutable. Distinto de `referencia` (el asunto libre
  // del vendedor): nunca usar uno como identificador del otro.
  numero: string
  referencia?: string
  nota?: string
  solicitadoPor: string
  solicitadoEn: string
  despachadoPor?: string
  despachadoEn?: string
  recibidoPor?: string
  recibidoEn?: string
  creadoEn: string
  // Brief K: solo tiene valor mientras estado === 'EN_TRANSITO' y la ventana de reversión
  // de 30 min (fijada por despachar_traslado, ver 2026-07-30_traslado_reversion.sql) sigue
  // abierta. Nunca hardcodear los 30 min en el frontend — se calcula contra esto.
  reversibleHasta?: string
  lines: TransferLine[]
}

// Venta Directa de Almacén (VTD) — Brief VTD. Una `venta` (no un `pedido`, ver B2 del
// brief): abrir_venta la crea ABIERTA sin tocar el Kardex; completar_venta la cierra
// (recién ahí baja stock); ajustar_venta_abierta solo reduce cantidades; anular_venta la
// cancela devolviendo lo cobrado. `modo` lo resuelve el backend según haya pagos o no —
// nunca recalcularlo en el cliente (brief 2.2).
export type VtdModo = 'PRECOBRADO' | 'POSTCOBRADO'
export type VtdEstado = 'ABIERTA' | 'COMPLETADA' | 'ANULADA'

export interface VtdLine {
  id: string
  productId: string
  name: string
  sku: string
  presentacionId?: number
  presentacionNombre?: string
  // Siempre en unidad de PRESENTACIÓN (bultos) — el almacenero cuenta bultos, nunca
  // unidades base (brief 2.3, el mismo bug que ya costó un descuadre en completar_venta).
  cantidadPresentacion: number
  precioUnitarioCents: number
}

export interface VentaDirectaRecord {
  id: string
  // B1: serie propia VTD-2026-NNNNN (venta.numero), asignada por abrir_venta. venta.id
  // crudo nunca se muestra como identificador — es justamente lo que B1 resolvió.
  numero: string
  estado: VtdEstado
  modo: VtdModo
  ubicacionId: number
  sesionCajaId: string
  customerId?: string
  customerName?: string
  subtotalCents: number
  discountCents: number
  totalCents: number
  paidCents: number
  creadoPor?: string
  creadoEn: string
  completadoEn?: string
  lines: VtdLine[]
}

// Brief S1 — borrador_operacion. Guardado explícito ("tipo Instagram"), distinto del
// autosave silencioso de useBorrador.ts y de la suspensión de venta retail
// (infrastructure/local/suspendedSales.ts): este vive en el servidor (sobrevive a un F5
// y es visible solo para su autor vía RLS), tiene una bandeja navegable propia, y expira
// a las 24 h de renovadas — el backend ya resuelve renovación (trigger trg_borrador_touch)
// y barrido (7 días); el cliente NUNCA calcula expira_en.
export type BorradorOperacionTipo = 'VENTA' | 'VENTA_DIRECTA' | 'TRASLADO' | 'COTIZACION'

export interface BorradorOperacionRecord {
  id: string
  tipo: BorradorOperacionTipo
  sucursalId?: number
  titulo?: string
  // Foto del momento de guardar — sin normalizar, sin validar. Su forma depende de
  // `tipo` (ver domain/sales/borradorContenido.ts) y hay que revalidarla contra la base
  // al retomar (productos borrados, precios cambiados), nunca restaurarla a ciegas.
  contenido: unknown
  creadoEn: string
  actualizadoEn: string
  expiraEn: string
}

export interface CashSessionRecord {
  id: string
  register: string
  openedAt: string
  openingCents: number
  status: 'open' | 'closed'
  movements: { id: string; type: 'income' | 'expense'; method: 'cash' | 'qr' | 'transfer'; amountCents: number; note: string; at: string }[]
  countedCents?: number
  closedAt?: string
  // Optional Supabase-backed extension: cerrar_caja's computed difference (contado -
  // esperado), persisted on sesion_caja.diferencia. Undefined in mock mode.
  differenceCents?: number
}

