import type { CartItem, SalesChannel } from '../../types'
import type { CartCustomer } from '../../context/PosContext'
import type { PedidoEnCarrito } from './cajaCheckout'

export interface CajaAlmacenDraft {
  cart: CartItem[]
  channel: SalesChannel
  discount: number
  customer: CartCustomer | null
  pedido: PedidoEnCarrito | null
  vendedorId?: string
}
export interface CajaAlmacenVtdLinea {
  linea_id: number
  nombre: string
  presentacion: string
  cantidad_presentacion: number
}
export interface CajaAlmacenVtd {
  venta_id: number
  numero: string
  total: number
  cliente_id: number | null
  cliente: string | null
  estado: 'SOLICITADO' | 'EN_CAJA' | 'ENTREGADO' | 'RETORNO_PENDIENTE' | 'RETORNADO' | 'CANCELADO'
  version: number
  // Reporte abierto de Almacén (cantidad realmente disponible por línea); null = sin reporte.
  faltante?: { linea_id: number; cantidad_presentacion_disponible: number }[] | null
  lineas?: CajaAlmacenVtdLinea[]
}
export interface CajaAlmacenRecord {
  operacion: null | {
    id: string
    sesion_id: number
    cajero_id: string
    estado: 'ACTIVA' | 'COBRADA' | 'COMPLETADA' | 'RECHAZADA'
    revision: number
    borrador: Partial<CajaAlmacenDraft>
    comprobante: { id: number; numero: string; total: number } | null
    cerrado_en: string | null
  }
  vtds: CajaAlmacenVtd[]
}
export type CajaAlmacenEnEsperaOperacion = CajaAlmacenRecord & { operacion: NonNullable<CajaAlmacenRecord['operacion']>; turno_cerrado: boolean }
export interface CajaAlmacenEnEsperaList { operaciones: CajaAlmacenEnEsperaOperacion[] }
export const vtdEstadoLabels: Record<string, string> = { SOLICITADO: 'Pendiente de verificación de Almacén', EN_CAJA: 'Material enviado a Caja', ENTREGADO: 'Entrega confirmada', RETORNO_PENDIENTE: 'Material en retorno a Almacén', RETORNADO: 'Retorno recibido en Almacén', CANCELADO: 'Solicitud cancelada antes de salir' }
// «Almacén tiene 5 de 6» — suma de lo disponible contra lo pedido, en las líneas del reporte.
export const faltanteTexto = (v: Pick<CajaAlmacenVtd, 'faltante' | 'lineas'>) => {
  const reportes = v.faltante ?? []
  const lineas = v.lineas ?? []
  const pedido = lineas.filter(l => reportes.some(f => f.linea_id === l.linea_id)).reduce((s, l) => s + l.cantidad_presentacion, 0)
  const tiene = reportes.reduce((s, f) => s + f.cantidad_presentacion_disponible, 0)
  return `Almacén tiene ${tiene} de ${pedido}`
}
export const vtdVigente = (v: CajaAlmacenVtd) => ['SOLICITADO', 'EN_CAJA', 'ENTREGADO'].includes(v.estado)

// PostgreSQL jsonb ordena las claves; comparar el texto sin normalizar produciría
// conflictos falsos y escrituras repetidas después de recuperar una operación.
export const draftFingerprint = (draft: unknown) => JSON.stringify(draft, (_key, value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]]))
})
