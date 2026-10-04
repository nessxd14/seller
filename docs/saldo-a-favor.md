# Saldo a favor compartido por Seller, Caja y Conciliador

Solo clientes mayoristas, institucionales y corporativos con cuenta activa en Hermes. Retail queda excluido. El disponible procede de dinero confirmado, saldos de apertura y ajustes; los pagos propuestos se verifican antes de poder utilizarlos.

## Operación del cajero

- Al seleccionar un acreedor, el carrito cambia a verde esmeralda y muestra «Cliente con saldo a favor», el saldo confirmado y el disponible.
- En **Cobrar**, el saldo se propone hasta cubrir el total. Se puede reducir o desmarcar. Se cobra únicamente la diferencia mediante efectivo, QR, transferencia o pago mixto.
- En **Pedidos → Usar saldo a favor**, se aplica al pendiente vigente del pedido. Se puede registrar el dinero nuevo restante en la misma operación. Este cobro sigue el proceso de verificación de Hermes.
- El turno muestra el saldo utilizado por separado y resalta el registro y su ticket. Una compra cubierta íntegramente con saldo figura en la actividad aunque no exista un movimiento de caja.
- El color histórico indica que el cliente tenía saldo a favor al vender; el ticket especifica lo que realmente se aplicó. Pagar con dinero nuevo conserva la identificación del cliente acreedor.

## Reglas de dinero e integridad

Una venta de Bs 228,50 con Bs 100,00 de saldo genera Bs 100,00 de consumo y Bs 128,50 de dinero nuevo. Solo Bs 128,50 entran a caja. El consumo completo genera cero ingreso nuevo y entrega el stock normalmente.

Las RPC `registrar_venta_con_saldo` y `aplicar_saldo_pedido` validan identidad, rol activo, caja propia y abierta, importe y disponible. La transacción agrupa stock, saldo y cobro; un fallo revierte todo. Bloqueos por cliente y claves estables evitan descontar dos veces.

Si se pierde la respuesta, los diálogos conservan los importes y la clave originales, incluso al cerrarlos y volverlos a abrir. Primero se comprueba ese intento; el cambio de saldo disponible no modifica automáticamente el cobro. Un rechazo explícito de PostgreSQL permite corregir los datos y volver a intentar.

`saldo_cliente_uso` conserva la auditoría; `hermes.saldo_uso_fuente` conserva el origen y `hermes.saldo_uso_partida` conserva la imputación. Un pedido ya genera su cargo al sincronizarse, por lo que aplicarle saldo no vuelve a cargar la cuenta. Las vistas de Hermes muestran el pendiente y el remanente de anticipos después del uso.

La anulación oficial de venta devuelve el saldo, revierte el stock y devuelve solo el dinero nuevo. La anulación de un pedido con saldo libera las aplicaciones y revierte el cargo. Si el pedido tiene pagos nuevos confirmados o por verificar, primero se resuelven por su flujo correspondiente; no se inventan devoluciones bancarias.

## Validación

`npm test`, `npm run lint`, `npm run build`, `npm run test:integration` y `npx playwright test --config playwright.cash.config.ts`. Las pruebas financieras usan PostgreSQL aislado y datos sintéticos. Las de interfaz interceptan HTTP y nunca escriben en la base real.
