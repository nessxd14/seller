// Brief Caja-1 — turno de cajero. Capa nueva, separada de CashRepository.supabase.ts
// (que sigue existiendo tal cual para no romper el mock ni el resto del POS): llama
// directo a las RPCs de db/migrations/2026-09-27_caja_turno_cajero.sql. Ver
// featureFlags.supabase en CashPage.tsx — este repositorio solo se usa ahí.
import { supabase } from './supabaseClient'
import type { CajaFaltanteRecord, CajaGastoRecord, Denominaciones, EstadoBancoQr, MovimientoBancoQr, PagoPorVerificar, TurnoEstado, TurnoResumen, TurnoSesion, TurnoTicket } from '../../application/shared/models'

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

export async function getSesionAbierta(cajaId: number = CAJA_ID): Promise<TurnoSesion | null> {
  const { data, error } = await supabase.from('sesion_caja').select(SESION_SELECT).eq('caja_id', cajaId).eq('estado', 'ABIERTA').maybeSingle()
  if (error) throw error
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
  if (error) throw error
  if (!data) return null
  const row = data as { abierta_por: string | null; cerrada_por: string | null }
  const entregadoPor = row.cerrada_por ?? row.abierta_por
  return entregadoPor ? { entregadoPor } : null
}

export async function abrirTurno(denominaciones: Denominaciones, cajaId: number = CAJA_ID): Promise<{ sesionId: string }> {
  const { data, error } = await supabase.rpc('abrir_turno', { p_caja_id: cajaId, p_denominaciones: denominaciones })
  if (error) throw error
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
  if (error) throw error
  const result = data as { movimiento_id: number; gasto_id: number | null }
  return { movimientoId: String(result.movimiento_id), gastoId: result.gasto_id != null ? String(result.gasto_id) : undefined }
}

export async function resolverGasto(gastoId: string, aprobar: boolean, nota?: string): Promise<void> {
  const { error } = await supabase.rpc('resolver_gasto', { p_gasto_id: Number(gastoId), p_aprobar: aprobar, p_nota: nota ?? null })
  if (error) throw error
}

export interface CierreTurnoResultado { sesionId: string; estado: TurnoEstado; esperadoBs?: number; contadoBs?: number; diferenciaBs?: number }

export async function cerrarTurno(sesionId: string, denominaciones: Denominaciones): Promise<CierreTurnoResultado> {
  const { data, error } = await supabase.rpc('cerrar_turno', { p_sesion_id: Number(sesionId), p_denominaciones: denominaciones })
  if (error) throw error
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
  if (error) throw error
}

export async function registrarArqueoSorpresa(sesionId: string, denominaciones: Denominaciones): Promise<{ esperadoBs: number; contadoBs: number; diferenciaBs: number }> {
  const { data, error } = await supabase.rpc('registrar_arqueo_sorpresa', { p_sesion_id: Number(sesionId), p_denominaciones: denominaciones })
  if (error) throw error
  const result = data as { esperado: number | string; contado: number | string; diferencia: number | string }
  return { esperadoBs: num(result.esperado), contadoBs: num(result.contado), diferenciaBs: num(result.diferencia) }
}

