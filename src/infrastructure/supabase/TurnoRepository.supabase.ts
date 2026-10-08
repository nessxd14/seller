// Brief Caja-1 — turno de cajero. Capa nueva, separada de CashRepository.supabase.ts
// (que sigue existiendo tal cual para no romper el mock ni el resto del POS): llama
// directo a las RPCs de db/migrations/2026-09-27_caja_turno_cajero.sql. Ver
// featureFlags.supabase en CashPage.tsx — este repositorio solo se usa ahí.
import { supabase } from './supabaseClient'
import { toError } from './postgrestError'
import { createUuid } from '../../application/shared/createUuid'
import type { CajaFaltanteRecord, CajaGastoRecord, Denominaciones, EstadoBancoQr, MovimientoBancoQr, PagoPorVerificar, TurnoEstado, TurnoResumen, TurnoSesion, TurnoTicket, TurnoMovimiento } from '../../application/shared/models'

// Brief: "hoy solo hay una caja habilitada operando este POS" — mismo criterio que
// CAJA_ID en CashRepository.supabase.ts (verificado contra la tabla `caja`: una sola
// fila, id 1, "Caja Tienda").
export const CAJA_ID = 1

const num = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v))

interface SesionRow {
  id: number
  caja_id: number
  estado: TurnoEstado
  monto_apertura: number | string
  cajero_id: string | null
  abierta_por: string | null
  abierta_en: string
  cerrada_por: string | null
  cerrada_en: string | null
  diferencia_relevo: number | string | null
  caja?: { nombre: string } | null
}

const rowToSesion = (row: SesionRow): TurnoSesion => ({
  id: String(row.id),
  cajaId: row.caja_id,
  cajaNombre: row.caja?.nombre ?? 'Caja Tienda',
  estado: row.estado,
  aperturaBs: num(row.monto_apertura),
  cajeroId: row.cajero_id ?? undefined,
  abiertaPor: row.abierta_por ?? undefined,
  abiertaEn: row.abierta_en,
  cerradaPor: row.cerrada_por ?? undefined,
  cerradaEn: row.cerrada_en ?? undefined,
  diferenciaRelevoBs: row.diferencia_relevo != null ? num(row.diferencia_relevo) : null,
})

// NUNCA selecciona monto_cierre_contado/diferencia acá — esas son las dos columnas que
// el conteo ciego (B3) prohíbe mostrarle a un cajero, y a diferencia de las RPCs (que sí
// las esconden server-side), un select directo a la tabla no las filtraría por rol. El
// resto del módulo (resumen_turno, cerrar_turno) es la única fuente para esos dos campos.
const SESION_SELECT = 'id, caja_id, estado, monto_apertura, cajero_id, abierta_por, abierta_en, cerrada_por, cerrada_en, diferencia_relevo, caja(nombre)'

export async function listTurnos(): Promise<TurnoSesion[]> {
  const { data, error } = await supabase.from('sesion_caja').select(SESION_SELECT).order('abierta_en', { ascending: false }).limit(50)
  if (error) throw toError(error)
  return ((data ?? []) as unknown as SesionRow[]).map(rowToSesion)
}

