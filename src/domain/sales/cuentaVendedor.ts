// Mis ventas (reponedor / vendedor): períodos y etiquetas de la cuenta. Lógica pura.
import type { MiCuentaPedido, PedidoVendedorLinea } from '../../application/shared/models'
import { sumarDiasIso } from '../common/fechas'

export type PeriodoCuenta = 'hoy' | 'semana' | 'mes'

/** Hoy = el día; Semana = últimos 7 días contando hoy; Mes = del 1.º del mes calendario hasta hoy. `hoy` es YYYY-MM-DD de La Paz. */
export const rangoPeriodo = (periodo: PeriodoCuenta, hoy: string): { desde: string; hasta: string } => {
  if (periodo === 'semana') return { desde: sumarDiasIso(hoy, -6), hasta: hoy }
  if (periodo === 'mes') return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy }
  return { desde: hoy, hasta: hoy }
}

export const CIERRE_DIA = 'CIERRE_DIA'

export const etiquetaEstadoVenta = (p: Pick<MiCuentaPedido, 'estado' | 'anuladoOrigen'>): string => {
  switch (p.estado) {
    case 'ARMANDO': return 'Guardada'
    case 'ENVIADO':
    case 'EN_CAJA': return 'En caja'
    case 'COBRADO': return 'Cobrada'
    default: return p.anuladoOrigen === CIERRE_DIA ? 'Se cerró sola' : 'Anulada por caja'
  }
}

/** La RPC todavía no existe en la base (migración sin aplicar). */
export const rpcNoDisponible = (error: unknown): boolean => {
  const e = error as { message?: unknown; code?: unknown } | null
  const message = typeof e?.message === 'string' ? e.message : ''
  return e?.code === '42883' || e?.code === 'PGRST202' || /does not exist|could not find the function|no existe/i.test(message)
}

const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100

/** Suma de lo que el vendedor anotó y caja cobró, al precio final de caja (sin lo que caja agregó). */
export const parteCobrada = (lineas: PedidoVendedorLinea[]): number =>
  round2(lineas.filter((l) => l.resultado === 'COBRADA').reduce((sum, l) => sum + (l.precioFinal ?? 0) * (l.cantidadFinal ?? l.cantidad), 0))
