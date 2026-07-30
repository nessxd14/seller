import { supabase } from './supabaseClient'
import type { TransferEstado, TransferLine, TransferMotivo, TransferRecord } from '../../application/shared/models'
import { NotFoundError } from '../../application/errors/AppError'
import { SUCURSAL_ALMACEN_ID, SUCURSAL_TIENDA_ID } from './mappers'

interface SolicitudTrasladoRow {
  id: number
  motivo: TransferMotivo
  estado: TransferEstado
  sucursal_origen_id: number
  sucursal_destino_id: number
  referencia: string | null
  nota: string | null
  solicitado_por: string
  solicitado_en: string
  despachado_por: string | null
  despachado_en: string | null
  recibido_por: string | null
  recibido_en: string | null
  creado_en: string
  reversible_hasta: string | null
}

interface SolicitudTrasladoLineaRow {
  id: number
  solicitud_id: number
  producto_id: number
  presentacion_id: number | null
  cantidad_presentacion: number | string | null
  cantidad_base: number | string
  cantidad_despachada: number | string | null
  cantidad_recibida: number | string | null
  nota: string | null
  producto?: { nombre: string; sku_interno: string | null } | null
  presentacion?: { nombre: string } | null
}

const num = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v))

const lineaRowToTransferLine = (row: SolicitudTrasladoLineaRow): TransferLine => ({
  id: String(row.id),
  productId: String(row.producto_id),
  name: row.producto?.nombre ?? '',
  sku: row.producto?.sku_interno ?? '',
  presentacionId: row.presentacion_id ?? undefined,
  presentacionNombre: row.presentacion?.nombre,
  cantidadPresentacion: row.cantidad_presentacion != null ? num(row.cantidad_presentacion) : undefined,
  cantidadBase: num(row.cantidad_base),
  cantidadDespachada: row.cantidad_despachada != null ? num(row.cantidad_despachada) : undefined,
  cantidadRecibida: row.cantidad_recibida != null ? num(row.cantidad_recibida) : undefined,
  nota: row.nota ?? undefined,
})

const rowToTransferRecord = (header: SolicitudTrasladoRow, lines: SolicitudTrasladoLineaRow[]): TransferRecord => ({
  id: String(header.id),
  motivo: header.motivo,
  estado: header.estado,
  sucursalOrigenId: header.sucursal_origen_id,
  sucursalDestinoId: header.sucursal_destino_id,
  referencia: header.referencia ?? undefined,
  nota: header.nota ?? undefined,
  solicitadoPor: header.solicitado_por,
  solicitadoEn: header.solicitado_en,
  despachadoPor: header.despachado_por ?? undefined,
  despachadoEn: header.despachado_en ?? undefined,
  recibidoPor: header.recibido_por ?? undefined,
  recibidoEn: header.recibido_en ?? undefined,
  creadoEn: header.creado_en,
  reversibleHasta: header.reversible_hasta ?? undefined,
  lines: lines.map(lineaRowToTransferLine),
})

const LINE_SELECT = '*, producto(nombre,sku_interno), presentacion(nombre)'

const fetchTransferById = async (id: number): Promise<TransferRecord | null> => {
  const { data: header, error: headerError } = await supabase.from('solicitud_traslado').select('*').eq('id', id).maybeSingle()
  if (headerError) throw headerError
  if (!header) return null
  const { data: lines, error: linesError } = await supabase.from('solicitud_traslado_linea').select(LINE_SELECT).eq('solicitud_id', id)
  if (linesError) throw linesError
  return rowToTransferRecord(header as SolicitudTrasladoRow, (lines ?? []) as SolicitudTrasladoLineaRow[])
}

export interface CreateTransferLineInput {
  productId: string
  presentacionId?: number
  cantidadPresentacion?: number
  cantidadBase?: number
  nota?: string
}

export interface CreateTransferInput {
  motivo: TransferMotivo
  lines: CreateTransferLineInput[]
  sucursalOrigenId?: number
  sucursalDestinoId?: number
  referencia?: string
  nota?: string
}

const buildLineasJsonb = (lines: CreateTransferLineInput[]) =>
  lines.map((line) => ({
    producto_id: Number(line.productId),
    ...(line.presentacionId != null
      ? { presentacion_id: line.presentacionId, cantidad_presentacion: line.cantidadPresentacion }
      : { cantidad_base: line.cantidadBase }),
    ...(line.nota ? { nota: line.nota } : {}),
  }))

