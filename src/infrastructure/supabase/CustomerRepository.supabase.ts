import { supabase } from './supabaseClient'
import type { CustomerRepository, MutationContext, Page, PageRequest, Versioned } from '../../application/ports/repositories'
import type { CustomerRecord } from '../../application/shared/models'
import { customerTypeToTipoPrecio, tipoPrecioToCustomerType, type TipoPrecioCliente } from './mappers'
import { coincideBusqueda } from '../../domain/customers/textSearch'

interface ClienteRow {
  id: number
  nombre: string
  tipo_precio: TipoPrecioCliente
  documento: string | null
  telefono: string | null
  email: string | null
  direccion: string | null
  activo: boolean
  creado_en: string
  actualizado_en: string | null
  origen: string | null
  ciudad: string | null
  razon_social: string | null
}

const rowToCustomer = (row: ClienteRow): CustomerRecord & Versioned => ({
  id: String(row.id),
  name: row.nombre,
  type: tipoPrecioToCustomerType(row.tipo_precio),
  document: row.documento ?? '',
  phone: row.telefono ?? '',
  email: row.email ?? '',
  address: row.direccion ?? '',
  // cliente has no notion of "usual channel" / credit terms in this schema; these
  // fields are UI-only conveniences preserved for compatibility with mock consumers.
  // Brief M: el fallback `: row.tipo_precio` funcionaba antes por coincidencia (retail y
  // municipal eran valores válidos de SalesChannel) — con el rename, 'corporativo' ya no
  // lo es. Mapeo explícito que preserva el mismo canal de precio por defecto que cada
  // categoría tenía antes del rename.
  usualChannel: row.tipo_precio === 'mayorista' ? 'mayoreo'
    : row.tipo_precio === 'corporativo' ? 'institucional'
    : row.tipo_precio === 'institucion' ? 'municipal'
    : 'retail',
  paymentTerms: 'Contado',
  origin: row.origen === 'shopify' ? 'shopify' : 'manual',
  businessName: row.razon_social ?? undefined,
  city: row.ciudad ?? undefined,
  // cliente has no version column: not optimistically locked at the DB level.
  version: 1,
  updatedAt: row.actualizado_en ?? row.creado_en,
})

export class SupabaseCustomerRepository implements CustomerRepository {
  async list(input: { query?: string; type?: CustomerRecord['type']; page: PageRequest }): Promise<Page<CustomerRecord & Versioned>> {
    const { query, type, page } = input
    const trimmedQuery = query?.trim()
    let builder = supabase.from('cliente').select('*', { count: trimmedQuery ? undefined : 'exact' })
    if (type) builder = builder.eq('tipo_precio', customerTypeToTipoPrecio(type))
    if (!trimmedQuery) {
      const from = (page.page - 1) * page.pageSize
      const to = from + page.pageSize - 1
      const { data, error, count } = await builder.order('id', { ascending: false }).range(from, to)
      if (error) throw error
      return { items: (data ?? []).map((row) => rowToCustomer(row as ClienteRow)), page: page.page, pageSize: page.pageSize, total: count ?? 0 }
    }
    // Brief T2 Tarea 3: `ilike` es case-insensitive pero no ignora acentos ("jose perez" no
    // matchea "José Pérez" en la base) — se trae el candidato completo (padrón chico, <100
    // clientes hoy) y se filtra/pagina en JS con la misma normalización que usa el resto del
    // buscador, en vez de un filtro ilike server-side que se queda corto con datos acentuados.
    const { data, error } = await builder.order('id', { ascending: false })
    if (error) throw error
    const all = (data ?? []).map((row) => rowToCustomer(row as ClienteRow))
    const matched = all.filter((c) => coincideBusqueda(`${c.name} ${c.document} ${c.businessName ?? ''} ${c.email}`, trimmedQuery))
    const from = (page.page - 1) * page.pageSize
    return { items: matched.slice(from, from + page.pageSize), page: page.page, pageSize: page.pageSize, total: matched.length }
  }

  async getById(id: string): Promise<(CustomerRecord & Versioned) | null> {
    const numericId = Number(id)
    if (!Number.isFinite(numericId)) return null
    const { data, error } = await supabase.from('cliente').select('*').eq('id', numericId).maybeSingle()
    if (error) throw error
    return data ? rowToCustomer(data as ClienteRow) : null
  }

  /** cliente has no version column, so writes are always allowed (no fake optimistic locking). */
  async save(value: CustomerRecord & Partial<Versioned>, context: MutationContext): Promise<CustomerRecord & Versioned> {
    void context // cliente has no version column: writes are always allowed, context is unused
    const payload = {
      nombre: value.name,
      tipo_precio: customerTypeToTipoPrecio(value.type),
      documento: value.document || null,
      telefono: value.phone || null,
      email: value.email || null,
      direccion: value.address || null,
      ciudad: value.city || null,
      razon_social: value.businessName || null,
      activo: true,
      actualizado_en: new Date().toISOString(),
    }
    const numericId = Number(value.id)
    if (value.id && Number.isFinite(numericId)) {
      const { data, error } = await supabase.from('cliente').update(payload).eq('id', numericId).select('*').single()
      if (error) throw error
      return rowToCustomer(data as ClienteRow)
    }
    const { data, error } = await supabase.from('cliente').insert({ ...payload, creado_en: new Date().toISOString() }).select('*').single()
    if (error) throw error
    return rowToCustomer(data as ClienteRow)
  }
}

export const customerRepository = new SupabaseCustomerRepository()
