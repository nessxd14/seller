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
  // Brief S-H: Bs, no centavos — mismo criterio que ContactoCliente.tope. undefined = sin
  // tope propio (no 0); si el contacto no tiene uno, resolver_tope cae al de la institución.
  topeAutorizado?: number
}

// Brief S-G: evaluar_tope ya arma el texto del aviso del lado de la base (motivo_advertencia)
// a propósito, para que Seller y Conciliador digan siempre lo mismo sobre el mismo hecho —
// se muestra tal cual acá, sin reescribirlo ni resumirlo. origen ('CONTACTO'/'INSTITUCION'/
// 'SIN_TOPE') no se muestra aparte: ya está incorporado en el texto de motivoAdvertencia.
export interface TopeEvaluacion {
  dentroDelTope: boolean
  tope: number | null
  origen: 'CONTACTO' | 'INSTITUCION' | 'SIN_TOPE'
  motivoAdvertencia: string | null
}

interface TopeRow {
  dentro_del_tope: boolean
  tope: number | string | null
  origen: 'CONTACTO' | 'INSTITUCION' | 'SIN_TOPE'
  motivo_advertencia: string | null
}

export async function evaluarTope(clienteId: string, contactoId: string, montoCents: number): Promise<TopeEvaluacion> {
  const { data, error } = await supabase.rpc('evaluar_tope', {
    p_cliente_id: Number(clienteId),
    p_contacto_id: Number(contactoId),
    p_monto: Math.round(montoCents) / 100,
  })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as TopeRow | null
  return {
    dentroDelTope: row?.dentro_del_tope !== false,
    tope: row?.tope != null ? Number(row.tope) : null,
    origen: row?.origen ?? 'SIN_TOPE',
    motivoAdvertencia: row?.motivo_advertencia ?? null,
  }
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
      tope_autorizado: input.topeAutorizado ?? null,
      creado_por: actorId,
    })
    .select('id, nombre, cargo, telefono, email, tope_autorizado')
    .single()
  if (error) throw error
  const row = data as { id: number; nombre: string; cargo: string | null; telefono: string | null; email: string | null; tope_autorizado: number | string | null }
  return { id: String(row.id), nombre: row.nombre, cargo: row.cargo, telefono: row.telefono, email: row.email, tope: row.tope_autorizado != null ? Number(row.tope_autorizado) : null }
}
