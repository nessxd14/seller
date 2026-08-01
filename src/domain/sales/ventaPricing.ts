// Espejo exacto de registrar_venta (ver db: round(v_unit * v_cant_pres, 2), con
// v_unit = el precio_unitario que este mismo módulo produce). Cualquier otra
// forma de calcular el total de una línea de VENTA vuelve a abrir el desajuste
// de centavos que hacía que registrar_venta rechazara el cobro.
//
// No confundir con cartCalculator.calculateLineTotal: esa aplica el descuento
// sobre el importe de la línea y es la correcta para cotización/pedido, donde
// descuento_pct viaja en su propia columna. Acá el descuento va horneado en el
// precio unitario porque venta_linea no tiene columna de descuento.
export interface VentaPricingLine {
  precioAplicado: number   // Bs, precio de lista aplicado a la línea
  cantidad: number         // en unidad de presentación si hay presentación activa
  descuento: number        // 0..100
}

/** Precio unitario NETO en centavos — exactamente lo que se manda como `precio_unitario`. */
export const netUnitPriceCents = (line: VentaPricingLine): number =>
  Math.round(Math.max(0, line.precioAplicado) * (1 - Math.min(100, Math.max(0, line.descuento)) / 100) * 100)

/** Total de la línea en centavos, tal como lo va a calcular registrar_venta. */
export const ventaLineTotalCents = (line: VentaPricingLine): number =>
  Math.round(netUnitPriceCents(line) * Math.max(0, Math.floor(line.cantidad)))
