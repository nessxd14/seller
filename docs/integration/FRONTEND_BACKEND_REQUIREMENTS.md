# Requisitos funcionales frontend → backend

> Complementos normativos: `REPOSITORY_CONTRACTS.md`, `ERROR_CONTRACT.md`, `ROLE_UI_MATRIX.md`, `IDEMPOTENCY_AND_RETRY.md` y `SUPABASE_ADAPTER_CHECKLIST.md`. Ninguno impone nombres SQL ni RPC.

Supabase es el backend central objetivo para POS y WMS. Estos requisitos son independientes de plataformas ecommerce y no contemplan sincronización, webhooks ni flujos Shopify.

Este documento describe capacidades que el frontend necesitará. No prescribe nombres SQL, tablas, RPC, enums generados ni implementación Supabase. Los adaptadores futuros deberán traducir estos contratos a las firmas definitivas acordadas con el responsable del backend.

## Convenciones esperadas

- Montos en centavos enteros BOB.
- Fechas ISO 8601 UTC.
- Identificadores opacos como `string`.
- Escrituras con clave de idempotencia cuando puedan reintentarse.
- Errores funcionales distinguibles de fallos de red.
- Documentos concluidos devuelven snapshots históricos.
- Paginación y filtros deben ejecutarse en backend cuando el volumen lo requiera.

## Cotizaciones

| Operación funcional | Entrada esperada | Salida esperada | Errores a manejar | Pantalla |
|---|---|---|---|---|
| Listar cotizaciones | búsqueda, rango de fecha, canal, estado, página | resumen paginado | filtro inválido, no autorizado, servicio no disponible | Listado de cotizaciones |
| Obtener cotización | id | cabecera, cliente snapshot, líneas, totales, estado | no encontrada, no autorizado | Vista previa/editor |
| Crear borrador | cliente, canal, vigencia, términos, líneas snapshot, descuentos, idempotencia | cotización creada y numeración | cliente inválido, precio desactualizado, validación | Editor |
| Editar borrador | id, versión, cambios | cotización actualizada | conflicto de versión, estado no editable | Editor |
| Cambiar estado | id, estado destino, versión, motivo | documento y evento | transición inválida, vencida, conflicto | Listado/detalle |
| Duplicar | id origen, idempotencia | nuevo borrador independiente | origen no encontrado | Listado |
| Convertir a pedido | id, versión, idempotencia | pedido con snapshots y cotización convertida | no aprobada, ya convertida, conflicto | Vista previa |

## Pedidos

| Operación funcional | Entrada esperada | Salida esperada | Errores a manejar | Pantalla |
|---|---|---|---|---|
| Listar pedidos | búsqueda, fechas, canal, estado, página | resúmenes paginados | filtros inválidos | Listado |
| Obtener pedido | id | líneas, pendientes, preparados, asignaciones, historial | no encontrado | Detalle |
| Confirmar pedido | id, versión, idempotencia | estado y evaluación de disponibilidad | stock insuficiente, conflicto | Detalle |
| Asignar inventario | línea, ubicaciones y cantidades, versión | asignaciones/reservas resultantes | suma excedida, stock insuficiente | Detalle |
| Registrar preparación | línea, cantidad preparada, versión | cantidades actualizadas y evento | excede pendiente, estado inválido | Detalle |
| Despachar parcial | id, líneas/cantidades, versión, idempotencia | despacho y pendientes restantes | cantidad inválida, estado inválido, conflicto | Detalle |
| Cancelar | id, motivo, versión | pedido cancelado y reservas liberadas | ya despachado, estado inválido | Detalle |

## Clientes

| Operación funcional | Entrada esperada | Salida esperada | Errores a manejar | Pantalla |
|---|---|---|---|---|
| Buscar clientes | texto, tipo, canal, página | resultados paginados | filtro inválido | Listado/selector |
| Obtener ficha | id | datos, condiciones, crédito y resumen histórico | no encontrado | Ficha |
| Crear/editar | datos, versión opcional | cliente actualizado | documento duplicado, correo inválido, conflicto | Formulario |
| Consultar precio especial | cliente, producto, canal, fecha, cantidad | resolución de precio | sin precio aplicable | POS/cotización |
| Consultar actividad | cliente, tipo documental, rango | cotizaciones, pedidos y ventas | no autorizado | Ficha |

## Caja y pagos visuales

| Operación funcional | Entrada esperada | Salida esperada | Errores a manejar | Pantalla |
|---|---|---|---|---|
| Listar cajas disponibles | ubicación/usuario | cajas y estado | no autorizado | Apertura |
| Abrir sesión | caja, monto inicial, idempotencia | sesión activa | ya abierta, monto inválido | Caja |
| Obtener sesión | caja/sesión | resumen y movimientos | no encontrada | Caja |
| Registrar movimiento manual | sesión, tipo, monto, motivo, idempotencia | movimiento y resumen | sesión cerrada, autorización | Caja |
| Previsualizar cierre | sesión | esperado por método | sesión cerrada | Cierre |
| Cerrar sesión | sesión, contado, desglose, versión, idempotencia | diferencia y cierre | conflicto, monto inválido | Cierre |

El frontend no solicitará una escritura directa de dinero o inventario. Estas operaciones deberán ser atómicas y autorizadas por capacidades del backend.

## Impresión

| Operación funcional | Entrada esperada | Salida esperada | Errores a manejar | Pantalla |
|---|---|---|---|---|
| Obtener documento imprimible | tipo, id | snapshot completo, empresa y numeración | no encontrado | Previsualización |
| Registrar reimpresión | documento, motivo, idempotencia | marca/evento de reimpresión | no autorizado | Previsualización |
| Generar PDF | documento, formato A4 | archivo o URL temporal | generación fallida | Cotización/pedido/entrega |

Los tickets térmicos pueden renderizarse en frontend desde el snapshot; no deben reconstruirse desde maestros actuales.

## Ventas suspendidas

En esta fase son locales. Si posteriormente se sincronizan:

| Operación funcional | Entrada esperada | Salida esperada | Errores a manejar | Pantalla |
|---|---|---|---|---|
| Guardar operación suspendida | operación completa, usuario, dispositivo, idempotencia | identificador y versión | conflicto, operación duplicada | POS |
| Listar suspendidas | usuario/sucursal, búsqueda | resúmenes | no autorizado | Bandeja |
| Reclamar/restaurar | id, versión | operación bloqueada para edición | ya reclamada, versión desactualizada | Bandeja |
| Eliminar | id, versión, motivo | confirmación | conflicto, no autorizado | Bandeja |

## Errores transversales que la UI debe distinguir

- Validación de entrada.
- Recurso no encontrado.
- Estado o transición inválida.
- Conflicto de concurrencia/versión.
- Idempotencia ya procesada.
- Stock insuficiente o asignación inválida.
- Sesión de caja cerrada.
- Acción no autorizada.
- Servicio temporalmente no disponible.
- Error inesperado con identificador de correlación.
