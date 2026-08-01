export const featureFlags = {
  useMocks: true,
  quotations: true,
  orders: true,
  cash: true,
  credit: true,
  printing: true,
  supabase: true,
  // Cargo automático a la cuenta del cliente en Hermes al confirmar una venta.
  // APAGADO a propósito (2026-08-01): registrar_cargo_saldo inserta un
  // movimiento_cuenta tipo CARGO (deuda), pero en este POS toda venta se cobra
  // completa antes de confirmarse — registrar_venta rechaza pagos que no cubran
  // el total y "Crédito" no existe como método en modo Supabase. Encenderlo
  // como está hoy le acumula al cliente una deuda por cada compra al contado.
  // No volver a encender esto sin definir primero la venta a crédito de punta a
  // punta (método de pago, condición, y qué contrapartida se registra).
  hermesCargoVenta: false,
} as const

