/** Fecha de hoy en Trinidad (America/La_Paz, UTC−4), formato YYYY-MM-DD.
 *  NUNCA usar new Date().toISOString().slice(0,10) para esto: después de las
 *  20:00 hora local devuelve mañana. */
export const hoyLocal = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date())

/**
 * Suma (o resta, con `dias` negativo) días a una fecha YYYY-MM-DD sin pasar por UTC —
 * `new Date(y, m, d + dias)` normaliza el desborde de mes/año solo, y formatear con
 * getFullYear/getMonth/getDate (componentes locales) en vez de toISOString().slice(0,10)
 * evita reintroducir el mismo bug que hoyLocal corrige.
 */
export const sumarDiasIso = (fechaIso: string, dias: number): string => {
  const [y, m, d] = fechaIso.split('-').map(Number)
  const fecha = new Date(y, m - 1, d + dias)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}`
}
