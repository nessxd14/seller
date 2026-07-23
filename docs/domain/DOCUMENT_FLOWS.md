# Flujos documentales

## Retail

```text
Venta pendiente → Pago confirmado → Venta pagada → Ticket
```

## Mayoreo e institucional

```text
Cotización → Pedido → Reserva → Preparación → Despacho → Venta → Pago
```

Una venta directa puede comenzar sin cotización. Convertir una cotización aprobada copia snapshots a un pedido nuevo; no enlaza líneas vivas. Cotización y pedido conservan identidad y auditoría propias.

Cotización no afecta inventario. Pedido borrador tampoco. Confirmación evalúa disponibilidad y crea reservas. Preparación consume asignaciones; despacho registra salida. La política exacta del momento de facturación queda en preguntas abiertas.

