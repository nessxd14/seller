# Cobros, incidencias y comisiones: entrega integrada

17 de octubre de 2026 (America/La_Paz). El usuario autorizó completar los cuatro puntos: comisiones coherentes con partidas saldadas, activar incidencias, subir/publicar interfaces y validar los flujos con sesiones de prueba.

## Base compartida

Proyecto `zxoxougwgstrarwymlvd`. Migraciones instaladas:

- `20261018000223_hermes_incidencias_resolucion.sql`: conserva el importe original del pago; permite elegir saldo a favor, reasignación al mismo cliente o registro de devolución realizada. La devolución registra una salida de caja y exige recepción/devolución verificadas, referencia y turno válido. No ejecuta transferencias bancarias.
- `20261018000738_comisiones_cobro_consistente.sql`: Seller y comisiones usan `hermes.resumen_cobro_pedidos` como criterio único. Incluye partidas hijas, propuestas, saldo a favor aplicado, inconsistencias y cancelación. Los auxiliares están privados; la lectura de Seller conserva validación de perfil y contrato.

La revisión de elegibilidad movió 10 comisiones POTENCIAL a DEVENGADA y una DEVENGADA a POTENCIAL. Quedaron 325 devengadas, 34 potenciales y nueve anuladas, incluidas las ventas directas que mantienen su circuito. Los 368 importes congelados suman 4.507,22 antes y después. No se cambiaron vendedores ni tasas ni se crearon liquidaciones. Las 319 evaluaciones de pedidos registran su estado actual; no inventan la fecha histórica del cobro.

Los pagos siguen siendo 190 por 887.625,39; las partidas, 419 por 957.792,41; los movimientos de cuenta, 907 con suma 154.518,88. Caja tuvo actividad concurrente ajena a la instalación; no se utiliza su variación como prueba de invariancia. No se ejecutó ninguna resolución comercial ni devolución real durante la activación.

El historial de comisión guarda actor de sesión con nombre/rol congelados y valores anteriores/nuevos. Es inmutable, tiene RLS y carece de lectura o escritura directa de los roles de aplicación. `comision_historial` limita la consulta al vendedor propietario o gerencia. Las nuevas funciones usan search_path fijo. Se revisaron los avisos de seguridad antes y después: los de ejecución anónima bajaron de 22 a 19; authenticated pasó de 111 a 115 por los cinco endpoints nuevos y la retirada de un auxiliar. Los demás conteos permanecieron iguales. [Aviso sobre funciones autorizadas](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Operación en Seller

Comisiones muestra cuántas partidas están saldadas, distingue pagos por verificar, enlaza al detalle del pedido y permite abrir su historial. El vendedor de la comisión no se reemplaza por el cobrador o verificador.

Antes de liquidar, el servidor bloquea las filas seleccionadas y comprueba nuevamente la elegibilidad y el vendedor. Las solicitudes concurrentes no pueden pagar dos veces el mismo devengo. Si una deuda vuelve a abrirse después de liquidar, la liquidación se conserva y queda una advertencia de revisión de gerencia.

Anular una liquidación exige motivo y reevalúa cada pedido; no devuelve automáticamente todos los documentos a la cola de pago. Si cambia el importe del pedido, la comisión se bloquea hasta que gerencia revise base y monto, con motivo obligatorio e historial. No se recalculan importes congelados automáticamente usando reglas nuevas.

## Validación

Seller: compilación y 660 pruebas aprobadas, siete omitidas existentes. Conciliador: compilación y 121 pruebas aprobadas. Se comprobaron los permisos remotos con rol SQL authenticated y un perfil gerente activo: 319 historiales de comisión, elegibilidad coherente y bandeja de 13 incidencias. Estos números son un corte del momento.

La suite financiera completa pasó tanto en PGlite como en PostgreSQL 17 nativo, con perfiles y datos sintéticos. Cubre cobro, confirmación, saldo, hijas, reasignación, cancelación con las tres opciones, revisión de base, liquidación, reapertura, motivo, autor e idempotencia. Las pruebas concurrentes usaron conexiones independientes con rol authenticated: doble liquidación bloqueada, cancelación frente a liquidación y reintento de resolución sin duplicación. PostgreSQL escuchó sólo en loopback y se detuvo al terminar. No se usaron clientes reales para realizar cobros o liquidaciones de prueba.

## Publicación

Se preparan ramas de entrega sobre las últimas versiones de main de Seller y Conciliador. Los cambios recientes de Caja permanecen incluidos. Los cambios locales de otros trabajos no se incorporan a esta entrega. Las rutas de ejemplos conservan sus restricciones de desarrollo y no permiten operaciones reales.