export async function getResumenTurno(sesionId: string): Promise<TurnoResumen> {
  const { data, error } = await supabase.rpc('resumen_turno', { p_sesion_id: Number(sesionId) })
  if (error) throw error
  const r = data as {
    apertura: number | string
    ventas: Record<string, number | string>
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
  }
  const mapAmounts = (obj: Record<string, number | string>): Record<string, number> =>
    Object.fromEntries(Object.entries(obj ?? {}).map(([k, v]) => [k, num(v)]))
  return {
    aperturaBs: num(r.apertura),
    ventasPorMetodo: mapAmounts(r.ventas),
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
  if (error) throw error
}

// ── Lecturas directas (listas de apoyo para Supervisión y "Mis tickets") ───────────

export async function misTickets(sesionId: string): Promise<TurnoTicket[]> {
  const { data: ventas, error } = await supabase.from('venta').select('id, numero, total, creado_en').eq('sesion_caja_id', Number(sesionId)).eq('estado', 'COMPLETADA').order('creado_en', { ascending: false })
  if (error) throw error
  const rows = (ventas ?? []) as { id: number; numero: string | null; total: number | string; creado_en: string }[]
  const ids = rows.map((r) => r.id)
  if (!ids.length) return []
  const { data: pagos, error: pagosError } = await supabase.from('venta_pago').select('venta_id, metodo, monto, estado_verificacion').in('venta_id', ids)
  if (pagosError) throw pagosError
  const pagosRows = (pagos ?? []) as { venta_id: number; metodo: string; monto: number | string; estado_verificacion: string }[]
  return rows.map((v) => ({
    ventaId: String(v.id),
    numero: v.numero,
    totalBs: num(v.total),
    creadoEn: v.creado_en,
    metodos: pagosRows.filter((p) => p.venta_id === v.id).map((p) => ({ metodo: p.metodo, montoBs: num(p.monto), estadoVerificacion: p.estado_verificacion })),
  }))
}

export async function listGastosPendientes(): Promise<CajaGastoRecord[]> {
  const { data, error } = await supabase.from('caja_gasto').select('*').eq('estado', 'PENDIENTE').order('registrado_en', { ascending: true })
  if (error) throw error
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
  if (error) throw error
  return ((data ?? []) as unknown as SesionRow[]).map(rowToSesion)
}

export async function listFaltantesPendientes(): Promise<CajaFaltanteRecord[]> {
  const { data, error } = await supabase.from('caja_faltante').select('*').eq('estado', 'PENDIENTE').order('creado_en', { ascending: true })
  if (error) throw error
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
  const path = `${sesionId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('caja-comprobantes').upload(path, file, { upsert: true })
  if (error) throw error
  return path
}

// ── Brief Caja-2 — fuentes externas: verificación de pagos QR/transferencia ────────

export async function estadoBancoQr(): Promise<EstadoBancoQr> {
  const { data, error } = await supabase.rpc('estado_banco_qr')
  if (error) throw error
  const r = data as { ultimo_latido: string | null; minutos_desde: number | string | null; en_linea: boolean }
  return { ultimoLatido: r.ultimo_latido, minutosDesde: r.minutos_desde != null ? num(r.minutos_desde) : null, enLinea: r.en_linea }
}

// Brief Caja-2 B1: poll de PaymentModal mientras espera la confirmación del banco —
// una sola fila porque la venta recién cobrada tiene, como mucho, un pago QR.
export async function getEstadoPagoQr(ventaId: string): Promise<string | null> {
  const { data, error } = await supabase.from('venta_pago').select('estado_verificacion').eq('venta_id', Number(ventaId)).eq('metodo', 'QR').maybeSingle()
  if (error) throw error
  return (data as { estado_verificacion: string } | null)?.estado_verificacion ?? null
}

// Brief Caja-2 B2 — columna izquierda de Supervisión: pagos PENDIENTE de turnos
// abiertos o EN_REVISION (los turnos ya CERRADOS sin diferencia no interesan acá).
// Dos pasos (sesiones relevantes, después pagos) en vez de un filtro anidado de
// PostgREST de dos niveles — mismo patrón que misTickets, más fácil de leer y de
// mockear en tests que un `.in('venta.sesion_caja.estado', ...)`.
export async function listPagosPorVerificar(): Promise<PagoPorVerificar[]> {
  const { data: sesiones, error: sesionesError } = await supabase.from('sesion_caja').select('id').in('estado', ['ABIERTA', 'EN_REVISION'])
  if (sesionesError) throw sesionesError
  const sesionIds = ((sesiones ?? []) as { id: number }[]).map((s) => s.id)
  if (!sesionIds.length) return []

  const { data: ventas, error: ventasError } = await supabase.from('venta').select('id, numero').in('sesion_caja_id', sesionIds)
  if (ventasError) throw ventasError
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
  if (pagosError) throw pagosError
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
  if (error) throw error
  type Row = { id: number; banco_id: string; importe: number | string; fecha_transaccion: string }
  return ((data ?? []) as Row[]).map((r) => ({ id: String(r.id), bancoId: r.banco_id, importeBs: num(r.importe), fechaTransaccion: r.fecha_transaccion }))
}

export async function vincularPagoQr(ventaPagoId: string, bancoMovId: string): Promise<void> {
  const { error } = await supabase.rpc('vincular_pago_qr', { p_venta_pago_id: Number(ventaPagoId), p_banco_mov_id: Number(bancoMovId) })
  if (error) throw error
}

export async function verificarPagoManual(ventaPagoId: string, referencia: string | null, aprobar: boolean): Promise<void> {
  const { error } = await supabase.rpc('verificar_pago_manual', { p_venta_pago_id: Number(ventaPagoId), p_referencia: referencia, p_aprobar: aprobar })
  if (error) throw error
}