/** La pertenencia siempre es sesion_caja_id: nunca una aproximación por fecha. */
export async function listMovimientosTurno(sesionId: string): Promise<TurnoMovimiento[]> {
  const { data, error } = await supabase.from('movimiento_caja')
    .select('id,venta_id,tipo,subtipo,metodo,monto,nota,creado_en,fuera_de_arqueo,cliente(nombre),pedido(numero,cliente(nombre)),venta(numero,cliente_acreedor,cliente(nombre)),caja_gasto(motivo,estado,comprobante_path)')
    .eq('sesion_caja_id', Number(sesionId)).order('creado_en', { ascending: false }).limit(500)
  if (error) throw toError(error)
  const cashMovements: TurnoMovimiento[] = (data ?? []).map((value) => {
    const row = value as unknown as { fuera_de_arqueo?: boolean | null; venta_id?: number | null; id: number; tipo: string; subtipo: string | null; metodo: string; monto: number; nota: string | null; creado_en: string; cliente: { nombre: string } | null; pedido: { numero: string; cliente: { nombre: string } | null } | null; venta: { numero: string; cliente_acreedor?: boolean; cliente?: { nombre: string } | null } | null; caja_gasto: { motivo: string; estado: string; comprobante_path: string | null } | null }
    return { id: String(row.id), ventaId: row.venta_id != null ? String(row.venta_id) : undefined, tipo: row.tipo, subtipo: row.subtipo ?? undefined, metodo: row.metodo, montoBs: num(row.monto), detalle: row.caja_gasto?.motivo ?? row.nota ?? '', clienteNombre: row.cliente?.nombre ?? row.pedido?.cliente?.nombre ?? row.venta?.cliente?.nombre, clienteAcreedor: row.venta?.cliente_acreedor === true, documento: row.venta?.numero ?? row.pedido?.numero, creadoEn: row.creado_en, estadoGasto: row.caja_gasto?.estado, comprobantePath: row.caja_gasto?.comprobante_path ?? undefined, fueraDeArqueo: row.fuera_de_arqueo === true }
  })
  const { data: usos, error: usosError } = await supabase.from('saldo_cliente_uso')
    .select('id,venta_id,monto,creado_en,anulado_en,motivo_anulacion,venta(numero),pedido(numero),cliente:cliente!saldo_cliente_uso_cliente_id_fkey(nombre)')
    .eq('sesion_caja_id', Number(sesionId)).order('creado_en', { ascending: false }).limit(500)
  if (usosError) throw toError(usosError)
  const balanceMovements: TurnoMovimiento[] = (usos ?? []).map(value => {
    const u = value as unknown as { venta_id?: number | null; id: number; monto: number | string; creado_en: string; anulado_en: string | null; motivo_anulacion: string | null; venta: { numero: string } | null; pedido: { numero: string } | null; cliente: { nombre: string } | null }
    return { id: 'saldo-' + u.id, ventaId: u.venta_id != null ? String(u.venta_id) : undefined, tipo: u.anulado_en ? 'SALDO_REVERTIDO' : 'SALDO_FAVOR', metodo: 'SALDO_FAVOR', montoBs: num(u.monto), detalle: u.anulado_en ? 'Saldo devuelto al cliente por anulación' : 'Saldo del cliente aplicado; sin ingreso nuevo de dinero', clienteNombre: u.cliente?.nombre, documento: u.venta?.numero ?? u.pedido?.numero, creadoEn: u.anulado_en ?? u.creado_en, clienteAcreedor: true, saldoFavorAplicadoBs: num(u.monto), fueraDeArqueo: false }
  })
  return [...cashMovements, ...balanceMovements].sort((a,b) => new Date(b.creadoEn).getTime() - new Date(a.creadoEn).getTime()).slice(0,500)
}

export async function getSesionAbierta(cajaId: number = CAJA_ID): Promise<TurnoSesion | null> {
  const { data, error } = await supabase.from('sesion_caja').select(SESION_SELECT).eq('caja_id', cajaId).eq('estado', 'ABIERTA').maybeSingle()
  if (error) throw toError(error)
  return data ? rowToSesion(data as unknown as SesionRow) : null
}

