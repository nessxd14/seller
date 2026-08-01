// Pure conversions between the POS domain (cents / basis points / SalesChannel)
// and the WMS/Supabase schema (numeric BOB / pct 0..100 / categoria_pedido enum).
// No supabase client import here so this module stays trivially unit-testable.
import type { SalesChannel } from '../../domain/common/types'
import type { CustomerRecord } from '../../application/shared/models'

export type CategoriaPedido = 'TIENDA' | 'MAYOR' | 'INSTITUCIONAL' | 'MUNICIPAL'
// Brief M: institucion (DB) -> corporativo (DB, empresas privadas), municipal (DB) ->
// institucion (DB, gobierno/instituciones públicas). Migración aparte, ya validada.
export type TipoPrecioCliente = 'retail' | 'mayorista' | 'corporativo' | 'institucion'

export const SUCURSAL_ALMACEN_ID = 1
export const SUCURSAL_TIENDA_ID = 2
export const SUCURSAL_SHOPIFY_ID = 3

export const channelToCategoria = (channel: SalesChannel): CategoriaPedido => {
  switch (channel) {
    case 'retail': return 'TIENDA'
    case 'mayoreo': return 'MAYOR'
    case 'institucional': return 'INSTITUCIONAL'
    case 'municipal': return 'MUNICIPAL'
  }
}

export const categoriaToChannel = (categoria: CategoriaPedido): SalesChannel => {
  switch (categoria) {
    case 'TIENDA': return 'retail'
    case 'MAYOR': return 'mayoreo'
    case 'INSTITUCIONAL': return 'institucional'
    case 'MUNICIPAL': return 'municipal'
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

/** Default sucursal_origen_id per channel: TIENDA -> Tienda(2); MAYOR/INST/MUNICIPAL -> Almacén(1) */
export const defaultSucursalForChannel = (channel: SalesChannel): number =>
  channel === 'retail' ? SUCURSAL_TIENDA_ID : SUCURSAL_ALMACEN_ID

export type MetodoPago = 'EFECTIVO' | 'QR' | 'TRANSFERENCIA'
export type PosPaymentMethod = 'cash' | 'qr' | 'transfer'

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

// El enum metodo_pago en producción solo tiene EFECTIVO/QR/TRANSFERENCIA — depósito, SIGEP
// y cheque no existen ahí (SIGEP es un valor de condicion_pago, un enum distinto para
// términos de pago, no de método). Para "Registrar pago" el cajero elige entre 6 métodos,
// pero del lado de Cation se guardan en el mismo bucket TRANSFERENCIA que ya existe —
// el detalle real se preserva en la nota del movimiento y, del lado de Hermes, en el
// campo medio (texto libre, sin esa restricción).
export type PosPaymentMethodExt = PosPaymentMethod | 'deposit' | 'sigep' | 'check'

/** POS payment method extendido -> backend metodo_pago enum (bucket, ver nota arriba). */
export const methodExtToMetodoPago = (method: PosPaymentMethodExt): MetodoPago => {
  switch (method) {
    case 'cash': return 'EFECTIVO'
    case 'qr': return 'QR'
    default: return 'TRANSFERENCIA'
  }
}

/** Nota a anexar en movimiento_caja para los métodos que el enum no distingue. */
export const methodExtNotaExtra = (method: PosPaymentMethodExt): string | undefined => {
  switch (method) {
    case 'deposit': return 'Depósito bancario'
    case 'sigep': return 'SIGEP'
    case 'check': return 'Cheque'
    default: return undefined
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
): 'precio_base' | 'precio_mayoreo' | 'precio_institucion' | 'precio_municipal' => {
  switch (channel) {
    case 'retail': return 'precio_base'
    case 'mayoreo': return 'precio_mayoreo'
    case 'institucional': return 'precio_institucion'
    case 'municipal': return 'precio_municipal'
  }
}
