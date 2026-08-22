// Pure conversions between the POS domain (cents / basis points / SalesChannel)
// and the WMS/Supabase schema (numeric BOB / pct 0..100 / categoria_pedido enum).
// No supabase client import here so this module stays trivially unit-testable.
import type { SalesChannel } from '../../domain/common/types'
import type { CustomerRecord } from '../../application/shared/models'
import type { CategoriaPedido } from '../../domain/orders/segmentoPedido'

// Brief P1: el tipo vive en domain/orders/segmentoPedido.ts (única fuente de verdad,
// compartida por el filtro de segmento) — se reexporta acá para no romper los imports
// existentes desde este módulo.
export type { CategoriaPedido }
// Brief S-D: institucion (DB) = gobierno (licitaciones, ministerios, GAMs), corporativo
// (DB) = empresa privada u ONG. 'municipal' se retiró — ver mappers.test.ts.
export type TipoPrecioCliente = 'retail' | 'mayorista' | 'corporativo' | 'institucion'

export const SUCURSAL_ALMACEN_ID = 1
export const SUCURSAL_TIENDA_ID = 2
export const SUCURSAL_SHOPIFY_ID = 3

export const channelToCategoria = (channel: SalesChannel): CategoriaPedido => {
  switch (channel) {
    case 'retail': return 'TIENDA'
    case 'mayoreo': return 'MAYOR'
    case 'institucional': return 'INSTITUCIONAL'
    case 'corporativo': return 'CORPORATIVO'
  }
}

export const categoriaToChannel = (categoria: CategoriaPedido): SalesChannel => {
  switch (categoria) {
    case 'TIENDA': return 'retail'
    case 'MAYOR': return 'mayoreo'
    case 'INSTITUCIONAL': return 'institucional'
    case 'CORPORATIVO': return 'corporativo'
  }
}

export const customerTypeToTipoPrecio = (type: CustomerRecord['type']): TipoPrecioCliente => {
  switch (type) {
    case 'retail': return 'retail'
    case 'wholesale': return 'mayorista'
    case 'institutional': return 'institucion'
    case 'corporate': return 'corporativo'
  }
}

export const tipoPrecioToCustomerType = (tipo: TipoPrecioCliente): CustomerRecord['type'] => {
  switch (tipo) {
    case 'retail': return 'retail'
    case 'mayorista': return 'wholesale'
    case 'institucion': return 'institutional'
    case 'corporativo': return 'corporate'
  }
}

/** cents (int) -> numeric BOB, e.g. 1050 -> 10.5 */
export const centsToNumeric = (cents: number): number => Math.round(cents) / 100

/** numeric BOB -> cents (int, rounded), e.g. 10.5 -> 1050 */
export const numericToCents = (numeric: number): number => Math.round(numeric * 100)

/** basis points (0..10000) -> pct (0..100), e.g. 1000 -> 10 */
export const bpToPct = (bp: number): number => Math.round((bp / 100) * 100) / 100

/** pct (0..100) -> basis points (0..10000), e.g. 10 -> 1000 */
export const pctToBp = (pct: number): number => Math.round(pct * 100)

export const locationToSucursalId = (location: 'Tienda' | 'Almacén'): number =>
  location === 'Tienda' ? SUCURSAL_TIENDA_ID : SUCURSAL_ALMACEN_ID

export const sucursalIdToLocation = (sucursalId: number | null | undefined): 'Tienda' | 'Almacén' =>
  sucursalId === SUCURSAL_TIENDA_ID ? 'Tienda' : 'Almacén'

/** Default sucursal_origen_id per channel: TIENDA -> Tienda(2); MAYOR/INST/CORPORATIVO -> Almacén(1) */
export const defaultSucursalForChannel = (channel: SalesChannel): number =>
  channel === 'retail' ? SUCURSAL_TIENDA_ID : SUCURSAL_ALMACEN_ID