// Brief B2: "Recibís la caja de <nombre>. Contá el efectivo." — el relevo nombra a
// quien entrega, NUNCA el monto (eso es lo que el conteo ciego prohíbe). Por eso esta
// lectura trae abierta_por/cerrada_por y nada de dinero.
export async function getUltimaSesionCerrada(cajaId: number = CAJA_ID): Promise<{ entregadoPor: string } | null> {
  const { data, error } = await supabase
    .from('sesion_caja')
    .select('abierta_por, cerrada_por')
    .eq('caja_id', cajaId)
    .in('estado', ['CERRADA', 'EN_REVISION'])
    .order('cerrada_en', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw toError(error)
  if (!data) return null
  const row = data as { abierta_por: string | null; cerrada_por: string | null }
  const entregadoPor = row.cerrada_por ?? row.abierta_por
  return entregadoPor ? { entregadoPor } : null
}

export async function abrirTurno(denominaciones: Denominaciones, cajaId: number = CAJA_ID): Promise<{ sesionId: string }> {
  const { data, error } = await supabase.rpc('abrir_turno', { p_caja_id: cajaId, p_denominaciones: denominaciones })
  if (error) throw toError(error)
  return { sesionId: String((data as { sesion_id: number }).sesion_id) }
}

export async function registrarMovimientoTurno(input: { sesionId: string; subtipo: 'GASTO' | 'REMESA' | 'INYECCION'; montoBs: number; motivo: string; comprobantePath?: string; idempotencyKey?: string }): Promise<{ movimientoId: string; gastoId?: string }> {
  const { data, error } = await supabase.rpc('registrar_movimiento_turno', {
    p_sesion_id: Number(input.sesionId),
    p_subtipo: input.subtipo,
    p_monto: input.montoBs,
    p_motivo: input.motivo,
    p_comprobante_path: input.comprobantePath ?? null,
    p_idempotencia: input.idempotencyKey ?? null,
  })
  if (error) throw toError(error)
  const result = data as { movimiento_id: number; gasto_id: number | null }
  return { movimientoId: String(result.movimiento_id), gastoId: result.gasto_id != null ? String(result.gasto_id) : undefined }
}

// Gerente/admin: saca (o devuelve) del arqueo un cobro ANTICIPO + EFECTIVO de un turno ABIERTO
// — plata que recibió gerencia directamente y nunca entró al cajón.
export async function marcarCobroFueraDeArqueo(movimientoId: string, fuera: boolean = true): Promise<void> {
  const { error } = await supabase.rpc('marcar_cobro_fuera_de_arqueo', { p_movimiento_id: Number(movimientoId), p_fuera: fuera })
  if (error) throw toError(error)
}

export async function resolverGasto(gastoId: string, aprobar: boolean, nota?: string): Promise<void> {
  const { error } = await supabase.rpc('resolver_gasto', { p_gasto_id: Number(gastoId), p_aprobar: aprobar, p_nota: nota ?? null })
  if (error) throw toError(error)
}

export interface CierreTurnoResultado { sesionId: string; estado: TurnoEstado; esperadoBs?: number; contadoBs?: number; diferenciaBs?: number }

// cajonVacio (2026-10-03_caja_cobro_vtd_obligatorio.sql): la RPC rechaza un conteo en cero cuando
// el sistema espera efectivo, salvo que el cajero declare explícitamente "el cajón está en cero".
// Solo se envía cuando está marcado: sin marcar, el parámetro queda en su default (false).
export async function cerrarTurno(sesionId: string, denominaciones: Denominaciones, cajonVacio: boolean = false): Promise<CierreTurnoResultado> {
  const { data, error } = await supabase.rpc('cerrar_turno', { p_sesion_id: Number(sesionId), p_denominaciones: denominaciones, ...(cajonVacio ? { p_cajon_vacio: true } : {}) })
  if (error) throw toError(error)
  const result = data as { sesion_id: number; estado: TurnoEstado; esperado?: number | string; contado?: number | string; diferencia?: number | string }
  return {
    sesionId: String(result.sesion_id),
    estado: result.estado,
    esperadoBs: result.esperado != null ? num(result.esperado) : undefined,
    contadoBs: result.contado != null ? num(result.contado) : undefined,
    diferenciaBs: result.diferencia != null ? num(result.diferencia) : undefined,
  }
}

export async function revisarTurno(sesionId: string, nota: string): Promise<void> {
  const { error } = await supabase.rpc('revisar_turno', { p_sesion_id: Number(sesionId), p_nota: nota })
  if (error) throw toError(error)
}

export async function registrarArqueoSorpresa(sesionId: string, denominaciones: Denominaciones): Promise<{ esperadoBs: number; contadoBs: number; diferenciaBs: number }> {
  const { data, error } = await supabase.rpc('registrar_arqueo_sorpresa', { p_sesion_id: Number(sesionId), p_denominaciones: denominaciones })
  if (error) throw toError(error)
  const result = data as { esperado: number | string; contado: number | string; diferencia: number | string }
  return { esperadoBs: num(result.esperado), contadoBs: num(result.contado), diferenciaBs: num(result.diferencia) }
}

export async function getResumenTurno(sesionId: string): Promise<TurnoResumen> {
  const { data, error } = await supabase.rpc('resumen_turno', { p_sesion_id: Number(sesionId) })
  if (error) throw toError(error)
  const r = data as {
    saldo_favor_aplicado?: number | string
    ventas_total?: number | string
    ventas_acreedores?: number
    apertura: number | string
    ventas: Record<string, number | string>
    ventas_retail: Record<string, number | string>
    ventas_vtd: Record<string, number | string>
    cantidad_vtd_cobradas: number
    vtd_por_cobrar: { cantidad: number; total: number | string } | null
    anticipos: Record<string, number | string>
    anulaciones: Record<string, number | string>
    gastos: Record<string, number | string>
    remesas: number | string
    inyecciones: number | string
    cantidad_ventas: number
    pagos_pendientes_verificacion: number
    pagos_rechazados: { venta_id: number; numero: string | null; metodo: string; monto: number | string }[]
    diferencia_relevo: number | string | null
    esperado_efectivo: number | string | null
    cobros_fuera_arqueo?: number | string | null
  }
  const mapAmounts = (obj: Record<string, number | string>): Record<string, number> =>
    Object.fromEntries(Object.entries(obj ?? {}).map(([k, v]) => [k, num(v)]))
  return {
    aperturaBs: num(r.apertura),
    saldoFavorAplicadoBs: num(r.saldo_favor_aplicado),
    ventasTotalBs: r.ventas_total != null ? num(r.ventas_total) : undefined,
    ventasAcreedorCantidad: r.ventas_acreedores ?? 0,
    ventasPorMetodo: mapAmounts(r.ventas),
    ventasRetailPorMetodo: mapAmounts(r.ventas_retail),
    ventasVtdPorMetodo: mapAmounts(r.ventas_vtd),
    cantidadVtdCobradas: r.cantidad_vtd_cobradas ?? 0,
    vtdPorCobrar: { cantidad: r.vtd_por_cobrar?.cantidad ?? 0, totalBs: num(r.vtd_por_cobrar?.total) },
    cobrosFueraArqueoBs: num(r.cobros_fuera_arqueo),
    anticiposPorMetodo: mapAmounts(r.anticipos),
    anulacionesPorMetodo: mapAmounts(r.anulaciones),
    gastosPorEstado: mapAmounts(r.gastos),
    remesasBs: num(r.remesas),
    inyeccionesBs: num(r.inyecciones),
    cantidadVentas: r.cantidad_ventas ?? 0,
    pagosPendientesVerificacion: r.pagos_pendientes_verificacion ?? 0,
    pagosRechazados: (r.pagos_rechazados ?? []).map((p) => ({ ventaId: String(p.venta_id), numero: p.numero, metodo: p.metodo, montoBs: num(p.monto) })),
    diferenciaRelevoBs: r.diferencia_relevo != null ? num(r.diferencia_relevo) : null,
    esperadoEfectivoBs: r.esperado_efectivo != null ? num(r.esperado_efectivo) : null,
  }
}

export async function faltantesResolver(faltanteId: string, estado: 'REPUESTO' | 'CONDONADO', nota: string): Promise<void> {
  const { error } = await supabase.rpc('faltantes_resolver', { p_faltante_id: Number(faltanteId), p_estado: estado, p_nota: nota })
  if (error) throw toError(error)
}

// ── Lecturas directas (listas de apoyo para Supervisión y "Mis tickets") ───────────

// Brief Caja VTD: "el turno de los tickets" es dónde se COBRÓ, no dónde se creó. Para VTA
// (registrar_venta) ambas sesiones son la misma, así que el comportamiento de siempre no
// cambia; para VTD postcobrado, la venta pudo abrirse en un turno anterior y cobrarse
// recién en este — movimiento_caja(tipo=VENTA) es lo único que registra ESE momento (ver
// _registrar_venta_nucleo y cobrar_vtd, ambos insertan ahí en la misma transacción del
// cobro). Un VTD abierto en este turno pero todavía sin cobrar nunca aparece acá.
export async function misTickets(sesionId: string): Promise<TurnoTicket[]> {
  const { data: movimientos, error: movError } = await supabase.from('movimiento_caja').select('venta_id').eq('sesion_caja_id', Number(sesionId)).eq('tipo', 'VENTA')
  if (movError) throw toError(movError)
  const { data: saldoUsos, error: saldoUsosError } = await supabase.from('saldo_cliente_uso').select('venta_id').eq('sesion_caja_id', Number(sesionId)).is('anulado_en', null)
  if (saldoUsosError) throw toError(saldoUsosError)
  const ids = Array.from(new Set(([...(movimientos ?? []), ...(saldoUsos ?? [])] as { venta_id: number | null }[]).map((m) => m.venta_id).filter((id): id is number => id != null)))
  if (!ids.length) return []
  // Brief: sin filtro por estado COMPLETADA — un VTD cobrado puede seguir ABIERTA (sin
  // entregar) y debe aparecer igual; solo se excluye una venta anulada después del cobro.
  const { data: ventas, error } = await supabase.from('venta').select('id, numero, total, creado_en, cliente_acreedor, saldo_favor_aplicado, cliente(nombre)').in('id', ids).neq('estado', 'ANULADA').order('creado_en', { ascending: false })
  if (error) throw toError(error)
  const rows = (ventas ?? []) as unknown as { id: number; numero: string | null; total: number | string; creado_en: string; cliente_acreedor?: boolean; saldo_favor_aplicado?: number | string; cliente?: { nombre: string } | null }[]
  const { data: pagos, error: pagosError } = await supabase.from('venta_pago').select('venta_id, metodo, monto, estado_verificacion').in('venta_id', ids)
  if (pagosError) throw toError(pagosError)
  const pagosRows = (pagos ?? []) as { venta_id: number; metodo: string; monto: number | string; estado_verificacion: string }[]
  return rows.map((v) => ({
    ventaId: String(v.id),
    numero: v.numero,
    totalBs: num(v.total),
    clienteAcreedor: v.cliente_acreedor === true,
    saldoFavorAplicadoBs: num(v.saldo_favor_aplicado),
    clienteNombre: v.cliente?.nombre,
    creadoEn: v.creado_en,
    metodos: [...(num(v.saldo_favor_aplicado) > 0 ? [{ metodo: 'SALDO_FAVOR', montoBs: num(v.saldo_favor_aplicado), estadoVerificacion: 'NO_APLICA' }] : []), ...pagosRows.filter((p) => p.venta_id === v.id).map((p) => ({ metodo: p.metodo, montoBs: num(p.monto), estadoVerificacion: p.estado_verificacion }))],
  }))
}

export async function listGastosPendientes(): Promise<CajaGastoRecord[]> {
  const { data, error } = await supabase.from('caja_gasto').select('*').eq('estado', 'PENDIENTE').order('registrado_en', { ascending: true })
  if (error) throw toError(error)
  return ((data ?? []) as Array<Record<string, unknown>>).map(rowToGasto)
}

function rowToGasto(row: Record<string, unknown>): CajaGastoRecord {
  return {
    id: String(row.id),
    sesionCajaId: row.sesion_caja_id != null ? String(row.sesion_caja_id) : undefined,
    montoBs: num(row.monto as number | string),
    motivo: String(row.motivo ?? ''),
    comprobantePath: (row.comprobante_path as string | null) ?? undefined,
    estado: row.estado as CajaGastoRecord['estado'],
    registradoPor: (row.registrado_por as string | null) ?? undefined,
    registradoEn: String(row.registrado_en),
    resueltoPor: (row.resuelto_por as string | null) ?? undefined,
    resueltoEn: (row.resuelto_en as string | null) ?? undefined,
    notaResolucion: (row.nota_resolucion as string | null) ?? undefined,
  }
}

export async function listTurnosEnRevision(): Promise<TurnoSesion[]> {
  const { data, error } = await supabase.from('sesion_caja').select(SESION_SELECT).eq('estado', 'EN_REVISION').order('cerrada_en', { ascending: true })
  if (error) throw toError(error)
  return ((data ?? []) as unknown as SesionRow[]).map(rowToSesion)
}

export async function listFaltantesPendientes(): Promise<CajaFaltanteRecord[]> {
  const { data, error } = await supabase.from('caja_faltante').select('*').eq('estado', 'PENDIENTE').order('creado_en', { ascending: true })
  if (error) throw toError(error)
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    sesionCajaId: String(row.sesion_caja_id),
    cajeroId: (row.cajero_id as string | null) ?? undefined,
    origen: row.origen as CajaFaltanteRecord['origen'],
    montoBs: num(row.monto as number | string),
    estado: row.estado as CajaFaltanteRecord['estado'],
    creadoEn: String(row.creado_en),
  }))
}