export class SupabaseTransferRepository {
  async list(filters?: { estado?: TransferEstado }): Promise<TransferRecord[]> {
    let builder = supabase.from('solicitud_traslado').select('*')
    if (filters?.estado) builder = builder.eq('estado', filters.estado)
    const { data, error } = await builder.order('id', { ascending: false })
    if (error) throw error
    const headers = (data ?? []) as SolicitudTrasladoRow[]
    const ids = headers.map((h) => h.id)
    const { data: allLines, error: linesError } = ids.length
      ? await supabase.from('solicitud_traslado_linea').select(LINE_SELECT).in('solicitud_id', ids)
      : { data: [] as SolicitudTrasladoLineaRow[], error: null }
    if (linesError) throw linesError
    return headers.map((header) => rowToTransferRecord(header, (allLines ?? []).filter((l) => l.solicitud_id === header.id) as SolicitudTrasladoLineaRow[]))
  }

  async getById(id: string): Promise<TransferRecord | null> {
    const numericId = Number(id)
    if (!Number.isFinite(numericId)) return null
    return fetchTransferById(numericId)
  }

  async create(input: CreateTransferInput, actor: string): Promise<TransferRecord> {
    const { data: newId, error } = await supabase.rpc('crear_solicitud_traslado', {
      p_motivo: input.motivo,
      p_lineas: buildLineasJsonb(input.lines),
      p_usuario: actor,
      p_sucursal_origen_id: input.sucursalOrigenId ?? SUCURSAL_ALMACEN_ID,
      p_sucursal_destino_id: input.sucursalDestinoId ?? SUCURSAL_TIENDA_ID,
      p_referencia: input.referencia || null,
      p_nota: input.nota || null,
    })
    if (error) throw error
    const created = await fetchTransferById(newId as number)
    if (!created) throw new NotFoundError('No se pudo releer la solicitud de traslado recién creada')
    return created
  }

  // Brief K: "no reimplementar despachar_traslado/recibir_traslado en el frontend" — se
  // llama por RPC, tal cual receive() ya hacía con recibir_traslado.
  async dispatch(id: string, actor: string): Promise<TransferRecord> {
    const numericId = Number(id)
    const { error } = await supabase.rpc('despachar_traslado', { p_solicitud_id: numericId, p_usuario: actor })
    if (error) throw error
    const updated = await fetchTransferById(numericId)
    if (!updated) throw new NotFoundError('No se pudo releer la solicitud de traslado despachada')
    return updated
  }

  // revertir_traslado ya decide todo el comportamiento (SOLICITADO cancela sin tocar
  // Kardex, EN_TRANSITO dentro de ventana revierte el Kardex a las ubicaciones exactas de
  // origen, fuera de ventana o RECIBIDO rechaza) — acá solo se llama y se relee la fila.
  async revert(id: string, actor: string, nota?: string): Promise<TransferRecord> {
    const numericId = Number(id)
    const { error } = await supabase.rpc('revertir_traslado', { p_solicitud_id: numericId, p_usuario: actor, p_nota: nota || null })
    if (error) throw error
    const updated = await fetchTransferById(numericId)
    if (!updated) throw new NotFoundError('No se pudo releer la solicitud de traslado revertida')
    return updated
  }

  async receive(id: string, lines: null | Array<{ lineaId: string; cantidadBase: number }>, actor: string): Promise<TransferRecord> {
    const numericId = Number(id)
    const { error } = await supabase.rpc('recibir_traslado', {
      p_solicitud_id: numericId,
      p_usuario: actor,
      p_lineas: lines ? lines.map((l) => ({ linea_id: Number(l.lineaId), cantidad_base: l.cantidadBase })) : null,
    })
    if (error) throw error
    const updated = await fetchTransferById(numericId)
    if (!updated) throw new NotFoundError('No se pudo releer la solicitud de traslado recibida')
    return updated
  }

  async cancel(id: string, actor: string, nota?: string): Promise<TransferRecord> {
    const numericId = Number(id)
    const { error } = await supabase.rpc('cerrar_solicitud_traslado', {
      p_solicitud_id: numericId,
      p_estado: 'CANCELADO',
      p_usuario: actor,
      p_nota: nota || null,
    })
    if (error) throw error
    const updated = await fetchTransferById(numericId)
    if (!updated) throw new NotFoundError('No se pudo releer la solicitud de traslado cancelada')
    return updated
  }
}

export const transferRepository = new SupabaseTransferRepository()