export type MetodoPago = 'EFECTIVO' | 'QR' | 'TRANSFERENCIA' | 'SIGEP' | 'CHEQUE' | 'DEPOSITO'
export type PosPaymentMethod = 'cash' | 'qr' | 'transfer'

// Brief S-E: dos ejes separados en cotizacion/pedido — condicion_pago (CONTADO/CREDITO,
// término de pago) y medio_pago (cómo se paga, mismos 6 valores reales que metodo_pago).
// Antes un solo campo condicion_pago mezclaba ambos ejes (p. ej. 'SIGEP' como si fuera una
// condición), lo que hacía imposible expresar "crédito a 30 días, pagado por transferencia".
export type CondicionPago = 'CONTADO' | 'CREDITO'
export type MedioPago = MetodoPago

/** POS payment method ('cash'/'qr'/'transfer') -> backend metodo_pago enum. */
export const methodToMetodoPago = (method: PosPaymentMethod): MetodoPago => {
  switch (method) {
    case 'cash': return 'EFECTIVO'
    case 'qr': return 'QR'
    case 'transfer': return 'TRANSFERENCIA'
  }
}

/** backend metodo_pago enum -> POS payment method ('cash'/'qr'/'transfer'). */
export const metodoPagoToMethod = (metodo: MetodoPago | null | undefined): PosPaymentMethod => {
  switch (metodo) {
    case 'QR': return 'qr'
    case 'TRANSFERENCIA': return 'transfer'
    default: return 'cash'
  }
}

// Brief S-E: el enum metodo_pago en producción ahora tiene los 6 valores reales
// (EFECTIVO, QR, TRANSFERENCIA, SIGEP, CHEQUE, DEPOSITO) — antes solo tenía
// EFECTIVO/QR/TRANSFERENCIA y depósito/SIGEP/cheque se bucketeaban como TRANSFERENCIA,
// preservando el detalle real solo en la nota del movimiento. Ya no hace falta bucketear.
export type PosPaymentMethodExt = PosPaymentMethod | 'deposit' | 'sigep' | 'check'

/** POS payment method extendido -> backend metodo_pago enum (mapeo 1 a 1, sin bucket). */
export const methodExtToMetodoPago = (method: PosPaymentMethodExt): MetodoPago => {
  switch (method) {
    case 'cash': return 'EFECTIVO'
    case 'qr': return 'QR'
    case 'transfer': return 'TRANSFERENCIA'
    case 'sigep': return 'SIGEP'
    case 'check': return 'CHEQUE'
    case 'deposit': return 'DEPOSITO'
  }
}

/** POS payment method extendido -> código medio para Hermes (texto libre, sin bucket). */
export const methodExtToMedioHermes = (method: PosPaymentMethodExt): string => {
  switch (method) {
    case 'cash': return 'EFECTIVO'
    case 'qr': return 'QR'
    case 'transfer': return 'TRANSFERENCIA'
    case 'deposit': return 'DEPOSITO'
    case 'sigep': return 'SIGEP'
    case 'check': return 'CHEQUE'
  }
}

export type TipoMovimientoCaja = 'VENTA' | 'ANTICIPO' | 'INGRESO' | 'EGRESO' | 'ANULACION'

/** movimiento_caja.tipo -> CashSessionRecord movement type ('income'/'expense'). */
export const tipoMovimientoToType = (tipo: TipoMovimientoCaja): 'income' | 'expense' => {
  switch (tipo) {
    case 'VENTA': case 'ANTICIPO': case 'INGRESO': return 'income'
    case 'EGRESO': case 'ANULACION': return 'expense'
  }
}

/** Which producto.precio_* column to use for a channel. */
export const channelToPriceField = (
  channel: SalesChannel
): 'precio_base' | 'precio_mayoreo' | 'precio_institucion' | 'precio_corporativo' => {
  switch (channel) {
    case 'retail': return 'precio_base'
    case 'mayoreo': return 'precio_mayoreo'
    case 'institucional': return 'precio_institucion'
    case 'corporativo': return 'precio_corporativo'
  }
}
