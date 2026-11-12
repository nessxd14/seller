// Vista "Pagos" (solo lectura): tipos de la RPC `historial_pagos` y reglas puras de presentación.
import type { MockRole } from '../../application/auth/AuthSessionProvider'
import { hoyLocal, sumarDiasIso } from '../common/fechas'

export type TipoPago = 'PEDIDO' | 'CUENTA' | 'ANTICIPO' | 'SALDO'
export type EstadoPago = 'CONFIRMADO' | 'POR_VERIFICAR' | 'ANULADO'
export type MedioPago = 'EFECTIVO' | 'QR' | 'TRANSFERENCIA' | 'SIGEP' | 'CHEQUE' | 'DEPOSITO'

export interface AplicacionPago { pedidoId: number | null; referencia: string | null; monto: number }

export interface FilaPago {
  clave: string
  clase: 'PAGO' | 'SALDO'
  pagoId: number | null
  fecha: string
  clienteId: number | null
  cliente: string
  tipo: TipoPago
  medio: MedioPago | null
  /** Dinero recibido (0 en SALDO). */
  monto: number
  /** Saldo a favor usado (solo SALDO). */
  usado: number
  /** Lo que ese pago dejó a favor del cliente (anticipo o sobrepago). */
  aFavor: number
  estado: EstadoPago
  referencia: string | null
  /** Solo números de transacción bancaria; es lo único que se imprime. */
  referenciaImpresion: string | null
  motivo: string | null
  motivoDetalle: string | null
  registradoPor: string | null
  confirmadoPor: string | null
  confirmadoEn: string | null
  turnoDe: string | null
  aplicaciones: AplicacionPago[]
}

export interface ResumenPagos { recibido: number; porVerificar: number; aFavor: number; conSaldo: number }

export interface ClienteHistorial {
  sinCuenta: boolean
  clienteId?: number
  nombre?: string
  categoria?: string
  documento?: string | null
  pendienteHoy?: number
  aFavorHoy?: number
  periodo?: { pagos: number; recibido: number; aplicadoPedidos: number; conSaldo: number }
}

export interface HistorialPagos {
  filas: FilaPago[]
  total: number
  /** `null` salvo para admin y gerente (lo impone el servidor). */
  resumen: ResumenPagos | null
  cliente?: ClienteHistorial
}

export interface ParamsHistorialPagos {
  desde: string
  hasta: string
  clienteId?: number
  tipo?: TipoPago
  estado?: EstadoPago
  medio?: MedioPago
  buscar?: string
  soloConfirmados?: boolean
  limite?: number
  offset?: number
}

/** La RPC respondió 42501: el rol no puede consultar pagos. */
export class SinAccesoPagosError extends Error {
  constructor(message = 'Sin acceso a los pagos') { super(message); this.name = 'SinAccesoPagosError' }
}

export const ROLES_LECTORES_PAGOS: readonly MockRole[] = ['admin', 'gerente', 'cajero', 'vendedor_mayoreo']
export const puedeVerPagos = (role: MockRole | undefined): boolean => !!role && ROLES_LECTORES_PAGOS.includes(role)

export const TIPOS_PAGO: readonly TipoPago[] = ['PEDIDO', 'CUENTA', 'ANTICIPO', 'SALDO']
export const tipoPagoLabel: Record<TipoPago, string> = { PEDIDO: 'Pago a pedido', CUENTA: 'Pago a cuenta', ANTICIPO: 'Anticipo', SALDO: 'Aplicación de saldo' }
export const tipoPagoAyuda: Record<TipoPago, string> = {
  PEDIDO: 'El cliente indicó qué pedido paga. El dinero se aplica solo a ese pedido.',
  CUENTA: 'El cliente paga un monto sin indicar pedido. Se cubren sus pedidos del más antiguo al más nuevo.',
  ANTICIPO: 'Dinero que el cliente deja a favor sin pagar ningún pedido. Si tenía pedidos pendientes, lleva un motivo.',
  SALDO: 'No entra dinero: se usa el saldo a favor que el cliente ya tenía para pagar sus pedidos.',
}
export const estadoPagoLabel: Record<EstadoPago, string> = { CONFIRMADO: 'Confirmado', POR_VERIFICAR: 'Por verificar', ANULADO: 'Anulado' }
export const medioPagoLabel: Record<MedioPago, string> = { EFECTIVO: 'Efectivo', QR: 'QR', TRANSFERENCIA: 'Transferencia', SIGEP: 'SIGEP', CHEQUE: 'Cheque', DEPOSITO: 'Depósito' }
export const MEDIOS_PAGO: readonly MedioPago[] = ['EFECTIVO', 'QR', 'TRANSFERENCIA', 'SIGEP', 'CHEQUE', 'DEPOSITO']

