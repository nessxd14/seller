# Caja: cobro unificado y Registrar Pago

Implementación local para la decisión de emitir un único comprobante de caja por venta de mostrador, pedido de vendedor verificado y VTD postcobradas. Las referencias VTD se conservan para entrega, stock, conciliación bancaria y anulaciones; no se vuelven a crear sus líneas ni sus salidas de inventario.

## Cambios

- `checkout_caja` cobra todo dentro de una única transacción. Usa las RPC vigentes `registrar_venta`, `cobrar_pedido_vendedor` y `cobrar_vtd`. El cliente envía una sola solicitud y recibe un comprobante `CJA` persistido con las líneas, medios, cambio, saldo aplicado y referencias internas.
- Una respuesta perdida conserva el intento, sus importes y medios. La misma clave devuelve el documento registrado, también después de cerrar el turno. Una intención diferente con la misma clave se rechaza.
- El selector de vendedor guarda la atribución en las ventas y en el comprobante. El pedido conserva al vendedor original. Las VTD con vendedor previo conservan esa atribución; el selector completa las que aún no lo tienen.
- La verificación de pedidos sincroniza automáticamente las líneas verificadas con el carrito. No se permite cobrar hasta verificar o quitar todas las líneas. Las opciones del pedido permiten devolverlo a la cola o anularlo antes de limpiar la operación.
- Registrar Pago distingue deuda pendiente de pagos en revisión, incluye pedidos completados con deuda, borra el pedido al cambiar de cliente, exige conocer el reparto antes de confirmar y envía como anticipo un reparto íntegramente en cero. La confirmación de Hermes continúa reservada a gerencia.
- Un pago dirigido a un pedido ya pagado queda como anticipo; no se reasigna mediante FIFO a otro pedido. Los saldos de Seller se refrescan después de registrar el pago.
- El comprobante único se reimprime desde Caja y consulta los estados actuales de todas sus operaciones. Un QR combinado espera la verificación de cada operación con QR. Una anulación o un pago rechazado impide imprimir el documento como válido.

## Validación

- Suite completa de Vitest y compilación TypeScript/Vite.
- `npm run test:integration`: PostgreSQL aislado con datos sintéticos y definiciones reales de las RPC vigentes. Cubre caja + Hermes, mezcla de pagos, idempotencia, rollback, stock, saldo confirmado, vendedor, pedido verificado, permisos y caja cerrada.
- `npx playwright test --config playwright.checkout.config.ts`: cuatro flujos completos en Chromium, con todas las solicitudes Supabase interceptadas y sin ventas reales. Incluye prueba móvil, recuperación de la consulta de pedidos y capturas en `.ui-review.local/`.

## Activación

La migración `20261007213559_checkout_caja_unificado.sql` se aplicó en `zxoxougwgstrarwymlvd` el 7 de octubre de 2026 con autorización del usuario. El archivo conserva el SQL probado y usa la versión asignada por el historial remoto, para evitar que un despliegue posterior intente aplicarlo de nuevo. La consulta autenticada se verificó en producción; no se crearon cobros reales. La publicación del frontend sigue pendiente.

La revisión de Registrar Pago distingue actualización pendiente, permisos y fallo de conexión; permite reintentar sin volver a seleccionar el cliente. Al elegir un pedido muestra su pendiente separado del saldo total, precarga ese importe y permite abonos. El aviso de excedente se calcula contra ese pedido. Las pruebas verifican que los pagos en revisión reduzcan el pendiente sugerido y que un excedente quede como anticipo sin aplicarse a otro pedido.

Los advisors posteriores señalan las tres nuevas RPC como funciones `SECURITY DEFINER` accesibles para usuarios autenticados. El acceso es intencional: cada función exige un operador autorizado, fija el `search_path` y revoca ejecución a `PUBLIC` y `anon`. La tabla de comprobantes tiene RLS y consulta restringida al cajero propietario o gerencia.

La migración crea `cobro_caja` y tres RPC con permisos de cajero/gerencia y RLS para consultar los documentos. Actualiza `hermes.registrar_movimiento_pos` sin cambiar los pagos históricos. La instalación no importa ni modifica ventas, saldos o pedidos existentes.

Los saldos a favor solo financian la venta nueva de mostrador/pedido en esta etapa; el importe de VTD existentes se paga con efectivo, QR o transferencia. Para un cobro combinado, las VTD con cliente deben pertenecer al cliente seleccionado en el carrito.
