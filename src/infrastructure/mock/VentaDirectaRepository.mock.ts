import type { VentaDirectaRecord, VtdLine } from '../../application/shared/models'
import { LocalStorageRepository } from './localStore'
import { products } from '../../data/products'

const SUCURSAL_ALMACEN_ID = 1

export interface UbicacionOption { id: number; label: string }

// El mock no tiene tabla `ubicacion` real — un puñado fijo alcanza para ejercitar el
// selector "si hay más de una, el cajero elige" (brief 2.1) en modo demo.
const MOCK_UBICACIONES: UbicacionOption[] = [
  { id: 1, label: 'HUECO · Estante 1 A' },
  { id: 2, label: 'PLANTA BAJA · Estante 1 A' },
  { id: 3, label: 'PLANTA ARRIBA · Pallet 1' },
]

const now = () => new Date().toISOString()

const store = new LocalStorageRepository<VentaDirectaRecord>('roari-vtd-v1', [])

const buildLines = (lines: Array<{ productId: string; presentacionId?: number; cantidadPresentacion: number; unitPriceCents: number }>): VtdLine[] =>
  lines.map((line) => {
    const product = products.find((p) => String(p.id) === line.productId)
    return {
      id: crypto.randomUUID(),
      productId: line.productId,
      name: product?.nombre ?? '',
      sku: product?.sku ?? '',
      presentacionId: line.presentacionId,
      cantidadPresentacion: line.cantidadPresentacion,
      precioUnitarioCents: line.unitPriceCents,
    }
  })

export const ventaDirectaMockRepository = {
  async listUbicaciones(): Promise<UbicacionOption[]> {
    void SUCURSAL_ALMACEN_ID
    return MOCK_UBICACIONES
  },
  async listAbiertas(sesionCajaId: string): Promise<VentaDirectaRecord[]> {
    const all = await store.list()
    return all.filter((v) => v.estado === 'ABIERTA' && v.sesionCajaId === sesionCajaId).sort((a, b) => new Date(a.creadoEn).getTime() - new Date(b.creadoEn).getTime())
  },
  async getById(id: string): Promise<VentaDirectaRecord | null> {
    return store.get(id)
  },
  async abrir(input: { lines: Array<{ productId: string; presentacionId?: number; cantidadPresentacion: number; unitPriceCents: number; listPriceCents?: number }>; ubicacionId: number; cashSessionId: string; payments?: Array<{ method: string; amountCents: number }>; customerId?: string; discountCents?: number }, actor: string): Promise<VentaDirectaRecord> {
    const subtotalCents = input.lines.reduce((sum, l) => sum + l.unitPriceCents * l.cantidadPresentacion, 0)
    const discountCents = input.discountCents ?? 0
    const totalCents = subtotalCents - discountCents
    const paidCents = (input.payments ?? []).reduce((sum, p) => sum + p.amountCents, 0)
    const numeroSecuencia = (await store.list()).length + 1
    const record: VentaDirectaRecord = {
      id: crypto.randomUUID(),
      numero: `VTD-2026-${String(numeroSecuencia).padStart(5, '0')}`,
      estado: 'ABIERTA',
      modo: paidCents > 0 ? 'PRECOBRADO' : 'POSTCOBRADO',
      ubicacionId: input.ubicacionId,
      sesionCajaId: input.cashSessionId,
      customerId: input.customerId,
      subtotalCents,
      discountCents,
      totalCents,
      paidCents,
      creadoPor: actor,
      creadoEn: now(),
      lines: buildLines(input.lines),
    }
    return store.save(record)
  },
  async completar(id: string): Promise<VentaDirectaRecord> {
    const existing = await store.get(id)
    if (!existing) throw new Error('Venta directa no encontrada')
    if (existing.estado !== 'ABIERTA') throw new Error(`Venta % está en estado ${existing.estado} y no admite checkout`)
    return store.save({ ...existing, estado: 'COMPLETADA', completadoEn: now() })
  },
  async ajustar(id: string, ajustes: Array<{ lineaId: string; cantidadPresentacion: number }>): Promise<VentaDirectaRecord> {
    const existing = await store.get(id)
    if (!existing) throw new Error('Venta directa no encontrada')
    if (existing.estado !== 'ABIERTA') throw new Error('Solo se puede ajustar una venta ABIERTA')
    for (const ajuste of ajustes) {
      const linea = existing.lines.find((l) => l.id === ajuste.lineaId)
      if (linea && ajuste.cantidadPresentacion > linea.cantidadPresentacion) throw new Error('Solo se puede reducir. Para vender más, crear una venta nueva.')
    }
    const lines = existing.lines
      .map((line) => {
        const ajuste = ajustes.find((a) => a.lineaId === line.id)
        return ajuste ? { ...line, cantidadPresentacion: ajuste.cantidadPresentacion } : line
      })
      .filter((line) => line.cantidadPresentacion > 0)
    if (!lines.length) {
      const err = new Error('El ajuste deja la venta sin ninguna unidad. Eso es una anulación: usar anular_venta.')
      Object.assign(err, { code: '42501' })
      throw err
    }
    const subtotalCents = lines.reduce((sum, l) => sum + l.precioUnitarioCents * l.cantidadPresentacion, 0)
    return store.save({ ...existing, lines, subtotalCents, totalCents: subtotalCents - existing.discountCents })
  },
  async anular(id: string): Promise<VentaDirectaRecord> {
    const existing = await store.get(id)
    if (!existing) throw new Error('Venta directa no encontrada')
    return store.save({ ...existing, estado: 'ANULADA' })
  },
}
