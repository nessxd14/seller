// Formato compartido por el detalle, la sesión de edición y la línea de tiempo. Los importes
// llegan en Bs con 2 decimales (contrato de las RPC de edición), no en centavos.
const FORMATO_BS = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const

export const bs = (valor: number): string => `Bs ${valor.toLocaleString('es-BO', FORMATO_BS)}`

export const cant = (valor: number): string => valor.toLocaleString('es-BO', { maximumFractionDigits: 2 })

/** "+Bs 429,00" / "−Bs 152,00" / "Bs 0,00". */
export const deltaBs = (valor: number): string => {
  if (Math.abs(valor) < 0.005) return bs(0)
  return `${valor > 0 ? '+' : '−'}${bs(Math.abs(valor))}`
}

export const horaCorta = (iso: string): string => new Date(iso).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false })

export const fechaCorta = (iso: string): string => new Date(iso).toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit' })

export const fechaHora = (iso: string): string => `${fechaCorta(iso)} · ${horaCorta(iso)}`

/** "Hoy" / "Ayer · dd/mm" / "dd/mm" — encabezado de cada día en la línea de tiempo. */
export const etiquetaDia = (iso: string, ahora: Date = new Date()): string => {
  const dia = new Date(iso)
  const inicio = (fecha: Date) => new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()).getTime()
  const diferencia = Math.round((inicio(ahora) - inicio(dia)) / 86_400_000)
  if (diferencia === 0) return 'Hoy'
  if (diferencia === 1) return `Ayer · ${fechaCorta(iso)}`
  return fechaCorta(iso)
}
