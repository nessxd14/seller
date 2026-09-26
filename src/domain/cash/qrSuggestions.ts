// Brief Caja-2 B2 — "Sugerencias" para cada pago QR pendiente en Supervisión: la misma
// regla tolerante que usaba Caja ROARI (a diferencia del match automático estricto de
// conciliar_pagos_qr en la base, que corre solo). Pura función de dominio (sin red, sin
// fecha "ahora" implícita) para poder testear el ranking sin mockear Supabase.

export interface PagoPendienteQr {
  ventaPagoId: string
  montoBs: number
  creadoEn: string
}

export interface MovimientoSinVincular {
  id: string
  importeBs: number
  fechaTransaccion: string
}

export interface CandidatoQr {
  movimiento: MovimientoSinVincular
  diferenciaBs: number
  diferenciaMinutos: number
}

export interface SugerenciaQr {
  pago: PagoPendienteQr
  candidatos: CandidatoQr[]
  fuerza: 'fuerte' | 'debil' | 'ninguna'
}

const TOLERANCIA_PORCENTAJE = 0.02
const TOLERANCIA_MINIMA_BS = 1
const TOLERANCIA_MINUTOS = 10

const dentroDeTolerancia = (pago: PagoPendienteQr, movimiento: MovimientoSinVincular): boolean => {
  const toleranciaBs = Math.max(TOLERANCIA_MINIMA_BS, pago.montoBs * TOLERANCIA_PORCENTAJE)
  const diferenciaBs = Math.abs(movimiento.importeBs - pago.montoBs)
  if (diferenciaBs > toleranciaBs) return false
  const diferenciaMinutos = Math.abs(new Date(movimiento.fechaTransaccion).getTime() - new Date(pago.creadoEn).getTime()) / 60000
  return diferenciaMinutos <= TOLERANCIA_MINUTOS
}

/**
 * Ordena los candidatos de un pago por diferencia de monto y luego de tiempo (brief:
 * "sorted by amount difference, then time difference"). Un único candidato es
 * "Coincidencia fuerte"; varios, "Coincidencia débil"; ninguno, "ninguna".
 */
export function sugerirPagosQr(pagos: PagoPendienteQr[], movimientos: MovimientoSinVincular[]): SugerenciaQr[] {
  return pagos.map((pago) => {
    const candidatos: CandidatoQr[] = movimientos
      .filter((m) => dentroDeTolerancia(pago, m))
      .map((movimiento) => ({
        movimiento,
        diferenciaBs: Math.abs(movimiento.importeBs - pago.montoBs),
        diferenciaMinutos: Math.abs(new Date(movimiento.fechaTransaccion).getTime() - new Date(pago.creadoEn).getTime()) / 60000,
      }))
      .sort((a, b) => a.diferenciaBs - b.diferenciaBs || a.diferenciaMinutos - b.diferenciaMinutos)

    return {
      pago,
      candidatos,
      fuerza: candidatos.length === 1 ? 'fuerte' : candidatos.length > 1 ? 'debil' : 'ninguna',
    }
  })
}
