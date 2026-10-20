import type { AuthSession } from '../../application/auth/AuthSessionProvider'
import type { TransferLine, TransferRecord } from '../../application/shared/models'

export const pendienteTraslado = (line: TransferLine) => line.estado ? line.estado === 'POR_DESPACHAR' : !line.cantidadDespachada
export const recibibleTraslado = (line: TransferLine) => line.estado ? line.estado === 'DESPACHADA' : (line.cantidadDespachada ?? 0) > 0
export const cantidadDevolucion = (line: TransferLine) => recibibleTraslado(line) ? (line.cantidadRecibida ?? line.cantidadDespachada ?? 0) : 0
export const estadoLineaTraslado = (line: TransferLine) => ({ POR_DESPACHAR: 'Pendiente', DESPACHADA: 'Despachada', CAMBIADA: 'En otra tanda', RECHAZADO: 'Rechazada', RETIRADA: 'Retirada' }[line.estado ?? 'POR_DESPACHAR'])
export const puedeDespacharTraslado = (session?: AuthSession | null) => Boolean(session?.user.active && ['admin', 'gerente', 'supervisor', 'almacen', 'almacenero', 'operario'].includes(session.user.role))
export const puedeSolicitarTraslado = (session?: AuthSession | null) => Boolean(session?.user.active && ['admin', 'gerente', 'supervisor', 'almacen', 'almacenero', 'operario', 'vendedor', 'cajero'].includes(session.user.role))
export const sucursalPermiteTraslado = (session: AuthSession | null | undefined, branch: number) => Boolean(session?.user.active && (['admin', 'gerente', 'supervisor'].includes(session.user.role) || session.user.sucursalId == null || session.user.sucursalId === branch))
export const diasEnTransito = (t: TransferRecord, now: number) => t.estado === 'EN_TRANSITO' && t.despachadoEn ? Math.max(0, Math.floor((now - new Date(t.despachadoEn).getTime()) / 86_400_000)) : 0
export function mensajeErrorTraslado(error: unknown, fallback: string): string {
  const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : null
  return typeof message === 'string' && message.trim() ? message : fallback
}
