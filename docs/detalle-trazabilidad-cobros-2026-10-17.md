# Detalle de partidas y trazabilidad compartida de cobros

Desarrollo local terminado y migración **aplicada en la base compartida** el 17 de octubre de 2026, con autorización explícita del usuario. La versión instalada es `20261017230621_detalle_partidas_trazabilidad_cobros.sql`, en el proyecto `zxoxougwgstrarwymlvd`. La consulta anterior `20261017221149_seller_estado_cobro_pedidos.sql` continúa funcionando y ahora incluye el contador de partidas saldadas. La publicación de los frontends sigue siendo independiente.

## Presentación

Seller incorpora el contador «2 de 2 partidas saldadas» en la columna Cobro, y un apartado desplegable «Partidas saldadas y responsables de cobros» dentro del pedido. El detalle muestra partidas principal e hijas, importes, pendientes y revisión. En Conciliador, el expediente incluye el mismo detalle con la partida consultada destacada.

Cada pago conserva el importe original y muestra cuánto está aplicado a las partidas del pedido, medio, referencia, cobrador, verificador, fechas y caja/turno. El responsable del turno se distingue del usuario que cobra; una administradora puede cobrar en el turno de una cajera y ambos quedan identificados. Los usos de saldo a favor tienen su propio apartado y no se presentan como dinero recibido nuevamente.

El historial muestra registros y decisiones de pagos, aplicaciones creadas/modificadas/retiradas, reasignaciones con rastro en origen y destino, usos/reversiones de saldo y transiciones financieras de las partidas. Usa cursor por id para consultar eventos anteriores sin repetirlos al llegar nuevos eventos. Un pedido cancelado con partidas vigentes o con importes diferentes conserva una advertencia de revisión.

## Captura y límites históricos

`hermes.cobro_evento` guarda actor de sesión, nombre y rol congelados, fecha de servidor y valores anteriores/nuevos pertinentes. La identidad se resuelve desde `auth.uid()` y `public.perfil`, sin aceptar un autor enviado por la interfaz. Los eventos no permiten INSERT/UPDATE/DELETE/TRUNCATE desde roles de aplicación; las escrituras proceden de triggers privados. El historial es append-only. La tabla tiene RLS y política de denegación; los usuarios consultan mediante las RPC autorizadas.

La captura observa la recepción original en `movimiento_caja`, los pagos y repartos, los usos de saldo a favor y los cambios de las partidas. No reemplaza las operaciones financieras existentes ni agrega cargos, abonos o movimientos de caja. Los reintentos nativos conservan la idempotencia. No se modifica la lógica de comisiones.

La fecha de saldado sólo se marca AUDITADA cuando se observa una transición real desde pendiente/revisión a saldo cero confirmado. Reabrir la deuda retira la fecha de saldado actual. No se infiere una fecha histórica a partir del estado PAGADA, la última actualización o el saldo global. Para registros antiguos se consulta la identidad disponible; el rol de perfil actual se etiqueta como actual y no se atribuye al momento del cobro. El sistema no inventa datos históricos ausentes.

## Contrato y permisos

- `public.consultar_detalle_cobro_pedido(bigint,bigint,integer)`: perfiles activos de Seller; 50 eventos por defecto, máximo 100, cursor opcional.
- `hermes.obtener_detalle_cobro_partida(bigint,bigint,integer)`: perfil activo con acceso a Hermes y rol validado. Incluye las partidas hermanas del pedido; las partidas manuales se consultan individualmente.
- Ambas usan `hermes.detalle_cobro_interno` para devolver el mismo contrato de partidas, pagos, responsables, saldos e historial. Los auxiliares no son ejecutables por anon, authenticated ni service_role.
- La consulta de lista existente añade `partidas_saldadas` manteniendo sus campos anteriores. El frontend es compatible con la versión instalada: sólo infiere el conteo completo cuando el pedido ya está confirmado como Pagado.

La migración instala un único evento de configuración para indicar desde cuándo existe la captura. No reconstruye operaciones ni modifica registros financieros históricos. Es independiente de incidencias o Caja–Almacén. La resolución de incidencias y la coherencia de comisiones se activaron posteriormente en esta entrega; ver `CIERRE_COBROS_COMISIONES.md`.

## Validación

PostgreSQL aislado con los flujos financieros existentes: instalación sin variación del libro, pago histórico sin fecha inventada, cajero y responsable de turno, confirmación con identidad real de sesión, rol/nombre preservados tras modificar el perfil, fechas auditadas, reapertura de deuda, saldo a favor y reversión, aplicación reasignada visible en ambos pedidos, partidas hijas, paginación, reintento, inmutabilidad y permisos. La suite financiera completa pasó.

Pasaron 656 pruebas de Seller (7 omitidas existentes) y 121 de Conciliador; las dos aplicaciones compilaron. Las pruebas de interfaz cubren respuestas tardías, datos inconsistentes, roles históricos desconocidos, paginación y error explicativo cuando falta activar el detalle. Se comprobó el navegador a 1440 × 1000 y 390 × 844 en ambas vistas con datos sintéticos. El módulo aislado se adapta a pantalla estrecha; el resto de Seller conserva sus limitaciones actuales de escritorio. No se probó concurrencia PostgreSQL entre conexiones independientes ni se ejecutaron cobros reales para validar esta ampliación.

Vistas de revisión: Seller `http://127.0.0.1:3034/pedidos/701` (desplegar el apartado nuevo), Conciliador `http://127.0.0.1:3024/vista-previa/cobros`. Los ejemplos están aislados, con escrituras deshabilitadas. Las aplicaciones locales iniciadas con `npm run dev` y una sesión autorizada ya pueden consultar registros reales; recargar la página para ver el detalle. Los ejemplos del puerto 3034 siguen siendo sintéticos.

## Verificación de la activación

La captura comenzó a las 19:06:21 del 17 de octubre de 2026 (America/La_Paz; 23:06:21 UTC). Se instaló únicamente un evento de configuración, sin reconstruir operaciones históricas. Hay seis triggers de captura activos. El archivo generado inicialmente por CLI se alineó con la versión asignada por Supabase; conserva el SHA256 revisado `993eb531286dc7d0695d3c52f986ec07e9e47bef9f95315998502d2114aa2fb5`.

Los controles financieros antes y después coincidieron: 907 movimientos de cuenta, suma 154.518,88; 190 pagos, importe 887.625,39; 419 partidas, importe 957.792,41; 2.069 movimientos de caja, importe 800.990,02. La instalación no ejecutó cobros ni modificó saldos.

Se comprobó lectura con `SET LOCAL ROLE authenticated`, usando el contexto de perfiles activos en transacciones de sólo lectura revertidas: Seller consultó 200 pedidos, 184 partidas y 160 pagos relacionados, con contadores consistentes. En 50 expedientes se compararon partidas, pagos, saldos y resumen de ambas RPC, con resultados iguales. Esta comprobación de permisos SQL no sustituye la sesión de navegador del usuario. No se registraron operaciones financieras reales para verificar la activación.

RLS está habilitado con política de denegación y sin acceso directo de authenticated ni anon a la tabla. Ambas RPC de lectura permiten únicamente authenticated, con validación de perfil; los auxiliares siguen privados y todos tienen search_path fijo. La API REST reconoce la nueva consulta de Seller y bloquea el acceso anónimo con `401 / 42501`. La suite financiera aislada volvió a pasar usando el archivo alineado con la versión remota. La revisión de seguridad conserva las cantidades de avisos previos; sólo suma las dos funciones de lectura SECURITY DEFINER intencionales para authenticated (109 → 111). [Referencia del aviso](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
