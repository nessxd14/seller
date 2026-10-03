# Corrección de cotizaciones — 3 de octubre de 2026

Cambiar el solicitante modificaba `solicitante_id` pero dejaba el nombre anterior en
`solicitado_por`. El borrador del navegador también se compartía entre documentos,
y recuperar ese borrador podía sustituir el ID, cliente y solicitante de otra cotización.

## Comportamiento corregido

- Guardar un borrador valida el vínculo cliente/contacto y actualiza ambos campos del solicitante.
  Quitar el contacto borra también su nombre. Un borrador afectado previamente se corrige al volver a guardar.
- Los documentos aprobados o convertidos conservan su nombre histórico. Un contacto
  desactivado ya asociado a un borrador puede conservarse; elegir otro contacto desactivado se rechaza.
- Cada documento tiene su propio borrador local. Recuperarlo conserva la identidad del documento
  y la versión original de la edición, para detectar cambios de otra sesión.
- Cambiar de cliente limpia su contacto anterior; elegir el mismo cliente lo conserva.
  El selector descarta respuestas de búsquedas anteriores y muestra errores de conexión.
- Duplicar crea una sola copia por acción, conserva observaciones y datos de las líneas, valida
  el contacto activo y abre la copia para editarla. El original permanece intacto.
- Las condiciones comerciales se guardan y se conservan al duplicar, junto con las observaciones.
- Durante el envío se bloquea el formulario y su cierre para evitar perder cambios pendientes.
- Guardar conserva la versión leída al abrir el formulario, sin reemplazarla por una lectura
  más reciente que pudiera ocultar un conflicto.
- Convertir un borrador guarda sus cambios antes de crear el pedido. Cancelar conserva el borrador.
- La lista carga todas sus páginas; antes solo mostraba las primeras 200 cotizaciones.

## Base y compatibilidad

Migración aplicada: `20261003223538_cotizaciones_identidad_duplicacion_atomica.sql`.
Migración adicional: `20261003224852_cotizaciones_condiciones_comerciales.sql`.

`crear_cotizacion` recibe ahora `p_notas text default null` al final. Los llamados anteriores
siguen funcionando sin ese argumento. Se reemplazó la firma anterior para evitar sobrecargas
ambiguas y se recargó el esquema de PostgREST. Ambas RPC conservan ejecución como invocador,
RLS y acceso de authenticated/service_role, sin acceso anónimo.
La columna `cotizacion.condiciones_comerciales` conserva el texto del formulario. Ambas RPC
aceptan `p_condiciones_comerciales` al final, como argumento opcional. En actualizaciones,
omitirlo mantiene el valor guardado, para compatibilidad con versiones anteriores; la interfaz
envía una cadena vacía cuando el usuario quiere borrarlo.

Las migraciones modifican funciones y agregan una columna opcional, sin reescribir documentos ni registros financieros.
La comparación antes/después confirmó encabezados y líneas idénticos, y la revisión de seguridad
no añadió advertencias.

## Verificación

- `npm test`: formulario real, persistencia del repositorio, duplicación, cambio de cliente,
  recuperación de borradores, control de versiones y conversión.
- `npm run test:quotations`: PostgreSQL en memoria con esquema/funciones reales;
  reproduce el error original antes de aplicar la migración y verifica el arreglo,
  rollback completo, contactos inactivos, compatibilidad y permisos.
- `npm run test:integration`: pagos, caja y sincronización con Conciliador.
- `npm run lint` y `npm run build`.

Las pruebas con escrituras usan PostgreSQL aislado, sin crear documentos de prueba en la base compartida.
Las pruebas del formulario y de PostgreSQL, las suites generales, lint y compilación pasaron.
Las migraciones ya están aplicadas en la base compartida; la interfaz usa estos contratos al desplegar esta versión.