export const MOTIVO_ANTICIPO_LABEL: Record<string, string> = {
  ADELANTO_PEDIDO_FUTURO: 'Paga por adelantado un pedido que aún no se crea',
  NO_ES_PARA_PENDIENTES: 'El cliente indicó que no es para los pedidos pendientes',
  GARANTIA_RESERVA: 'Garantía o reserva acordada con gerencia',
  OTRO: 'Otro',
}
export const SIN_MOTIVO_ANTICIPO = 'Sin motivo · registrado antes de la regla'

export const textoMotivoAnticipo = (fila: Pick<FilaPago, 'motivo' | 'motivoDetalle'>): string => {
  if (!fila.motivo) return SIN_MOTIVO_ANTICIPO
  const base = MOTIVO_ANTICIPO_LABEL[fila.motivo] ?? fila.motivo
  return fila.motivoDetalle ? `${base}: ${fila.motivoDetalle}` : base
}

/** Fecha de hoy (YYYY-MM-DD) en la zona del negocio. */
export const hoyLaPaz = (): string => hoyLocal()

/** Lista general: hoy y los 2 días anteriores. */
export const rangoPorDefectoLista = (hoy: string = hoyLaPaz()) => ({ desde: sumarDiasIso(hoy, -2), hasta: hoy })
/** Historial del cliente: del día 1 del mes anterior a hoy. */
export const rangoPorDefectoHistorial = (hoy: string = hoyLaPaz()) => {
  const [y, m] = hoy.split('-').map(Number)
  const [anio, mes] = m === 1 ? [y - 1, 12] : [y, m - 1]
  return { desde: `${anio}-${String(mes).padStart(2, '0')}-01`, hasta: hoy }
}

export const fechaHoraPago = (iso: string): { fecha: string; hora: string } => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { fecha: '', hora: '' }
  return {
    fecha: d.toLocaleDateString('es-BO', { timeZone: 'America/La_Paz', day: '2-digit', month: '2-digit', year: 'numeric' }),
    hora: d.toLocaleTimeString('es-BO', { timeZone: 'America/La_Paz', hour: '2-digit', minute: '2-digit', hour12: false }),
  }
}
export const fechaIsoCorta = (iso: string): string => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? `${m[3]}/${m[2]}/${m[1]}` : iso }

export const pedidosAplicados = (fila: Pick<FilaPago, 'aplicaciones'>): string =>
  fila.aplicaciones.map(a => a.referencia ?? (a.pedidoId != null ? `Pedido ${a.pedidoId}` : 'Saldo anterior')).join(', ')

/** Dinero recibido que se muestra: SALDO nunca trae dinero nuevo. */
export const montoRecibido = (fila: Pick<FilaPago, 'clase' | 'monto'>): number => fila.clase === 'SALDO' ? 0 : fila.monto

/** Solo cuentan los pagos confirmados; SALDO no recibe dinero. */
export const totalRecibidoConfirmado = (filas: readonly FilaPago[]): number =>
  Math.round(filas.filter(f => f.clase === 'PAGO' && f.estado === 'CONFIRMADO').reduce((s, f) => s + f.monto, 0) * 100) / 100
export const totalConSaldo = (filas: readonly FilaPago[]): number =>
  Math.round(filas.filter(f => f.clase === 'SALDO').reduce((s, f) => s + f.usado, 0) * 100) / 100

export const rangoValido = (desde: string, hasta: string): string | null => {
  if (!desde || !hasta) return 'Elige las dos fechas.'
  if (hasta < desde) return 'La fecha final no puede ser anterior a la inicial.'
  const dias = (Date.parse(hasta) - Date.parse(desde)) / 86_400_000
  return dias > 370 ? 'El rango máximo es de un año.' : null
}
