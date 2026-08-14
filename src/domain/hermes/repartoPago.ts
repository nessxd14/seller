// Brief T4 Tarea 2: validaciones de la pantalla de reparto ANTES de llamar a imputar_pago
// — la RPC valida lo mismo del lado servidor (y ese mensaje se muestra tal cual si de
// todos modos llega a fallar), pero repetirlo acá evita el viaje de red para el caso común
// de un error de tipeo del vendedor.
export interface FilaRepartoEditable {
  partidaId: number
  referencia: string
  pendiente: number
  aplica: number
}

export const sumaAplicaciones = (filas: FilaRepartoEditable[]): number =>
  filas.reduce((sum, f) => sum + f.aplica, 0)

export const excedenteReparto = (monto: number, filas: FilaRepartoEditable[]): number =>
  Math.max(0, monto - sumaAplicaciones(filas))

// Redondeo de centavos: comparar montos en Bs con != puede fallar por error de punto
// flotante (0.1 + 0.2 !== 0.3) — todo acá se compara con dos decimales de tolerancia.
const mayorQue = (a: number, b: number): boolean => Math.round((a - b) * 100) > 0

export const validarReparto = (monto: number, filas: FilaRepartoEditable[]): string | null => {
  for (const fila of filas) {
    if (fila.aplica < 0) return `El monto asignado a ${fila.referencia} no puede ser negativo`
    if (mayorQue(fila.aplica, fila.pendiente)) {
      return `No se puede imputar a ${fila.referencia} más de lo pendiente (Bs ${fila.pendiente.toFixed(2)})`
    }
  }
  const suma = sumaAplicaciones(filas)
  if (mayorQue(suma, monto)) {
    return `La suma del reparto (Bs ${suma.toFixed(2)}) supera el monto del pago (Bs ${monto.toFixed(2)})`
  }
  return null
}
