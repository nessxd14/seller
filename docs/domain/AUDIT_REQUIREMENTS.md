# Requisitos de auditoría

Registrar como eventos append-only:

- Cambios manuales de precio y descuento.
- Transiciones de documentos y actor.
- Reservas, liberaciones, asignaciones y movimientos de inventario.
- Apertura/cierre y movimientos manuales de caja.
- Confirmación, anulación y asignación de pagos.
- Emisión, cancelación y devolución de ventas.
- Reintentos y resultados de integraciones.

Cada evento incluye actor, instante UTC, entidad, acción, antes/después cuando aplique, motivo y `correlationId`. No almacenar secretos ni datos de pago sensibles. La autorización se registra aunque la autenticación se implemente después.

