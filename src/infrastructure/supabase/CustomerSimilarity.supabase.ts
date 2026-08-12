import { supabase } from './supabaseClient'
import { customerRepository } from './CustomerRepository.supabase'

// Brief T2 Tarea 2: buscar_clientes_similares es una capacidad solo-Supabase, sin
// equivalente mock (la RPC vive en Cation) — se importa directo en el componente,
// gateado por featureFlags.supabase, mismo patrón que OrderAdmin.supabase.ts.
export interface ClienteSimilar {
  id: number
  nombre: string
  razonSocial: string | null
  documento: string | null
  tipoPrecio: string
  activo: boolean
  motivo: 'DOCUMENTO' | 'NOMBRE' | 'RAZON_SOCIAL'
  similitud: number
}

interface ClienteSimilarRow {
  id: number
  nombre: string
  razon_social: string | null
  documento: string | null
  tipo_precio: string
  activo: boolean
  motivo: 'DOCUMENTO' | 'NOMBRE' | 'RAZON_SOCIAL'
  similitud: number
}

export async function buscarClientesSimilares(nombre: string, documento?: string, excluirId?: number): Promise<ClienteSimilar[]> {
  const { data, error } = await supabase.rpc('buscar_clientes_similares', {
    p_nombre: nombre,
    p_documento: documento && documento.trim() ? documento.trim() : null,
    p_excluir_id: excluirId ?? null,
  })
  if (error) throw error
  return ((data ?? []) as ClienteSimilarRow[]).map((row) => ({
    id: row.id,
    nombre: row.nombre,
    razonSocial: row.razon_social,
    documento: row.documento,
    tipoPrecio: row.tipo_precio,
    activo: row.activo,
    motivo: row.motivo,
    similitud: Number(row.similitud),
  }))
}

/**
 * Reactivar un candidato inactivo que "vuelve" en vez de crear un duplicado. cliente no
 * tiene columna de versión (ver CustomerRepository.supabase.ts) y `save()` ya fuerza
 * `activo: true` en cada escritura sin importar el valor de entrada — reactivar es
 * simplemente releer el registro completo y volver a guardarlo tal cual, sin pisar
 * ningún campo que este formulario chico no conoce.
 */
export async function reactivarCliente(id: number, actorId: string): Promise<void> {
  const record = await customerRepository.getById(String(id))
  if (!record) throw new Error('Cliente no encontrado')
  await customerRepository.save(record, { actorId })
}
