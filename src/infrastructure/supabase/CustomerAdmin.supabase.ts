import { supabase } from './supabaseClient'
import { ConflictError, NotFoundError } from '../../application/errors/AppError'

// Brief S11 Bloque B4: puede_eliminarse_cliente/eliminar_cliente son la única fuente de
// verdad — este archivo solo pregunta y muestra, nunca reimplementa la decisión.

export interface PuedeEliminarseCliente {
  existe: boolean
  nombre: string
  ventas: number
  pedidos: number
  cotizaciones: number
  movimientosCaja: number
  puedeBorrarse: boolean
}

export async function puedeEliminarseCliente(clienteId: number): Promise<PuedeEliminarseCliente> {
  const { data, error } = await supabase.rpc('puede_eliminarse_cliente', { p_cliente_id: clienteId })
  if (error) throw error
  const row = data as { existe: boolean; nombre: string | null; ventas: number | string; pedidos: number | string; cotizaciones: number | string; movimientos_caja: number | string; puede_borrarse: boolean }
  return {
    existe: Boolean(row?.existe),
    nombre: row?.nombre ?? '',
    ventas: Number(row?.ventas ?? 0),
    pedidos: Number(row?.pedidos ?? 0),
    cotizaciones: Number(row?.cotizaciones ?? 0),
    movimientosCaja: Number(row?.movimientos_caja ?? 0),
    puedeBorrarse: Boolean(row?.puede_borrarse),
  }
}

export async function eliminarCliente(clienteId: number, motivo: string, usuario: string): Promise<void> {
  const { error } = await supabase.rpc('eliminar_cliente', { p_cliente_id: clienteId, p_motivo: motivo, p_usuario: usuario })
  if (error) {
    if (error.message.includes('no existe')) throw new NotFoundError('El cliente ya no existe')
    if (error.message.includes('no se puede eliminar')) throw new ConflictError(error.message)
    throw error
  }
}
