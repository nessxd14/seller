# Idempotencia y reintentos

`LocalIdempotencyService` crea una clave por tipo de operación y agregado. `SensitiveOperationExecutor` bloquea envíos paralelos, obtiene o reutiliza la clave, la entrega al adaptador, la conserva ante timeout/error de red y la limpia después de éxito confirmado.

Operaciones cubiertas: confirmar venta, convertir cotización, confirmar pedido, registrar pago, abrir/cerrar caja, despachar, anular y devolver. Los flujos existentes usan el ejecutor para conversión, despacho y caja; los puertos exigen la clave en los demás.

El backend debe hacer única la clave dentro del alcance acordado y devolver el resultado original ante repeticiones.

