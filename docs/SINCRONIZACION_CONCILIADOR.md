# Sincronización automática con el conciliador

Seller se actualizó hasta `7f78b4f` de `origin/main`. Las migraciones `supabase/migrations/20261003213326_hermes_clientes_pedidos_automaticos.sql` y `20261003214031_hermes_vistas_sincronizacion_invocador.sql` están aplicadas a Cation. Las vistas de pendientes conservan `security_invoker=true` para respetar permisos y RLS de quien consulta.

El evento de cliente vincula automáticamente mayoristas, institucionales y corporativos, preservando sus condiciones de crédito. El evento de pedido espera al final de la transacción y abre la partida con el total definitivo, siempre después de asegurar su cliente. La elegibilidad se toma de `cliente.tipo_precio`, aunque el pedido use otro canal. Retail queda fuera de estos eventos y de los listados del conciliador.

Los pedidos con cliente e importe positivo en ABIERTO o COMPLETADO siguen el criterio contable de la importación anterior: partida y cargo por el total. Los reintentos y la finalización no generan cargos adicionales. No se reescribe el importe contable de partidas existentes ni se recuperan automáticamente pedidos históricos durante la instalación.

## Cobros

`SupabaseCashRepository` utiliza `public.registrar_cobro_cation`. La RPC conserva caja y pagos PROPUESTO en una transacción para las categorías elegibles. En retail guarda únicamente el movimiento de caja y devuelve `excluidoRetail: true`; el repositorio solo acepta un resultado sin `pagoId` con esa marca explícita. La interfaz presenta el registro en Seller y omite saldo y reparto de Hermes para retail.

La RPC anterior `registrar_cobro_hermes` conserva su contrato para cajas con versiones anteriores, incluidos los reintentos existentes. Su comportamiento retail anterior se mantiene hasta actualizar esos frontends. Ambas RPC comparten validaciones de operador activo, caja abierta, idempotencia y rollback mediante un núcleo privado no ejecutable por usuarios del navegador. Los pagos elegibles siguen requiriendo verificación en el conciliador.

## Pruebas

`npm run test:integration` reconstruye PostgreSQL aislado con PGlite y ejecuta las migraciones. El módulo `supabase/tests/sincronizacion-automatica.test.mjs` comprueba el orden de vinculación, los tres tipos de cliente, exclusión retail, total definitivo, la RPC real de creación y su rollback, permisos de cajero, colisiones de IDs, conservación de crédito y contratos de cobro.

`supabase/tests/crear-pedido.fixture.sql` es una copia de la definición vigente de la RPC para estas pruebas; no se instala en la base compartida ni contiene pedidos o clientes reales. Los datos de pruebas son sintéticos y no se escriben en Supabase.

El detalle de la interfaz y la verificación de la instalación está en `SINCRONIZACION_SELLER.md` del repositorio Conciliador. La base ya tiene la automatización; los cambios de frontend se publican por separado.
