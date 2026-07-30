import type { TransferEstado, TransferLine, TransferRecord } from '../../application/shared/models'
import { LocalStorageRepository } from './localStore'
import { products } from '../../data/products'

const SUCURSAL_ALMACEN_ID = 1
const SUCURSAL_TIENDA_ID = 2

const productAt = (index: number) => products[index % products.length]

const seedLine = (productId: number, cantidadBase: number, cantidadDespachada?: number, cantidadRecibida?: number): TransferLine => {
  const product = products.find((p) => p.id === productId) ?? productAt(0)
  return {
    id: crypto.randomUUID(),
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
      id: crypto.randomUUID(),
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
          id: crypto.randomUUID(),
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
  async dispatch(id: string, actor: string): Promise<TransferRecord> {
    const existing = await store.get(id)
    if (!existing) throw new Error('Solicitud de traslado no encontrada')
    if (existing.estado !== 'SOLICITADO') throw new Error(`La solicitud está en estado ${existing.estado} y no se puede despachar`)
    const updated: TransferRecord = {
      ...existing,
      estado: 'EN_TRANSITO',
      despachadoPor: actor,
      despachadoEn: now(),
      reversibleHasta: new Date(Date.now() + 30 * 60_000).toISOString(),
      lines: existing.lines.map((line) => ({ ...line, cantidadDespachada: line.cantidadBase })),
    }
    return store.save(updated)
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
    const updatedLines = existing.lines.map((line) => {
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