export async function getComprobanteUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('caja-comprobantes').createSignedUrl(path, 60 * 10)
  if (error) return null
  return data?.signedUrl ?? null
}

export async function subirComprobante(sesionId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop() || 'jpg'
  const path = `${sesionId}/${createUuid()}.${ext}`
  const { error } = await supabase.storage.from('caja-comprobantes').upload(path, file, { upsert: true })
  if (error) throw toError(error)
  return path
}

// ── Brief Caja-2 — fuentes externas: verificación de pagos QR/transferencia ────────

export async function estadoBancoQr(): Promise<EstadoBancoQr> {
  const { data, error } = await supabase.rpc('estado_banco_qr')
  if (error) throw toError(error)
  const r = data as { ultimo_latido: string | null; minutos_desde: number | string | null; en_linea: boolean }
  return { ultimoLatido: r.ultimo_latido, minutosDesde: r.minutos_desde != null ? num(r.minutos_desde) : null, enLinea: r.en_linea }
}

// Brief Caja-2 B1: poll de PaymentModal mientras espera la confirmación del banco —
// una sola fila porque la venta recién cobrada tiene, como mucho, un pago QR.
export async function getEstadoPagoQr(ventaId: string): Promise<string | null> {
  const { data, error } = await supabase.from('venta_pago').select('estado_verificacion').eq('venta_id', Number(ventaId)).eq('metodo', 'QR')
  if (error) throw toError(error)
  const pagos = (data ?? []) as { estado_verificacion: string }[]
  return pagos.some(p => p.estado_verificacion === 'RECHAZADO') ? 'RECHAZADO' : pagos.some(p => p.estado_verificacion !== 'VERIFICADO') ? 'PENDIENTE' : pagos.length ? 'VERIFICADO' : 'NO_APLICA'
}

