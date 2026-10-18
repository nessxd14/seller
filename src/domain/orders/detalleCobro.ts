// Contrato JSON de la lectura compartida por Seller y Conciliador.
export interface ActorCobro {
  id: string | null; nombre: string; rol: string | null; rol_actual: string | null; historico: boolean; identificador?: string | null
}
export interface TurnoCobro { id: number; caja: string | null; caja_id: number | null; responsable: ActorCobro }
export interface AplicacionCobro { partida_id: number; monto: number | string }
export interface PartidaCobro {
  id: number; documento: string; referencia: string | null; estado: string; entrega_numero: number | null; parent_id: number | null;
  total: number | string; aplicado: number | string; en_revision: number | string; pendiente: number | string;
  saldada: boolean; saldada_en: string | null; fecha_saldado_fuente: 'AUDITADA' | 'NO_REGISTRADA'
}
export interface PagoCobro {
  id: number; medio: string; monto: number | string; estado: string; fecha_recepcion: string; creado_en: string;
  referencia: string | null; cobrado_por: ActorCobro; verificado_por: ActorCobro | null; verificado_en: string | null;
  turno: TurnoCobro | null; devuelto: number | string; aplicado_pedido: number | string; aplicaciones: AplicacionCobro[]
}
export interface SaldoCobro {
  id: number; monto: number | string; creado_en: string; anulado_en: string | null; motivo: string | null;
  aplicado_por: ActorCobro; turno: TurnoCobro | null; aplicaciones: AplicacionCobro[]
}
export interface EventoCobro {
  id: number; accion: string; creado_en: string; actor: ActorCobro; pago_id: number | null; partida_id: number | null;
  uso_id: number | null; antes: Record<string, unknown> | null; despues: Record<string, unknown> | null
}
export interface DetalleCobro {
  pedido: { id: number; numero: string; estado: string; total: number | string } | null;
  partida_enfocada: number | null; resumen: { vigentes: number; saldadas: number; anuladas: number };
  partidas: PartidaCobro[]; pagos: PagoCobro[]; saldos: SaldoCobro[]; historial: EventoCobro[];
  historial_total: number; siguiente: number | null; captura_desde: string | null
}

const registro = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Detalle incompleto')
  return value as Record<string, unknown>
}
const numero = (value: unknown) => {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '' || !Number.isFinite(Number(value))) throw new Error('Importe incompleto')
  return Number(value)
}
export function leerDetalleCobro(value: unknown): DetalleCobro {
  const root = registro(value), resumen = registro(root.resumen)
  for (const key of ['partidas', 'pagos', 'saldos', 'historial']) if (!Array.isArray(root[key])) throw new Error('Detalle incompleto')
  const partidas = root.partidas as unknown[]
  for (const p of partidas) {
    const row = registro(p)
    for (const key of ['total', 'aplicado', 'en_revision', 'pendiente']) numero(row[key])
    if (typeof row.saldada !== 'boolean' || !Number.isSafeInteger(row.id) || Number(row.total) <= 0) throw new Error('Partida inválida')
    if (row.saldada && (row.estado === 'ANULADA' || numero(row.pendiente) !== 0 || numero(row.en_revision) !== 0)) throw new Error('Partida saldada inconsistente')
    if (row.fecha_saldado_fuente === 'AUDITADA' && (!row.saldada || typeof row.saldada_en !== 'string' || !Number.isFinite(Date.parse(row.saldada_en)))) throw new Error('Fecha de saldado inválida')
  }
  for (const key of ['vigentes', 'saldadas', 'anuladas']) if (!Number.isSafeInteger(resumen[key]) || Number(resumen[key]) < 0) throw new Error('Conteo incompleto')
  if (resumen.vigentes !== partidas.filter(p => registro(p).estado !== 'ANULADA').length || resumen.saldadas !== partidas.filter(p => registro(p).saldada).length) throw new Error('Conteo inconsistente')
  for (const p of root.pagos as unknown[]) {
    const row = registro(p)
    for (const key of ['monto', 'aplicado_pedido', 'devuelto']) numero(row[key])
    if (!Array.isArray(row.aplicaciones) || typeof registro(row.cobrado_por).nombre !== 'string') throw new Error('Pago incompleto')
  }
  for (const s of root.saldos as unknown[]) {
    const row = registro(s); numero(row.monto)
    if (!Array.isArray(row.aplicaciones) || typeof registro(row.aplicado_por).nombre !== 'string') throw new Error('Aplicación de saldo incompleta')
  }
  for (const event of root.historial as unknown[]) {
    const row = registro(event)
    if (!Number.isSafeInteger(row.id) || Number(row.id) <= 0 || typeof row.accion !== 'string' || typeof row.creado_en !== 'string' || typeof registro(row.actor).nombre !== 'string') throw new Error('Evento incompleto')
  }
  if (!Number.isSafeInteger(root.historial_total) || Number(root.historial_total) < 0 || (root.siguiente !== null && (!Number.isSafeInteger(root.siguiente) || Number(root.siguiente) <= 0))) throw new Error('Historial incompleto')
  return value as DetalleCobro
}

