import type { TransferDispatchLine, TransferEstado, TransferLine, TransferRecord } from '../../application/shared/models'
import { pendienteTraslado, recibibleTraslado } from '../../domain/sales/transfers'
import { LocalStorageRepository } from './localStore'
import { createUuid } from '../../application/shared/createUuid'
import { products } from '../../data/products'
import { SUCURSAL_ALMACEN_ID, SUCURSAL_TIENDA_ID } from '../supabase/mappers'

const productAt = (index: number) => products[index % products.length]

const seedLine = (productId: number, cantidadBase: number, cantidadDespachada?: number, cantidadRecibida?: number): TransferLine => {
  const product = products.find((p) => p.id === productId) ?? productAt(0)
  return {
    id: createUuid(),
    productId: String(product.id),
    name: product.nombre,
    sku: product.sku,
    cantidadBase,
    cantidadDespachada,
    cantidadRecibida,
  }
}

const now = () => new Date().toISOString()
const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString()

// A handful of transfers in different states so the UI has something to exercise in mock
// mode, mirroring how seeds.ts seeds quotes/orders/customers.
const transferSeeds: TransferRecord[] = [
  {
    id: 'transfer-seed-1',
    numero: 'TRA-2026-00001',
    motivo: 'VENTA_DIRECTA',
    estado: 'SOLICITADO',
    sucursalOrigenId: SUCURSAL_ALMACEN_ID,
    sucursalDestinoId: SUCURSAL_TIENDA_ID,
    referencia: 'TR-0001',
    solicitadoPor: 'Cajera Demo',
    solicitadoEn: daysAgo(1),
    creadoEn: daysAgo(1),
    lines: [seedLine(1, 10)],
  },
  {
    id: 'transfer-seed-2',
    numero: 'TRA-2026-00002',
    motivo: 'REPOSICION',
    estado: 'EN_TRANSITO',
    sucursalOrigenId: SUCURSAL_ALMACEN_ID,
    sucursalDestinoId: SUCURSAL_TIENDA_ID,
    referencia: 'TR-0002',
    solicitadoPor: 'Cajera Demo',
    solicitadoEn: daysAgo(3),
    despachadoPor: 'Almacén Demo',
    despachadoEn: daysAgo(2),
    creadoEn: daysAgo(3),
    lines: [seedLine(3, 24, 24)],
  },
  {
    id: 'transfer-seed-3',
    numero: 'TRA-2026-00003',
    motivo: 'VENTA_DIRECTA',
    estado: 'RECIBIDO',
    sucursalOrigenId: SUCURSAL_ALMACEN_ID,
    sucursalDestinoId: SUCURSAL_TIENDA_ID,
    referencia: 'TR-0003',
    solicitadoPor: 'Cajera Demo',
    solicitadoEn: daysAgo(6),
    despachadoPor: 'Almacén Demo',
    despachadoEn: daysAgo(5),
    recibidoPor: 'Cajera Demo',
    recibidoEn: daysAgo(4),
    creadoEn: daysAgo(6),
    lines: [seedLine(4, 5, 5, 5)],
  },
  {
    id: 'transfer-seed-4',
    numero: 'TRA-2026-00004',
    motivo: 'REPOSICION',
    estado: 'CANCELADO',
    sucursalOrigenId: SUCURSAL_ALMACEN_ID,
    sucursalDestinoId: SUCURSAL_TIENDA_ID,
    referencia: 'TR-0004',
    solicitadoPor: 'Cajera Demo',
    solicitadoEn: daysAgo(8),
    creadoEn: daysAgo(8),
    lines: [seedLine(6, 12)],
  },
]

const store = new LocalStorageRepository<TransferRecord>('roari-transfers-v1', transferSeeds)

export interface CreateTransferLineInput {
  productId: string
  presentacionId?: number
  cantidadPresentacion?: number
  cantidadBase?: number
  nota?: string
}

export interface CreateTransferInput {
  motivo: TransferRecord['motivo']
  lines: CreateTransferLineInput[]
  sucursalOrigenId?: number
  sucursalDestinoId?: number
  referencia?: string
  nota?: string
}

