# VTD: revisión, despacho y cobro

Caja genera el ticket y registra el cobro. Almacén prepara, otra persona verifica y autoriza la salida; esa autorización completa la VTD y descuenta stock una sola vez. Una VTD entregada con pago posterior sigue disponible para cobrar desde el circuito de VTD por cobrar.

La bandeja de Venta Directa sustituye la acción de completar por **Consultar entrega**. Consulta el estado vigente y retira las ventas completadas/anuladas. Se actualiza al volver a Caja, cada minuto mientras la página está visible y con **Actualizar bandeja**. Los errores permiten reintentar y las respuestas de un turno anterior no pueden sobrescribir la bandeja nueva.

La confirmación de cobro bloquea envíos simultáneos. La huella del intento incluye cajero, turno, VTD, monto, efectivo recibido, referencia y orden del reparto; cambiar cualquiera de esos datos es otra solicitud. El cobro ya registrado se recupera con su respuesta completa sin nuevos pagos ni movimientos de stock.

La migración de Almacén `20261013143239_fix_cierre_revision_cobro_vtd_pedidos.sql` ya se aplicó al Supabase compartido el 13 de octubre de 2026. Añade el recibo idempotente privado, permite consultar una VTD ya completada desde clientes anteriores y sincroniza los checklists de Pedidos con las salidas registradas. No hace falta aplicar otra migración desde este repositorio.

La verificación de pago digital del gerente y la verificación física de Almacén son pasos independientes. Los pagos QR/transferencia conservan su señal de pendiente de verificación financiera. El cierre de turno conserva las validaciones de ventas abiertas y cobros pendientes.

Validación: 594 pruebas de POS/Caja, integración financiera de Caja/Hermes y recibo conjunto, compilación TypeScript/Vite y lint de los archivos modificados. PostgreSQL aislado de Almacén verifica cobro antes y después de entregar, cambio exacto, pagos mixtos, recibos anteriores, caja cerrada, rollback y ausencia de doble stock.