const roles: Record<string, string> = { cajero: 'Cajero', caja: 'Caja', admin: 'Administrador', gerente: 'Gerente', vendedor: 'Vendedor', vendedor_mayoreo: 'Vendedor de mayoreo', supervisor: 'Supervisor' }
export function rolActor(actor: ActorCobro) {
  if (actor.rol) return roles[actor.rol] ?? actor.rol
  if (actor.historico && actor.rol_actual) return `Rol actual: ${roles[actor.rol_actual] ?? actor.rol_actual} · rol histórico no registrado`
  return 'Rol no registrado'
}
export function dineroCobro(value: number | string) { const n = Number(value); return Number.isFinite(n) ? `Bs ${n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Importe no disponible' }
export function fechaCobro(value: string | null, soloDia = false) {
  if (!value) return 'Fecha no registrada'
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00-04:00` : value)
  return Number.isFinite(d.getTime()) ? d.toLocaleString('es-BO', { timeZone: 'America/La_Paz', dateStyle: 'medium', ...(soloDia ? {} : { timeStyle: 'short' }) }) : 'Fecha no registrada'
}
const acciones: Record<string, string> = {
  COBRO_REGISTRADO: 'Dinero registrado en Caja', PAGO_REGISTRADO: 'Pago registrado en Conciliador', PAGO_CONFIRMADO: 'Pago confirmado', PAGO_ACREDITADO: 'Pago acreditado',
  PAGO_RECHAZADO: 'Pago rechazado', PAGO_ANULADO: 'Pago anulado', PAGO_ACTUALIZADO: 'Datos del pago actualizados',
  APLICACION_CREADA: 'Pago asignado a partida', APLICACION_RETIRADA: 'Aplicación de pago retirada', APLICACION_MODIFICADA: 'Reparto del pago modificado', APLICACION_REASIGNADA_DESDE: 'Pago reasignado desde esta partida',
  SALDO_APLICADO: 'Saldo a favor aplicado', SALDO_REVERTIDO: 'Uso de saldo a favor revertido', SALDO_APLICACION_CREADA: 'Saldo asignado a partida',
  SALDO_APLICACION_RETIRADA: 'Aplicación de saldo retirada', SALDO_APLICACION_MODIFICADA: 'Aplicación de saldo modificada',
  PARTIDA_CREADA: 'Partida abierta', PARTIDA_ACTUALIZADA: 'Partida actualizada', PARTIDA_SALDADA: 'Partida saldada', PARTIDA_REABIERTA: 'Partida con saldo pendiente nuevamente',
}
export const nombreEventoCobro = (value: string) => acciones[value] ?? value.replaceAll('_', ' ')
