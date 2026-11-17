import type { TrasladoPiso } from '../../application/ports/pisoRepository'
import { horaCorta } from './turnoPiso'

export type PildoraQr = 'PEDIDO' | 'EN_ALISTADO' | 'LISTO' | 'RETIRANDO' | 'RECIBIDO' | 'CON_FALTANTE' | 'CANCELADO' | 'EN_CAMINO'
export type TonoPildora = 'gris' | 'azul' | 'ambar' | 'verde' | 'rojo'
export type SeccionTraslado = 'retirar' | 'recibir' | 'pedidos'

export const ETIQUETA_PILDORA_QR: Record<PildoraQr, string> = {
  PEDIDO: 'Pedido', EN_ALISTADO: 'En alistado', LISTO: 'Listo para retirar', RETIRANDO: 'Retirando',
  RECIBIDO: 'Recibido', CON_FALTANTE: 'Con faltante', CANCELADO: 'Cancelado', EN_CAMINO: 'En camino',
}

export const TONO_PILDORA_QR: Record<PildoraQr, TonoPildora> = {
  PEDIDO: 'gris', EN_ALISTADO: 'azul', LISTO: 'ambar', RETIRANDO: 'ambar',
  RECIBIDO: 'verde', CON_FALTANTE: 'rojo', CANCELADO: 'gris', EN_CAMINO: 'ambar',
}

const ESTADOS_CANCELADOS = new Set(['CANCELADO', 'RECHAZADO'])

/** Pastilla del traslado: manda la tarea QR de Almacén; sin tarea, el estado del traslado (flujo viejo incluido). */
export function pildoraTrasladoPiso(t: TrasladoPiso): PildoraQr {
  if (ESTADOS_CANCELADOS.has(t.estado)) return 'CANCELADO'
  switch (t.tareaEstado) {
    case 'PREPARANDO': return 'EN_ALISTADO'
    case 'PREPARADO': return 'LISTO'
    case 'REVISANDO': return 'RETIRANDO'
    case 'RECIBIDO': return t.conFaltante ? 'CON_FALTANTE' : 'RECIBIDO'
    default: break
  }
  if (t.estado === 'RECIBIDO') return t.conFaltante ? 'CON_FALTANTE' : 'RECIBIDO'
  if (t.estado === 'EN_TRANSITO') return 'EN_CAMINO'
  return 'PEDIDO'
}

/** «Para retirar» (listo o retirando), «Por recibir» (flujo viejo) o «Mis pedidos». */
export function seccionTrasladoPiso(t: TrasladoPiso): SeccionTraslado {
  const p = pildoraTrasladoPiso(t)
  if (p === 'LISTO' || p === 'RETIRANDO') return 'retirar'
  if (p === 'EN_CAMINO') return 'recibir'
  return 'pedidos'
}

/** El QR sirve mientras el traslado sigue abierto en Almacén. */
export const tieneQrAbierto = (t: TrasladoPiso): boolean => {
  const p = pildoraTrasladoPiso(t)
  return p === 'PEDIDO' || p === 'EN_ALISTADO' || p === 'LISTO' || p === 'RETIRANDO'
}

export function detalleTrasladoPiso(t: TrasladoPiso): string {
  switch (pildoraTrasladoPiso(t)) {
    case 'PEDIDO': return `Pedido ${horaCorta(t.solicitadoEn)} · almacén aún no lo toma`
    case 'EN_ALISTADO': return `${t.alista ?? 'Almacén'} lo está alistando`
    case 'LISTO': return `${t.alista ? `Alistó ${t.alista}` : 'Alistado'}${t.alistadoEn ? ` a las ${horaCorta(t.alistadoEn)}` : ''}${t.mio ? ' · lo pediste tú' : ''}`
    case 'RETIRANDO': return t.retiroMio ? 'Lo estás comprobando tú' : `${t.retira ?? 'Alguien'} está comprobando`
    case 'RECIBIDO': return `Recibido${t.recibidoEn ? ` ${horaCorta(t.recibidoEn)}` : ''} · llegó completo`
    case 'CON_FALTANTE': return `Recibido${t.recibidoEn ? ` ${horaCorta(t.recibidoEn)}` : ''} · con faltante`
    case 'CANCELADO': return `Cancelado · pedido ${horaCorta(t.solicitadoEn)}`
    case 'EN_CAMINO': return 'Ya salió de almacén'
  }
}
