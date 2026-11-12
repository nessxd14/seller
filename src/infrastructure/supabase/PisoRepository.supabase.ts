// Piso — turno, "Ventas de caja · Es mía" y "Venta no realizada". Llama directo a las RPC de
// 20261112110000_piso_turno_reclamos.sql; aquí solo se mapea snake_case → camelCase.
import type { CajaReclamo, CajaVendedorPiso, MotivoNoRealizada, NoRealizadaInput, NoRealizadaResultado, PisoRepository, PisoTurno, ReclamoResultado, VentaPorReclamar } from '../../application/ports/pisoRepository'
import { toError } from './postgrestError'
import { supabase } from './supabaseClient'

type Num = number | string | null | undefined
const num = (v: Num): number => (v == null ? 0 : Number(v))

interface TurnoRow { turno_id: Num; inicio?: string; sucursal_id?: Num; cobradas?: Num; por_cobrar?: Num; no_realizadas?: Num; por_reclamar?: Num }
const aTurno = (r: TurnoRow | null): PisoTurno | null => {
  if (!r || r.turno_id == null) return null
  return { turnoId: num(r.turno_id), inicio: r.inicio ?? '', sucursalId: num(r.sucursal_id), cobradas: num(r.cobradas), porCobrar: num(r.por_cobrar), noRealizadas: num(r.no_realizadas), porReclamar: num(r.por_reclamar) }
}

interface VentaRow { venta_id: Num; numero: string; total: Num; completado_en: string; producto: string | null; n_productos: Num }
interface ReclamoRow { reclamo_id: Num; venta_id: Num; deshacer_hasta: string }
interface NoRealizadaRow { visita: string; lineas?: Array<{ demanda_id: Num; motivo: MotivoNoRealizada; idea_id?: Num; veces_semana?: Num }> | null }
interface CajaReclamoRow { venta_id: Num; perfil_id: string; nombre: string; origen: 'RECLAMO' | 'CAJA'; reclamado_en: string }
interface VendedorRow { perfil_id: string; nombre: string; en_turno: boolean | null }

export const pisoRepository: PisoRepository = {
  async turnoActual() {
    const { data, error } = await supabase.rpc('piso_turno_actual')
    if (error) throw toError(error)
    return aTurno(data as TurnoRow | null)
  },

  async iniciarTurno(sucursalId) {
    const { data, error } = await supabase.rpc('piso_turno_iniciar', { p_sucursal_id: sucursalId ?? null })
    if (error) throw toError(error)
    const turno = aTurno(data as TurnoRow | null)
    if (!turno) throw new Error('No se pudo iniciar el turno.')
    return turno
  },

  async finalizarTurno() {
    const { error } = await supabase.rpc('piso_turno_finalizar')
    if (error) throw toError(error)
  },

  async ventasPorReclamar(): Promise<VentaPorReclamar[]> {
    const { data, error } = await supabase.rpc('ventas_por_reclamar')
    if (error) throw toError(error)
    return ((data ?? []) as VentaRow[]).map((r) => ({ ventaId: num(r.venta_id), numero: r.numero, total: num(r.total), completadoEn: r.completado_en, producto: r.producto, nProductos: num(r.n_productos) }))
  },

  async reclamar(ventaId): Promise<ReclamoResultado> {
    const { data, error } = await supabase.rpc('reclamar_venta', { p_venta_id: ventaId })
    if (error) throw toError(error)
    const r = data as ReclamoRow
    return { reclamoId: num(r.reclamo_id), ventaId: num(r.venta_id), deshacerHasta: r.deshacer_hasta }
  },

  async deshacerReclamo(ventaId) {
    const { error } = await supabase.rpc('deshacer_reclamo', { p_venta_id: ventaId })
    if (error) throw toError(error)
  },

  async registrarNoRealizada(input: NoRealizadaInput): Promise<NoRealizadaResultado> {
    const { data, error } = await supabase.rpc('registrar_venta_no_realizada', {
      p_lineas: input.lineas.map((l) => ({
        producto_id: l.productoId, descripcion: l.descripcion, cantidad: l.cantidad, unidad: l.unidad,
        motivo: l.motivo, motivo_texto: l.motivo === 'OTRO' ? l.motivoTexto : null,
      })),
      p_canal: input.canal,
      p_contacto_nombre: input.contactoNombre,
      p_contacto_tel: input.contactoTel,
      p_quiere_aviso: input.quiereAviso,
      p_foto_path: input.fotoPath,
    })
    if (error) throw toError(error)
    const r = data as NoRealizadaRow
    return {
      visita: r.visita,
      lineas: (r.lineas ?? []).map((l) => ({ demandaId: num(l.demanda_id), motivo: l.motivo, ideaId: l.idea_id == null ? null : num(l.idea_id), vecesSemana: l.veces_semana == null ? null : num(l.veces_semana) })),
    }
  },

  async cajaReclamos(ventaIds): Promise<CajaReclamo[]> {
    if (!ventaIds.length) return []
    const { data, error } = await supabase.rpc('caja_reclamos', { p_venta_ids: ventaIds })
    if (error) throw toError(error)
    return ((data ?? []) as CajaReclamoRow[]).map((r) => ({ ventaId: num(r.venta_id), perfilId: r.perfil_id, nombre: r.nombre, origen: r.origen, reclamadoEn: r.reclamado_en }))
  },

  async cajaVendedoresPiso(): Promise<CajaVendedorPiso[]> {
    const { data, error } = await supabase.rpc('caja_vendedores_piso')
    if (error) throw toError(error)
    return ((data ?? []) as VendedorRow[]).map((r) => ({ perfilId: r.perfil_id, nombre: r.nombre, enTurno: !!r.en_turno }))
  },

  async cajaAsignarVendedor(ventaId, perfilId, motivo) {
    const { error } = await supabase.rpc('caja_asignar_vendedor', { p_venta_id: ventaId, p_perfil_id: perfilId, p_motivo: motivo?.trim() || null })
    if (error) throw toError(error)
  },
}
