import { supabase } from './supabaseClient'

// Brief S-C: cliente_contacto/buscar_contactos son capacidades solo-Supabase, sin
// equivalente mock (viven en Cation) — se importan directo en el componente, gateado por
// featureFlags.supabase, mismo patrón que CustomerSimilarity.supabase.ts.
export interface ContactoCliente {
  id: string
  nombre: string
  cargo: string | null
  telefono: string | null
  email: string | null
  tope: number | null
}

interface ContactoRow {
  id: number
  nombre: string
  cargo: string | null
  telefono: string | null
  email: string | null
  tope: number | string | null
  similitud: number
}

const rowToContacto = (row: ContactoRow): ContactoCliente => ({
  id: String(row.id),
  nombre: row.nombre,
  cargo: row.cargo,
  telefono: row.telefono,
  email: row.email,
  tope: row.tope != null ? Number(row.tope) : null,
})

export async function buscarContactos(clienteId: string, texto: string | null): Promise<ContactoCliente[]> {
  const { data, error } = await supabase.rpc('buscar_contactos', {
    p_cliente_id: Number(clienteId),
    p_texto: texto,
  })
  if (error) throw error
  return ((data ?? []) as ContactoRow[]).map(rowToContacto)
}

export interface NuevoContactoInput {
  nombre: string
  cargo?: string
  telefono?: string
  email?: string
}

export async function crearContacto(clienteId: string, input: NuevoContactoInput, actorId: string): Promise<ContactoCliente> {
  const { data, error } = await supabase
    .from('cliente_contacto')
    .insert({
      cliente_id: Number(clienteId),
      nombre: input.nombre.trim(),
      cargo: input.cargo?.trim() || null,
      telefono: input.telefono?.trim() || null,
      email: input.email?.trim() || null,
      creado_por: actorId,
    })
    .select('id, nombre, cargo, telefono, email, tope_autorizado')
    .single()
  if (error) throw error
  const row = data as { id: number; nombre: string; cargo: string | null; telefono: string | null; email: string | null; tope_autorizado: number | string | null }
  return { id: String(row.id), nombre: row.nombre, cargo: row.cargo, telefono: row.telefono, email: row.email, tope: row.tope_autorizado != null ? Number(row.tope_autorizado) : null }
}
