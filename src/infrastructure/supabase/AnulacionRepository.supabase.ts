// Anulación de tickets (VTA + VTD). Llama directo a las RPC ya desplegadas (anular_venta,
// solicitar/retirar/aprobar/rechazar/listar_solicitudes_anulacion, app_puede_anular). Los mensajes de
// error de Postgres ya vienen en español para el usuario: se propagan tal cual vía toError.
import { supabase } from './supabaseClient'
import { toError } from './postgrestError'
import { supabaseAuthSessionProvider } from './SupabaseAuthSessionProvider'
import type { AnulacionRepository } from '../../application/ports/repositories'
import type { AnulacionResultado, AnulacionSolicitud, AnulacionSolicitudEstado } from '../../application/shared/models'

const num = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v))
const idOrUndef = (v: number | string | null | undefined): string | undefined => (v == null ? undefined : String(v))

interface ResultadoRow {
  venta_id: number | string; estado: 'ANULADA'; estado_previo?: string; devuelto?: number | string | null
  reintegro_sesion_id?: number | string | null; fuera_de_arqueo?: boolean | null; kardex_revertido?: boolean | null
  via?: string | null; solicitud_id?: number | string | null
}
interface SolicitudRow {
  id: number | string; venta_id: number | string; numero: string | null; total: number | string; venta_estado: string
  cliente?: string | null; estado: AnulacionSolicitudEstado; motivo: string; solicitada_por?: string | null; solicitada_en: string
  sesion_solicitud_id?: number | string | null; resuelta_por?: string | null; resuelta_en?: string | null; nota_resolucion?: string | null
  reintegro_monto?: number | string | null; reintegro_sesion_id?: number | string | null; reintegro_fuera_de_arqueo?: boolean | null
  reintegro_detalle?: unknown; sesion_cobro_id?: number | string | null; sesion_cobro_abierta?: boolean | null; cobrado?: number | string | null
}

const rowToResultado = (r: ResultadoRow): AnulacionResultado => ({
  ventaId: String(r.venta_id),
  estado: 'ANULADA',
  estadoPrevio: r.estado_previo ?? undefined,
  devuelto: num(r.devuelto),
  reintegroSesionId: idOrUndef(r.reintegro_sesion_id),
  fueraDeArqueo: r.fuera_de_arqueo === true,
  kardexRevertido: r.kardex_revertido ?? undefined,
  via: r.via ?? undefined,
  solicitudId: idOrUndef(r.solicitud_id),
})

const rowToSolicitud = (r: SolicitudRow): AnulacionSolicitud => ({
  id: String(r.id),
  ventaId: String(r.venta_id),
  numero: r.numero,
  total: num(r.total),
  ventaEstado: r.venta_estado,
  cliente: r.cliente ?? undefined,
  estado: r.estado,
  motivo: r.motivo,
  solicitadaPor: r.solicitada_por ?? undefined,
  solicitadaEn: r.solicitada_en,
  sesionSolicitudId: idOrUndef(r.sesion_solicitud_id),
  resueltaPor: r.resuelta_por ?? undefined,
  resueltaEn: r.resuelta_en ?? undefined,
  notaResolucion: r.nota_resolucion ?? undefined,
  reintegroMonto: r.reintegro_monto == null ? undefined : num(r.reintegro_monto),
  reintegroSesionId: idOrUndef(r.reintegro_sesion_id),
  reintegroFueraDeArqueo: r.reintegro_fuera_de_arqueo ?? undefined,
  reintegroDetalle: r.reintegro_detalle ?? undefined,
  sesionCobroId: idOrUndef(r.sesion_cobro_id),
  sesionCobroAbierta: r.sesion_cobro_abierta === true,
  cobrado: num(r.cobrado),
})

// app_puede_anular no cambia durante una sesión: se consulta una vez por usuario y se reconsulta
// cuando cambia el usuario que inició sesión. Si la consulta falla no se cachea (se reintenta).
let cache: { userId: string; value: Promise<boolean> } | null = null

export function resetPuedeAnularCache() { cache = null }

export const anulacionRepository: AnulacionRepository = {
  async puedeAnular() {
    const session = await supabaseAuthSessionProvider.getSession()
    const userId = session?.user.id
    if (!userId) return false
    if (cache?.userId === userId) return cache.value
    const value = (async () => {
      const { data, error } = await supabase.rpc('app_puede_anular')
      if (error) throw toError(error)
      return data === true
    })()
    cache = { userId, value }
    value.catch(() => { if (cache?.value === value) cache = null })
    return value
  },
  async anular(ventaId, motivo) {
    const session = await supabaseAuthSessionProvider.getSession()
    const actor = session?.user.email ?? session?.user.name ?? 'pos'
    // p_sesion_caja_id se acepta pero la base lo ignora: la sesión de la devolución la decide ella.
    const { data, error } = await supabase.rpc('anular_venta', { p_venta_id: Number(ventaId), p_usuario: actor, p_sesion_caja_id: null, p_motivo: motivo })
    if (error) throw toError(error)
    return rowToResultado(data as ResultadoRow)
  },
  async solicitar(ventaId, motivo) {
    const { data, error } = await supabase.rpc('solicitar_anulacion_venta', { p_venta_id: Number(ventaId), p_motivo: motivo })
    if (error) throw toError(error)
    const r = data as { solicitud_id: number | string; venta_id: number | string; numero?: string | null }
    return { solicitudId: String(r.solicitud_id), ventaId: String(r.venta_id), numero: r.numero ?? undefined, estado: 'SOLICITADA' }
  },
  async retirar(solicitudId) {
    const { error } = await supabase.rpc('retirar_solicitud_anulacion', { p_solicitud_id: Number(solicitudId) })
    if (error) throw toError(error)
  },
  async aprobar(solicitudId, nota) {
    const { data, error } = await supabase.rpc('aprobar_solicitud_anulacion', { p_solicitud_id: Number(solicitudId), p_nota: nota?.trim() || null })
    if (error) throw toError(error)
    return rowToResultado(data as ResultadoRow)
  },
  async rechazar(solicitudId, nota) {
    const { error } = await supabase.rpc('rechazar_solicitud_anulacion', { p_solicitud_id: Number(solicitudId), p_nota: nota })
    if (error) throw toError(error)
  },
  async listar(estado = 'SOLICITADA', limite = 50) {
    const { data, error } = await supabase.rpc('listar_solicitudes_anulacion', { p_estado: estado, p_limite: limite })
    if (error) throw toError(error)
    return ((data ?? []) as SolicitudRow[]).map(rowToSolicitud)
  },
}
