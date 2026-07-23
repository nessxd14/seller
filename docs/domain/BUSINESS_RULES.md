# Reglas comerciales

1. Cantidades de líneas y asignaciones son enteros positivos.
2. Agregar el mismo producto/presentación a una operación incrementa la línea existente.
3. Cambiar canal vuelve a resolver el precio de lista; no cambia el origen de stock.
4. Un precio aplicado nunca puede ser negativo. Un override conserva precio original, usuario, motivo, fecha y autorizador cuando corresponda.
5. Descuentos están entre 0% y 100%; el descuento general no puede superar el subtotal.
6. Cotizaciones y pedidos `draft` no reservan inventario.
7. Un pedido confirmado puede reservar total o parcialmente; si falta stock pasa a `awaiting_stock`.
8. La suma de asignaciones no excede la cantidad de la línea.
9. No se permite stock disponible negativo salvo futura configuración explícita.
10. Cancelar un pedido libera reservas activas; consumir una reserva ocurre al concluir el despacho/venta según la política que confirme el negocio.
11. Total original, pagado y saldo pendiente son campos separados.
12. Asignaciones de pagos no superan el total original. Pago mixto debe sumar exactamente el monto registrado.
13. Documentos concluidos no consultan datos maestros para reconstruir sus valores históricos.
14. Operaciones externas repetidas con la misma clave de idempotencia no crean duplicados.