// Brief Caja-2 B2 — columna izquierda de Supervisión: pagos PENDIENTE de turnos
// abiertos o EN_REVISION (los turnos ya CERRADOS sin diferencia no interesan acá).
// Dos pasos (sesiones relevantes, después pagos) en vez de un filtro anidado de
// PostgREST de dos niveles — mismo patrón que misTickets, más fácil de leer y de
// mockear en tests que un `.in('venta.sesion_caja.estado', ...)`.
export async function listPagosPorVerificar(): Promise<PagoPorVerificar[]> {
  const { data: sesiones, error: sesionesError } = await supabase.from('sesion_caja').select('id').in('estado', ['ABIERTA', 'EN_REVISION'])
  if (sesionesError) throw toError(sesionesError)
  const sesionIds = ((sesiones ?? []) as { id: number }[]).map((s) => s.id)
  if (!sesionIds.length) return []

  const { data: ventas, error: ventasError } = await supabase.from('venta').select('id, numero').in('sesion_caja_id', sesionIds)
  if (ventasError) throw toError(ventasError)
  const ventaRows = (ventas ?? []) as { id: number; numero: string | null }[]
  const ventaIds = ventaRows.map((v) => v.id)
  if (!ventaIds.length) return []
  const numeroPorVenta = new Map(ventaRows.map((v) => [v.id, v.numero]))

  const { data: pagos, error: pagosError } = await supabase
    .from('venta_pago')
    .select('id, venta_id, metodo, monto, creado_en')
    .eq('estado_verificacion', 'PENDIENTE')
    .in('venta_id', ventaIds)
    .order('creado_en', { ascending: true })
  if (pagosError) throw toError(pagosError)
  type Row = { id: number; venta_id: number; metodo: string; monto: number | string; creado_en: string }
  return ((pagos ?? []) as Row[]).map((r) => ({
    ventaPagoId: String(r.id),
    ventaId: String(r.venta_id),
    numero: numeroPorVenta.get(r.venta_id) ?? null,
    metodo: r.metodo as 'QR' | 'TRANSFERENCIA',
    montoBs: num(r.monto),
    creadoEn: r.creado_en,
  }))
}

