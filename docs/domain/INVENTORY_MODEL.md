# Modelo de inventario

Por producto/presentación y ubicación:

```text
stockDisponible = max(0, stockFisico - stockReservado - stockDanado)
```

`stockEnTransito` es informativo hasta la recepción: no aumenta físico ni disponible. `stockFisico` cambia solo mediante movimientos confirmados. Las reservas cambian `stockReservado`; las asignaciones describen el plan/origen por línea.

## Casos

- Stock insuficiente: rechazar reserva completa o crear reserva parcial y dejar pedido `awaiting_stock`.
- Liberación/cancelación: bajar reservado sin alterar físico.
- Transferencia: salida al pasar a tránsito; entrada física al recibir, con movimientos correlacionados.
- Dañado: incrementar `stockDanado`, reduciendo disponible; no borrar el físico hasta baja confirmada.
- Ajustes: movimiento positivo/negativo con motivo, usuario y auditoría.
- Venta: conservar asignaciones por ubicación en cada línea.

