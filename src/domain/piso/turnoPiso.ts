import type { PisoTurnoUltimo } from '../../application/ports/pisoRepository'

const ZONA = 'America/La_Paz'
const CORTE_MEDIODIA = { minutos: 14 * 60, texto: '14:00' }
const CORTE_NOCHE = { minutos: 21 * 60 + 30, texto: '21:30' }

/** Hora y minuto de `ahora` en La Paz (sin horario de verano). */
export function horaMinutoLaPaz(ahora: Date): { hora: number; minuto: number } {
  const partes = new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ahora)
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? 0)
  return { hora: valor('hour'), minuto: valor('minute') }
}

/** Próximo corte automático del día: antes de las 14:00 → «14:00», antes de las 21:30 → «21:30», luego `null`. */
export function proximoCorte(ahora: Date): string | null {
  const { hora, minuto } = horaMinutoLaPaz(ahora)
  const minutos = hora * 60 + minuto
  if (minutos < CORTE_MEDIODIA.minutos) return CORTE_MEDIODIA.texto
  if (minutos < CORTE_NOCHE.minutos) return CORTE_NOCHE.texto
  return null
}

/** Solo los cierres que no hizo la persona explican por qué su turno terminó. */
export const turnoTerminoSolo = (ultimo: PisoTurnoUltimo | null | undefined): ultimo is PisoTurnoUltimo =>
  ultimo != null && (ultimo.cierre === 'AUTOMATICO' || ultimo.cierre === 'CAJA')

export const horaCorta = (iso?: string | null): string =>
  (iso ? new Date(iso).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false }) : '')
