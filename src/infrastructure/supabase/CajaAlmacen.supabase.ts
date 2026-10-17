import { supabase } from './supabaseClient'
import type { CajaAlmacenRecord } from '../../application/shared/cajaAlmacen'

export async function operarCajaAlmacen(accion: string, operacionId: string | null = null, sesionId: string | null = null, datos: object = {}): Promise<CajaAlmacenRecord> {
  const { data, error } = await supabase.rpc('operar_caja_almacen', {
    p_accion: accion, p_operacion_id: operacionId, p_sesion_id: sesionId ? Number(sesionId) : null, p_datos: datos,
  })
  if (error) throw Object.assign(new Error(error.code === 'PGRST202' ? 'El flujo Caja–Almacén requiere activar la actualización de la base.' : error.message), { code: error.code })
  if (!data || !('operacion' in data)) throw new Error('No se pudo comprobar el estado de la operación. Actualiza antes de continuar.')
  return { ...data, vtds: data.vtds ?? [] } as CajaAlmacenRecord
}
