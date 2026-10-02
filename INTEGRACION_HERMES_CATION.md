# Seller, Caja y conciliador en local

Estado del 2 de octubre de 2026. Seller está actualizado hasta `73363d7` de `origin/main` y contiene cambios locales posteriores. Esta revisión no publicó las aplicaciones ni aplicó migraciones o cobros a la base operativa.

## Aplicaciones

| Aplicación | Carpeta | URL local |
|---|---|---|
| Seller | `D:\Proyectos\pos-cation` | http://localhost:5180 |
| Caja móvil | `D:\Proyectos\caja-cation` | http://localhost:5181 |
| Conciliador actual | `D:\Proyectos\conciliador` | http://localhost:3000 |

Cada origen del navegador requiere su propia sesión. Usa la misma cuenta de Seller en Caja. Administrador y gerente tienen seguimiento y revisión; el cajero opera su propio turno. Las operaciones siguen sujetas a los permisos de la base.

Seller y Caja usan el proyecto Cation `zxoxougwgstrarwymlvd`; el conciliador utiliza el esquema `hermes` del mismo proyecto. URL y clave publicable están en `.env.local`, excluido de Git. Las claves de servicio nunca forman parte del frontend.

## Qué se corrigió

Esta copia de Seller aún enviaba cobros por HTTP al Hermes anterior. Se incorporó aquí la integración ya preparada en el checkout de revisión y existente en el conciliador actual:

1. `public.registrar_cobro_hermes` crea movimiento de caja y pago propuesto en la misma transacción.
2. El cajero usa su sesión autenticada de Cation; no necesita acceso a la interfaz privada de Hermes para registrar el cobro.
3. El resultado debe incluir tanto movimiento como pago. Un fallo no se presenta como registro exitoso solo en caja.
4. Reintentar el mismo intento conserva la clave; el servidor comprueba su intención y evita duplicados.
5. Saldo, crédito y reparto se consultan mediante `public.consultar_hermes_pos`.
6. Los anticipos conservan `noImputar=true` cuando se solicita dejarlos a favor del cliente.

El pago aparece como **propuesto / pendiente de revisión**. Administrador o gerente lo confirman en el conciliador antes de modificar el saldo confirmado. Recibir una propuesta y confirmar su aplicación son pasos diferentes.

Las dos entradas de la cola heredada consultadas ya estaban sincronizadas el 1 de octubre. No se volvieron a enviar ni se crearon movimientos para recuperarlas.

La integración de base y la recuperación anterior se describen en `../conciliador/docs/INTEGRACION_CATION.md` y `../conciliador/docs/MIGRACION_CARTERA_UNICA.md`. Los SQL copiados en `supabase/migrations` sirven de referencia de la integración existente; no se aplicaron durante esta actualización local.

## Vista compartida de caja

- Apertura por denominaciones con total visible del fondo que se está contando.
- Venta de mostrador, VTD cobrada, pagos y anticipos separados por método.
- Actividad vinculada por `sesion_caja_id`, con cliente, documento, detalle, hora y estado del gasto.
- Los cobros de VTD figuran en el turno de cobro aunque la venta se haya abierto antes.
- Gasto con importe positivo y detalle obligatorio de al menos cinco caracteres. El comprobante fotográfico es opcional.
- Historial de los últimos 50 turnos; detalle de hasta 500 movimientos recientes por turno. El resumen incluye el turno completo.
- Seguimiento de caja con actualización cada 15 segundos y al volver a la pestaña; suscripción Realtime cuando la base lo tenga habilitado. No se cambió la configuración de Realtime.
- Cierre ciego: el cajero no recibe el efectivo esperado; la supervisión se obtiene de las RPC autorizadas.

Caja usa los módulos de Seller mediante el alias Vite `@seller`. Durante el desarrollo conjunto puede importar la carpeta contigua de Seller. Los builds usan el snapshot versionado en `src/seller` de Caja, con commit y hashes en `seller-source.json`; se regeneran con `npm run sync:seller` desde Caja. La app compila por separado y consulta Supabase sin un servidor Seller. Los enlaces hacia Seller y conciliador se configuran con `VITE_SELLER_URL` y `VITE_CONCILIADOR_URL` antes de compilar.

El ZIP original se conserva en `src/LegacyApp.jsx`, accesible con `?legacy=1`. Su histórico Firebase no se migró automáticamente a Cation.

## Probar en el celular

Inicia Seller con `npm run dev -- --host 0.0.0.0 --port 5180 --strictPort` y Caja con `npm run dev`. La PC y el celular deben estar en la misma red. Abre `http://IP-DE-LA-PC:5181`; en esta sesión la dirección es `http://192.168.1.100:5181`. Esta dirección depende de la red de la PC y no es una publicación para acceso desde Internet.

Las claves de operaciones de caja usan UUID v4 con aleatoriedad criptográfica, también cuando `randomUUID` no está disponible en HTTP de LAN. Referencia: [randomUUID](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID) y [getRandomValues](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues).

## Casos de aceptación

1. Ingresar como cajero y abrir su turno con denominaciones.
2. Buscar un cliente, registrar un pago y comprobar su movimiento en Caja y su propuesta en el conciliador.
3. Repetir con anticipo sin imputar y verificar esa intención al revisarlo.
4. Registrar venta y VTD; comprobar el desglose por método en el turno que cobró.
5. Declarar gasto con detalle y comprobarlo en actividad y revisión.
6. Ingresar como gerente desde el celular y consultar el turno y su histórico.

En modo conectado estos registros manuales usan la base operativa. La verificación automática de escrituras se hizo con datos sintéticos: no se registraron, confirmaron ni anularon cobros reales.

## Agregar VTD en modo Venta

Agregar VTD selecciona una venta de almacén existente y pendiente de cobro. No agrega sus productos como una venta nueva ni suma su importe al botón de mostrador.

El flujo actual exige cobrar la VTD sola. Con solo VTD seleccionadas, **Cobrar VTD** muestra el importe pendiente y el botón de mostrador queda deshabilitado. Si mezclas productos nuevos con VTD, se bloquean ambos cobros: retira las VTD de la selección, cobra primero los productos nuevos y luego vuelve a agregar la VTD para cobrarla sola. Cada operación tiene su propio documento. Por petición del usuario, este flujo se revisó para explicarlo y se conservó su comportamiento.

## Verificación automatizada

Seller: `npm test`, `npm run test:integration`, `npm run lint`, `npm run build`.

Caja: `npm run build` y ESLint de los archivos de integración nuevos. El código Firebase heredado se conserva y no se sometió a una refactorización general.

Conciliador: `npm test` sobre su versión actual, sin cambios de código en esta revisión.

Navegador: `npx playwright test --config playwright.cash.config.ts` desde Seller. Usa sesiones sintéticas y rutas HTTPS de Supabase interceptadas; comprueba escritorio, móvil de 390 px, apertura ciega, gasto detallado y reintento de pago. La emulación móvil no sustituye una prueba física en el teléfono.

Resultado final: Seller 316 pruebas correctas y 7 omitidas por su configuración previa; conciliador 54 correctas; navegador 7 casos correctos en escritorio y móviles de 360/390 px; compilaciones de Seller y Caja y análisis estático correctos. Las pruebas PostgreSQL aisladas de cobro conjunto, idempotencia, permisos y reversión también pasan.
