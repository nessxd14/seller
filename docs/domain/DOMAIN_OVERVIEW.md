# Dominio del POS ROARI

## Propósito y límites

El dominio separa las reglas comerciales de React y de cualquier proveedor de persistencia. La UI consume servicios y repositorios; futuros adaptadores podrán usar Supabase o Zakaeus sin cambiar componentes.

Los agregados principales son Producto, Cotización, Pedido, Venta, Pago, Sesión de caja y Transferencia. Inventario mantiene saldos, movimientos, reservas y asignaciones como conceptos separados.

## Canales y abastecimiento

| Canal | Precio | Origen prioritario | Origen auxiliar |
|---|---|---|---|
| Retail | Lista retail | Tienda | Almacén |
| Mayoreo | Lista mayoreo | Almacén | Tienda |
| Institucional | Lista institucional | Almacén | Tienda |

El origen no modifica el canal ni el precio. Una línea puede tener varias asignaciones.

## Principios

- Dinero en centavos enteros BOB.
- Documentos concluidos conservan snapshots históricos.
- El stock disponible siempre se deriva.
- Cotizaciones y borradores no reservan.
- Estados cambian únicamente mediante transiciones permitidas.
- Pagos y sincronizaciones requieren claves de idempotencia.
- Toda modificación sensible genera auditoría append-only.