// Brief Caja-2 B2 — columna derecha de Supervisión: movimientos bancarios de las
// últimas 48h que todavía no calzaron con ningún pago.
export async function listMovimientosBancoSinVincular(): Promise<MovimientoBancoQr[]> {
  const desde = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('banco_qr_movimiento')
    .select('id, banco_id, importe, fecha_transaccion')
    .is('venta_pago_id', null)
    .gte('fecha_transaccion', desde)
    .order('fecha_transaccion', { ascending: false })
  if (error) throw toError(error)
  type Row = { id: number; banco_id: string; importe: number | string; fecha_transaccion: string }
  return ((data ?? []) as Row[]).map((r) => ({ id: String(r.id), bancoId: r.banco_id, importeBs: num(r.importe), fechaTransaccion: r.fecha_transaccion }))
}

export async function vincularPagoQr(ventaPagoId: string, bancoMovId: string): Promise<void> {
  const { error } = await supabase.rpc('vincular_pago_qr', { p_venta_pago_id: Number(ventaPagoId), p_banco_mov_id: Number(bancoMovId) })
  if (error) throw toError(error)
}

export async function verificarPagoManual(ventaPagoId: string, referencia: string | null, aprobar: boolean): Promise<void> {
  const { error } = await supabase.rpc('verificar_pago_manual', { p_venta_pago_id: Number(ventaPagoId), p_referencia: referencia, p_aprobar: aprobar })
  if (error) throw toError(error)
}
