# Modelo de pagos

Métodos preparados: efectivo, QR, transferencia, crédito, anticipo y mixto. Un pago mixto se compone de dos o más componentes positivos cuya suma exacta coincide con el monto del pago.

`PaymentAllocation` permite aplicar un pago a una venta o pedido. Se mantienen:

```text
totalOriginal
montoPagado = suma(asignaciones confirmadas)
saldoPendiente = totalOriginal - montoPagado
```

Estados derivados: sin asignaciones `pending_payment`; saldo positivo `partially_paid`; saldo cero `paid`. Pagos no confirmados no se asignan. Cada intento tiene clave de idempotencia.

