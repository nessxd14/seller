import type { AnulacionResultado, AnulacionSolicitud, AnulacionSolicitudResultado } from '../../application/shared/models'

export const MOTIVO_ANULACION_MIN = 5

const bs = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Lo que la base sabe (o el llamador conoce) del cobro de la venta; todo opcional. */
export interface CobroAnulacion {
  cobrado?: number
  sesionCobroId?: string
  sesionCobroAbierta?: boolean
}

/**
 * La base decide de qué turno sale la devolución; esto solo lo explica antes de confirmar.
 * Turno del cobro abierto → movimiento ANULACION en ese arqueo; cerrado → fuera de arqueo, a nombre de quien anula.
 */
export function explicarDevolucion({ cobrado, sesionCobroId, sesionCobroAbierta }: CobroAnulacion, puedeAnular: boolean): string {
  if (!puedeAnular) return 'Ness o el gerente revisarán tu solicitud.'
  if (cobrado === 0) return 'No hay dinero que devolver.'
  if (cobrado === undefined || sesionCobroAbierta === undefined) return 'La devolución se registra según el turno donde se cobró.'
  if (sesionCobroAbierta) return `Se devolverá Bs ${bs(cobrado)} desde el turno #${sesionCobroId ?? '—'} (afecta su arqueo).`
  return `El turno del cobro ya cerró: Bs ${bs(cobrado)} se devuelve fuera de arqueo, a tu nombre.`
}

export type BadgeDevolucion = { tipo: 'turno' | 'fuera-de-arqueo' | 'sin-cobro'; texto: string }

/** Etiqueta corta de la bandeja de revisión para una solicitud. */
export function badgeDevolucion(s: Pick<AnulacionSolicitud, 'cobrado' | 'sesionCobroAbierta' | 'sesionCobroId'>): BadgeDevolucion {
  if (!(s.cobrado > 0)) return { tipo: 'sin-cobro', texto: 'Sin cobro' }
  if (s.sesionCobroAbierta) return { tipo: 'turno', texto: `Devuelve desde turno #${s.sesionCobroId ?? '—'}` }
  return { tipo: 'fuera-de-arqueo', texto: 'Fuera de arqueo' }
}

export type AnularVentaResultado =
  | { tipo: 'anulada'; resultado: AnulacionResultado }
  | { tipo: 'solicitada'; resultado: AnulacionSolicitudResultado }

/** Texto del aviso tras anular o solicitar; la devolución fuera de arqueo se menciona de forma explícita. */
export function mensajeAnulacion(numero: string | null | undefined, r: AnularVentaResultado): string {
  const nombre = numero ?? 'La venta'
  if (r.tipo === 'solicitada') return `Solicitud de anulación enviada para ${nombre}. Ness o el gerente la revisarán.`
  const { devuelto, fueraDeArqueo, reintegroSesionId } = r.resultado
  if (!(devuelto > 0)) return `${nombre} anulada. No había dinero que devolver.`
  if (fueraDeArqueo) return `${nombre} anulada. Bs ${bs(devuelto)} devueltos FUERA DE ARQUEO, a tu nombre.`
  return `${nombre} anulada. Bs ${bs(devuelto)} devueltos${reintegroSesionId ? ` desde el turno #${reintegroSesionId}` : ''}.`
}
