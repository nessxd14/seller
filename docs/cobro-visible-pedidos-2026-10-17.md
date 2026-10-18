# Cobro visible de pedidos en Seller

Implementado y activado en la base compartida el 17 de octubre de 2026, con autorización del usuario. La publicación del frontend sigue siendo independiente; la versión local de Seller ya puede consultar los estados reales.

La lista de Pedidos sustituye el marcador vacío de Líneas por una columna Cobro, con texto, icono e importe. Incluye filtro por cobro, actualización manual y consulta automática al recuperar el foco, volver a la pestaña, registrar un pago, aplicar saldo o transcurrir 30 segundos con la pestaña visible. El detalle conserva por separado el estado operativo y muestra importes aplicados confirmados, por verificar y por cubrir.

| Indicador | Criterio |
|---|---|
| Pagado | Todas las partidas vigentes del pedido, incluidas hijas, tienen pendiente cero, sin propuestas en revisión ni diferencias con el total del pedido. |
| Abono parcial | Hay importe confirmado aplicado y queda pendiente. |
| Por verificar | Hay aplicaciones de pagos PROPUESTO; su importe se separa de lo pendiente por cubrir. |
| Pendiente | Hay deuda en las partidas sin importe confirmado ni propuestas aplicadas. |
| Revisar cobro | Pedido cancelado con partidas activas, exceso de imputación, propuesta excesiva, vínculo de cliente inconsistente o diferencias entre total del pedido y partidas. |
| Cancelado | Pedido cancelado sin partidas vigentes; no afirma que la devolución o el destino de cada pago ya esté resuelto. |
| Sin partida | Pedido sin partidas vigentes vinculadas. No significa saldo cero. |
| Cobro no disponible | Error de conexión, falta de permisos/RPC o datos incompletos. No se inventa un cobro confirmado. |

Retail conserva su circuito de Caja y se presenta como Cobro en Caja, sin cuenta corriente. La consulta no deduce el cobro del saldo global del cliente. Un crédito libre o un pago sin asignar debe aplicarse al pedido; la interfaz muestra esta aclaración. La columna no indica que la entrega esté completa. La autoría, el historial compartido y el contador de partidas saldadas se activaron también el 17 de octubre, con autorización explícita del usuario; ver `detalle-trazabilidad-cobros-2026-10-17.md` y la migración `20261017230621_detalle_partidas_trazabilidad_cobros.sql`.

`public.consultar_cobros_pedidos(bigint[])` consulta hasta 200 pedidos por llamada; el adaptador divide listas mayores en lotes y conserva explícitamente los fallos de cada lote. Usa la vista de partidas existente, incluida la aplicación de saldo a favor. Es una función estable de sólo lectura, con identidad de sesión y perfil activo de Seller, búsqueda de esquemas fija y ejecución exclusiva para authenticated. No concede lectura directa ni escritura sobre tablas financieras. La migración es `20261017221149_seller_estado_cobro_pedidos.sql`; no depende de la migración pendiente de resolución de incidencias ni de las operaciones nuevas Caja–Almacén. El archivo generado originalmente por CLI se alineó con la versión asignada por Supabase al aplicar la migración; su contenido conserva el SHA256 `2012a7d32f8353c4234b8a5f3f19a30c041810ba2d12acc03ad658ab51458ca9`.

Los controles de Registrar anticipo respetan el modo de consulta y los pedidos cancelados. La nueva consulta no modifica las reglas del registro de dinero ni confirma pagos.

Verificación: compilación de Seller, pruebas de interfaz y adaptador, suite completa de 637 pruebas aprobadas (7 omitidas existentes) e integración financiera en PostgreSQL aislado. La integración comprueba partidas hijas, propuesta que cubre el pendiente, crédito global sin aplicación, pago rechazado, cancelación histórica, instalación sin modificación de saldos, límites de lotes, anonimato, perfil inactivo y lectura mediante el rol authenticated. La prueba de navegador usa el componente real de Pedidos, filtrado y detalle con datos sintéticos; pasó a 1440 y 390 píxeles en una superficie aislada. El resto de Seller conserva su ancho mínimo de escritorio.

Vista de revisión local: `http://127.0.0.1:3034/`. Los adaptadores de la vista están aislados en `.sync-preview.local/cobros`, no se publican ni contactan la base remota; las escrituras están deshabilitadas.

## Verificación de la activación

Aplicada al proyecto Cation `zxoxougwgstrarwymlvd`, versión remota `20261017221149`. Se comprobó ejecución de la lectura de 200 pedidos con `SET LOCAL ROLE authenticated` y el contexto de un perfil cajero activo, dentro de una transacción revertida. Se validaron cantidad de respuestas y estados admitidos. Es una comprobación de permisos SQL; no sustituye la sesión de navegador del usuario.

La API REST reconoce la nueva RPC y bloquea el acceso anónimo con `401 / 42501`. Los permisos permiten authenticated y bloquean anon y service_role. Los controles antes y después coincidieron: 907 movimientos de cuenta, suma 154.518,88; 190 pagos, importe 887.625,39; 419 partidas, importe 957.792,41; 2.059 movimientos de caja, importe 800.905,02. La migración no ejecutó cobros, cancelaciones ni cambios en saldos.

La consulta de lectura clasificó los 718 pedidos existentes: 344 pagados, 2 con abono parcial, 46 pendientes, 3 por verificar, 4 por revisar, 39 sin partida, 46 cancelados y 234 de tienda sin cuenta corriente. Es un corte del momento de la comprobación; los filtros de Seller pueden mostrar un subconjunto.

Los avisos de seguridad anteriores conservaron sus cantidades. El único incremento fue el aviso esperado de función SECURITY DEFINER disponible a authenticated (108 → 109), correspondiente a esta lectura con validación explícita del perfil y search_path fijo. No se concedió acceso anónimo ni permisos adicionales sobre tablas. [Referencia del aviso](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

En el Seller iniciado con `npm run dev`, usar Actualizar cobros o recargar para obtener los estados reales. La vista aislada del puerto 3034 conserva los ejemplos.
