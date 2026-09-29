import type { CobrarVtdResultado, VentaDirectaRecord, VtdLine, VtdPorCobrar } from '../../application/shared/models'
import type { SaleCheckoutPayment } from '../../application/ports/repositories'
import { LocalStorageRepository } from './localStore'
import { products } from '../../data/products'

// Brief ubicación fija: mismo id fijo que la ubicación real 'VENTAS DIRECTAS' en
// Supabase — el mock no tiene tabla `ubicacion`, así que alcanza con un valor
// constante, consistente con getUbicacionVentasDirectas() del adaptador Supabase.
const UBICACION_VENTAS_DIRECTAS_ID = 1

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
  async getUbicacionVentasDirectas(): Promise<number> {
    return UBICACION_VENTAS_DIRECTAS_ID
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
      cobroExigible: true,
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
  // motivo no se persiste en el mock — venta_evento es una tabla real de Supabase, sin
  // equivalente local; alcanza con aceptar el parámetro para no divergir de la firma.
  async ajustar(id: string, ajustes: Array<{ lineaId: string; cantidadPresentacion: number }>, motivo?: string): Promise<VentaDirectaRecord> {
    void motivo
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
  // Brief Caja VTD: réplica simple de v_vtd_por_cobrar — exigible, no anulado, sin pago.
  async listPorCobrar(): Promise<VtdPorCobrar[]> {
    const all = await store.list()
    return all
      .filter((v) => v.cobroExigible && v.estado !== 'ANULADA' && v.paidCents === 0)
      .map((v) => ({
        ventaId: v.id, numero: v.numero, estado: v.estado as 'ABIERTA' | 'COMPLETADA',
        clienteId: v.customerId, clienteNombre: v.customerName, totalBs: v.totalCents / 100,
        creadoPor: v.creadoPor, creadoEn: v.creadoEn, sesionCreacionId: v.sesionCajaId,
      }))
  },
  // Réplica simple de cobrar_vtd: exige que la suma de pagos calce con el total exacto.
  async cobrarVtd(input: { ventaIds: string[]; sesionCajaId: string; pagos: SaleCheckoutPayment[] }): Promise<CobrarVtdResultado> {
    const ventas = await Promise.all(input.ventaIds.map((id) => store.get(id)))
    const faltante = ventas.findIndex((v) => !v)
    if (faltante !== -1) throw new Error(`Venta directa ${input.ventaIds[faltante]} no encontrada`)
    const found = ventas as VentaDirectaRecord[]
    const anulada = found.find((v) => v.estado === 'ANULADA')
    if (anulada) throw new Error(`${anulada.numero} está anulada`)
    const yaCobrada = found.find((v) => v.paidCents > 0)
    if (yaCobrada) throw new Error(`${yaCobrada.numero} ya está cobrada`)
    const totalCents = found.reduce((sum, v) => sum + v.totalCents, 0)
    const pagosCents = input.pagos.reduce((sum, p) => sum + p.amountCents, 0)
    if (pagosCents !== totalCents) throw new Error('El total de los pagos no coincide con el total a cobrar')
    const recibidoCents = input.pagos.filter((p) => p.method === 'cash').reduce((sum, p) => sum + (p.receivedCents ?? p.amountCents), 0)
    const efectivoCents = input.pagos.filter((p) => p.method === 'cash').reduce((sum, p) => sum + p.amountCents, 0)
    for (const venta of found) await store.save({ ...venta, paidCents: venta.totalCents, modo: 'PRECOBRADO' })
    return {
      reintento: false,
      sesionCajaId: input.sesionCajaId,
      ventas: found.map((v) => ({ ventaId: v.id, numero: v.numero, totalBs: v.totalCents / 100, estado: v.estado })),
      totalBs: totalCents / 100,
      cambioBs: Math.max(0, recibidoCents - efectivoCents) / 100,
      pendienteVerificacion: input.pagos.some((p) => p.method === 'qr' || p.method === 'transfer'),
    }
  },
}
