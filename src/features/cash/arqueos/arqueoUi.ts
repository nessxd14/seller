import type { ArqueoProgramado } from '../../../application/shared/models'

export type TonoArqueo = 'ok' | 'tarde' | 'pendiente' | 'vencido' | 'neutro'

/** "10:42" en hora local; vacío si la fecha no es válida. */
export const horaCorta = (iso?: string): string => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Estado en palabras, sin dinero. `ahoraMs` es la hora del servidor (o la del navegador corregida). */
export function estadoArqueoUi(a: ArqueoProgramado, ahoraMs: number): { texto: string; tono: TonoArqueo } {
  switch (a.estado) {
    case 'CUMPLIDO': return { texto: 'a tiempo', tono: 'ok' }
    case 'CUMPLIDO_TARDE': return { texto: 'tarde', tono: 'tarde' }
    case 'VENCIDO': return { texto: 'no realizado', tono: 'vencido' }
    case 'CANCELADO': return { texto: 'no tocaba', tono: 'neutro' }
    default: return Date.parse(a.programadoEn) <= ahoraMs ? { texto: 'pendiente', tono: 'pendiente' } : { texto: 'programado', tono: 'neutro' }
  }
}

/** Semáforo del gerente: verde |dif| < 1, ámbar < 10, rojo desde 10. */
export function semaforoDiferencia(diferenciaBs: number): 'verde' | 'ambar' | 'rojo' {
  const d = Math.abs(diferenciaBs)
  return d < 1 ? 'verde' : d < 10 ? 'ambar' : 'rojo'
}

/** mm:ss de una cuenta regresiva. */
export const formatoCuentaRegresiva = (ms: number): string => {
  const seg = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(seg / 60)).padStart(2, '0')}:${String(seg % 60).padStart(2, '0')}`
}
