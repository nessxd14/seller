import type { AnulacionRepository } from '../../application/ports/repositories'
import type { AnulacionResultado, AnulacionSolicitud } from '../../application/shared/models'
import { mockAuthSessionProvider } from './MockAuthSessionProvider'

// Réplica de anulador_autorizado: solo estas dos cuentas anulan, sin mirar rol ni permisos.
const ANULADORES = new Set(['nessxd14@gmail.com', 'piterali.argana@gmail.com'])
const MOTIVO_MIN = 5

let solicitudes: AnulacionSolicitud[] = []
let sequence = 0

const actor = async () => {
  const session = await mockAuthSessionProvider.getSession()
  return { email: session?.user.email ?? session?.user.name ?? 'Usuario POS', puede: ANULADORES.has(session?.user.email ?? '') }
}
const exigirAnulador = async () => {
  const a = await actor()
  if (!a.puede) throw Object.assign(new Error('No tienes permiso para anular ventas. Solicita la anulación y Ness o el gerente la revisarán.'), { code: '42501' })
  return a
}
const exigirMotivo = (motivo: string) => {
  if (motivo.trim().length < MOTIVO_MIN) throw new Error('El motivo debe tener al menos 5 caracteres')
}
const resultado = (s: Pick<AnulacionSolicitud, 'ventaId' | 'cobrado' | 'sesionCobroAbierta' | 'sesionCobroId'>, solicitudId?: string): AnulacionResultado => ({
  ventaId: s.ventaId, estado: 'ANULADA', devuelto: s.cobrado, fueraDeArqueo: s.cobrado > 0 && !s.sesionCobroAbierta,
  reintegroSesionId: s.cobrado > 0 && s.sesionCobroAbierta ? s.sesionCobroId : undefined, solicitudId,
})

export const anulacionMockRepository: AnulacionRepository & { reset(): void } = {
  reset() { solicitudes = []; sequence = 0 },
  async puedeAnular() { return (await actor()).puede },
  async anular(ventaId, motivo) {
    await exigirAnulador()
    exigirMotivo(motivo)
    return resultado({ ventaId, cobrado: 0, sesionCobroAbierta: false, sesionCobroId: undefined })
  },
  async solicitar(ventaId, motivo) {
    const a = await actor()
    exigirMotivo(motivo)
    if (solicitudes.some((s) => s.ventaId === ventaId && s.estado === 'SOLICITADA')) throw new Error('Esta venta ya tiene una solicitud de anulación pendiente')
    const id = String(++sequence)
    solicitudes = [{ id, ventaId, numero: `VTA-${ventaId}`, total: 0, ventaEstado: 'COMPLETADA', estado: 'SOLICITADA', motivo: motivo.trim(), solicitadaPor: a.email, solicitadaEn: new Date().toISOString(), sesionCobroAbierta: false, cobrado: 0 }, ...solicitudes]
    return { solicitudId: id, ventaId, numero: `VTA-${ventaId}`, estado: 'SOLICITADA' }
  },
  async retirar(solicitudId) {
    const a = await actor()
    const row = solicitudes.find((s) => s.id === solicitudId)
    if (!row || row.estado !== 'SOLICITADA') throw new Error('La solicitud ya no está pendiente')
    if (!a.puede && row.solicitadaPor !== a.email) throw Object.assign(new Error('Solo quien la pidió puede retirar la solicitud'), { code: '42501' })
    solicitudes = solicitudes.map((s) => (s.id === solicitudId ? { ...s, estado: 'RETIRADA', resueltaPor: a.email, resueltaEn: new Date().toISOString() } : s))
  },
  async aprobar(solicitudId, nota) {
    const a = await exigirAnulador()
    const row = solicitudes.find((s) => s.id === solicitudId)
    if (!row || row.estado !== 'SOLICITADA') throw new Error('La solicitud ya no está pendiente')
    const res = resultado(row, solicitudId)
    solicitudes = solicitudes.map((s) => (s.id === solicitudId ? { ...s, estado: 'APROBADA', ventaEstado: 'ANULADA', resueltaPor: a.email, resueltaEn: new Date().toISOString(), notaResolucion: nota?.trim() || undefined, reintegroMonto: res.devuelto, reintegroFueraDeArqueo: res.fueraDeArqueo } : s))
    return res
  },
  async rechazar(solicitudId, nota) {
    const a = await exigirAnulador()
    if (nota.trim().length < MOTIVO_MIN) throw new Error('La nota del rechazo debe tener al menos 5 caracteres')
    const row = solicitudes.find((s) => s.id === solicitudId)
    if (!row || row.estado !== 'SOLICITADA') throw new Error('La solicitud ya no está pendiente')
    solicitudes = solicitudes.map((s) => (s.id === solicitudId ? { ...s, estado: 'RECHAZADA', resueltaPor: a.email, resueltaEn: new Date().toISOString(), notaResolucion: nota.trim() } : s))
  },
  async listar(estado = 'SOLICITADA', limite = 50) {
    const a = await actor()
    return solicitudes
      .filter((s) => (estado === null || s.estado === estado) && (a.puede || s.solicitadaPor === a.email))
      .slice(0, limite)
  },
}