export const transferService = {
  async list(filters?: { estado?: TransferEstado }): Promise<TransferRecord[]> {
    const all = await store.list()
    const filtered = filters?.estado ? all.filter((t) => t.estado === filters.estado) : all
    return filtered.sort((a, b) => new Date(b.creadoEn).getTime() - new Date(a.creadoEn).getTime())
  },
  async getById(id: string): Promise<TransferRecord | null> {
    return store.get(id)
  },
  async create(input: CreateTransferInput, actor: string): Promise<TransferRecord> {
    const record: TransferRecord = {
      id: createUuid(),
      // Modo mock: no hay trigger de base que numere — se simula uno correlativo simple.
      numero: `TRA-2026-${String((await store.list()).length + 1).padStart(5, '0')}`,
      motivo: input.motivo,
      estado: 'SOLICITADO',
      sucursalOrigenId: input.sucursalOrigenId ?? SUCURSAL_ALMACEN_ID,
      sucursalDestinoId: input.sucursalDestinoId ?? SUCURSAL_TIENDA_ID,
      referencia: input.referencia,
      nota: input.nota,
      solicitadoPor: actor,
      solicitadoEn: now(),
      creadoEn: now(),
      lines: input.lines.map((line) => {
        const product = products.find((p) => String(p.id) === line.productId)
        const cantidadBase = line.presentacionId != null ? (line.cantidadPresentacion ?? 1) : (line.cantidadBase ?? 1)
        return {
          id: createUuid(),
          productId: line.productId,
          name: product?.nombre ?? '',
          sku: product?.sku ?? '',
          presentacionId: line.presentacionId,
          cantidadPresentacion: line.cantidadPresentacion,
          cantidadBase,
          nota: line.nota,
        }
      }),
    }
    // Mock mode has no dispatch step to simulate — the create-time seed is enough for the
    // UI to exercise SOLICITADO -> (dev can flip it manually) states; no real stock ledger
    // exists to reconcile against, matching mock checkout's "lightweight" precedent.
    return store.save(record)
  },
  // Brief K — mock equivalents of despachar_traslado/revertir_traslado. Mock mode has no
  // Kardex to reconcile against, so this only mirrors the state-machine + reversible_hasta
  // window the UI depends on (so the countdown / "Registrar devolución" fallback are both
  // exercisable in mock mode too).
  async dispatch(id: string, actor: string, lines?: TransferDispatchLine[]): Promise<TransferRecord> {
    const existing = await store.get(id)
    if (!existing) throw new Error('Solicitud de traslado no encontrada')
    if (existing.estado !== 'SOLICITADO') throw new Error(`La solicitud está en estado ${existing.estado} y no se puede despachar`)
    const updatedLines = existing.lines.map((line) => {
      if (!pendienteTraslado(line)) return line
      const choice = lines?.find((l) => l.lineaId === line.id)
      const accion = lines ? choice?.accion ?? 'FALTANTE' : 'DESPACHAR'
      const quantity = choice?.cantidadBase ?? line.cantidadBase
      if (accion === 'DESPACHAR' && (!Number.isFinite(quantity) || quantity <= 0 || quantity > line.cantidadBase)) throw new Error('La cantidad debe estar entre 0 y lo solicitado')
      return { ...line, estado: accion === 'DESPACHAR' ? 'DESPACHADA' as const : accion === 'RECHAZAR' ? 'RECHAZADO' as const : 'CAMBIADA' as const, cantidadDespachada: accion === 'DESPACHAR' ? quantity : 0 }
    })
    const faltantes = updatedLines.filter((l) => l.estado === 'CAMBIADA' || (l.estado === 'DESPACHADA' && l.cantidadDespachada! < l.cantidadBase))
    const tanda = faltantes.length ? await this.create({ motivo: existing.motivo, sucursalOrigenId: existing.sucursalOrigenId, sucursalDestinoId: existing.sucursalDestinoId, lines: faltantes.map((l) => ({ productId: l.productId, cantidadBase: l.cantidadBase - (l.cantidadDespachada ?? 0) })) }, actor) : null
    if (tanda) await store.save({ ...tanda, tandaDeId: existing.id, numeroTanda: (existing.numeroTanda ?? 1) + 1 })
    const total = updatedLines.reduce((sum, l) => sum + (l.cantidadDespachada ?? 0), 0)
    const updated: TransferRecord = {
      ...existing,
      estado: total > 0 ? 'EN_TRANSITO' : 'CANCELADO',
      despachadoPor: actor,
      despachadoEn: now(),
      reversibleHasta: new Date(Date.now() + 30 * 60_000).toISOString(),
      lines: updatedLines,
      resultadoDespacho: { estado: total > 0 ? 'EN_TRANSITO' : 'CANCELADO', cantidad_despachada: total, tanda_faltante_id: tanda?.id, parciales: updatedLines.filter((l) => l.estado === 'DESPACHADA' && l.cantidadDespachada! < l.cantidadBase).map((l) => ({ linea_id: l.id, pedido: l.cantidadBase, despachado: l.cantidadDespachada!, saldo: l.cantidadBase - l.cantidadDespachada! })) },
    }
    return store.save(updated)
  },
  async recover(id: string, actor: string): Promise<{ tandaFaltanteId?: string; recuperadas: number }> {
    const existing = await store.get(id)
    if (!existing || !['EN_TRANSITO', 'RECIBIDO'].includes(existing.estado)) throw new Error('El traslado debe estar despachado')
    const pending = existing.lines.filter(pendienteTraslado)
    if (!pending.length) return { recuperadas: 0 }
    const tanda = await this.create({ motivo: existing.motivo, sucursalOrigenId: existing.sucursalOrigenId, sucursalDestinoId: existing.sucursalDestinoId, lines: pending.map((l) => ({ productId: l.productId, cantidadBase: l.cantidadBase })) }, actor)
    await store.save({ ...tanda, tandaDeId: id, numeroTanda: (existing.numeroTanda ?? 1) + 1 })
    await store.save({ ...existing, lines: existing.lines.map((l) => pendienteTraslado(l) ? { ...l, estado: 'CAMBIADA' } : l) })
    return { tandaFaltanteId: tanda.id, recuperadas: pending.length }
  },
  async revert(id: string, actor: string, nota?: string): Promise<TransferRecord> {
    void actor
    const existing = await store.get(id)
    if (!existing) throw new Error('Solicitud de traslado no encontrada')
    if (existing.estado === 'SOLICITADO') {
      return store.save({ ...existing, estado: 'CANCELADO', nota: nota || existing.nota || 'Cancelado antes de despachar' })
    }
    if (existing.estado !== 'EN_TRANSITO') {
      throw new Error(`La solicitud está en estado ${existing.estado}; después de recibida se registra una devolución, no una reversión`)
    }
    if (!existing.reversibleHasta || new Date(existing.reversibleHasta) < new Date()) {
      throw new Error('La ventana de reversión venció. Registrá una devolución Tienda -> Almacén.')
    }
    return store.save({
      ...existing,
      estado: 'CANCELADO',
      reversibleHasta: undefined,
      nota: nota || existing.nota || 'Revertido dentro de la ventana',
      lines: existing.lines.map((line) => ({ ...line, cantidadDespachada: 0 })),
    })
  },
  async receive(id: string, lines: null | Array<{ lineaId: string; cantidadBase: number }>, actor: string): Promise<TransferRecord> {
    const existing = await store.get(id)
    if (!existing) throw new Error('Solicitud de traslado no encontrada')
    if (existing.estado !== 'EN_TRANSITO') throw new Error('El traslado no está en tránsito')
    if (existing.lines.some(pendienteTraslado)) throw new Error('Recupera primero las líneas sin salida')
    const updatedLines = existing.lines.map((line) => {
      if (!recibibleTraslado(line)) return line
      const override = lines?.find((l) => l.lineaId === line.id)
      const recibida = override ? override.cantidadBase : (line.cantidadDespachada ?? line.cantidadBase)
      return { ...line, cantidadRecibida: recibida }
    })
    const updated: TransferRecord = { ...existing, estado: 'RECIBIDO', lines: updatedLines, recibidoPor: actor, recibidoEn: now() }
    return store.save(updated)
  },
  async cancel(id: string, actor: string, nota?: string): Promise<TransferRecord> {
    const existing = await store.get(id)
    if (!existing) throw new Error('Solicitud de traslado no encontrada')
    const updated: TransferRecord = { ...existing, estado: 'CANCELADO', nota: nota || existing.nota }
    void actor
    return store.save(updated)
  },
}
