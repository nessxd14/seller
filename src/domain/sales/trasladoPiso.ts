import type { TransferEstado, TransferLine, TransferRecord } from '../../application/shared/models'
import { recibibleTraslado } from './transfers'

/** Mismos ids que el resto de la app: 1 = Almacén Central, 2 = Tienda. */
export const ALMACEN_CENTRAL_ID = 1
export const TIENDA_ID = 2
export const SUCURSAL_PISO: Record<number, string> = { [ALMACEN_CENTRAL_ID]: 'Almacén Central', [TIENDA_ID]: 'Tienda' }
export const nombreSucursalPiso = (id: number) => SUCURSAL_PISO[id] ?? `Sucursal ${id}`

const DIA_MS = 86_400_000
export const DIAS_HISTORIAL = 14
export const MAX_HISTORIAL = 20

export type PildoraTraslado = 'PEDIDO' | 'RECIBIDO' | 'CON_FALTANTE' | 'CANCELADO' | 'EN_CAMINO'
export const ETIQUETA_PILDORA: Record<PildoraTraslado, string> = { PEDIDO: 'Pedido', RECIBIDO: 'Recibido', CON_FALTANTE: 'Con faltante', CANCELADO: 'Cancelado', EN_CAMINO: 'En camino' }

const redondear = (n: number) => Math.round(n * 1_000_000) / 1_000_000

/** Número corto para el celular: TRA-2026-00088 → 88. */
export function numeroCorto(numero: string): string {
  const m = /(\d+)\s*$/.exec(numero)
  return m ? String(Number(m[1])) : numero
}

/** Unidades base por cada unidad de la presentación de la línea (1 si se pidió en unidad base). */
export const factorLinea = (l: TransferLine) => (l.presentacionId != null && l.cantidadPresentacion ? l.cantidadBase / l.cantidadPresentacion : 1)
export const despachadaBase = (l: TransferLine) => l.cantidadDespachada ?? l.cantidadBase
export const despachadaEnPresentacion = (l: TransferLine) => redondear(despachadaBase(l) / factorLinea(l))
export const nombrePresentacion = (l: TransferLine) => l.presentacionNombre ?? 'unidad'

/** Unidades base que salieron y no llegaron, en un traslado ya recibido. */
export function unidadesFaltantes(t: TransferRecord): number {
  return redondear(t.lines.filter(recibibleTraslado).reduce((n, l) => n + (l.cantidadRecibida != null ? Math.max(0, despachadaBase(l) - l.cantidadRecibida) : 0), 0))
}

export const conFaltante = (t: TransferRecord) => t.estado === 'RECIBIDO' && unidadesFaltantes(t) > 0

export function pildoraTraslado(t: TransferRecord): PildoraTraslado {
  const estado: TransferEstado = t.estado
  if (estado === 'SOLICITADO') return 'PEDIDO'
  if (estado === 'EN_TRANSITO') return 'EN_CAMINO'
  if (estado === 'RECIBIDO') return conFaltante(t) ? 'CON_FALTANTE' : 'RECIBIDO'
  return 'CANCELADO'
}

/** El reponedor solo ve lo que llega a su sucursal. */
export const trasladosDeSucursal = (lista: TransferRecord[], sucursalId: number) => lista.filter((t) => t.sucursalDestinoId === sucursalId)

const ultimoMovimiento = (t: TransferRecord) => Math.max(...[t.solicitadoEn, t.despachadoEn, t.recibidoEn, t.creadoEn].map((f) => (f ? new Date(f).getTime() : 0)).filter(Number.isFinite))

export function separarTraslados(lista: TransferRecord[], ahora: number): { porRecibir: TransferRecord[]; misPedidos: TransferRecord[] } {
  const recientes = (t: TransferRecord) => ahora - ultimoMovimiento(t) <= DIAS_HISTORIAL * DIA_MS
  const masNuevoPrimero = (a: TransferRecord, b: TransferRecord) => ultimoMovimiento(b) - ultimoMovimiento(a)
  return {
    porRecibir: lista.filter((t) => t.estado === 'EN_TRANSITO').sort(masNuevoPrimero),
    misPedidos: lista.filter((t) => t.estado !== 'EN_TRANSITO' && recientes(t)).sort(masNuevoPrimero).slice(0, MAX_HISTORIAL),
  }
}

/**
 * Lo que se manda a `receive`: `null` si llegó todo lo despachado; si no, una cantidad base por línea recibible.
 * `llegaron` va en unidades de la presentación de cada línea.
 */
export function recepcionDesdeConteo(lineas: TransferLine[], llegaron: Record<string, number>): null | Array<{ lineaId: string; cantidadBase: number }> {
  const recibibles = lineas.filter(recibibleTraslado)
  const filas = recibibles.map((l) => {
    const base = Math.max(0, Math.min(despachadaBase(l), redondear((llegaron[l.id] ?? despachadaEnPresentacion(l)) * factorLinea(l))))
    return { lineaId: l.id, cantidadBase: base, completa: base >= despachadaBase(l) }
  })
  if (filas.every((f) => f.completa)) return null
  return filas.map(({ lineaId, cantidadBase }) => ({ lineaId, cantidadBase }))
}

const dia = (ms: number) => new Date(ms).toDateString()
const hora = (ms: number) => new Date(ms).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false })

/** «hoy 14:05», «ayer 09:10» o «12 nov». */
export function cuandoTexto(iso: string | undefined, ahora: number): string {
  if (!iso) return '—'
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return '—'
  if (dia(ms) === dia(ahora)) return `hoy ${hora(ms)}`
  if (dia(ms) === dia(ahora - DIA_MS)) return `ayer ${hora(ms)}`
  return new Date(ms).toLocaleDateString('es-BO', { day: '2-digit', month: 'short' })
}
