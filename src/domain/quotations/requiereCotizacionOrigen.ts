import type { CustomerRecord } from '../../application/shared/models'

// Brief T7 Tarea 5: la base rechaza crear un pedido directo (sin cotización de origen)
// para clientes institucion/corporativo/mayorista — mismo mapeo que customerTypeToTipoPrecio
// (src/infrastructure/supabase/mappers.ts). Sin cliente (pedidos internos) o retail: nunca.
export const requiereCotizacionOrigen = (customerType: CustomerRecord['type'] | undefined): boolean =>
  customerType != null && customerType !== 'retail'
