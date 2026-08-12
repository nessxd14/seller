// Brief T2 Tarea 2: el panel de "cliente parecido" nunca bloquea el alta — salvo que el
// vendedor insista habiendo candidatos con similitud alta, donde se le pide una
// confirmación explícita antes de seguir. `>= 0.6` es el umbral que fija el brief; con
// motivo 'DOCUMENTO' la similitud ya viene en 1 (certeza, no sugerencia) así que también
// dispara la confirmación.
export const UMBRAL_CONFIRMACION = 0.6

export interface CandidatoSimilitud {
  similitud: number
}

export const requiereConfirmacion = (candidatos: CandidatoSimilitud[]): boolean =>
  candidatos.some((c) => c.similitud >= UMBRAL_CONFIRMACION)
