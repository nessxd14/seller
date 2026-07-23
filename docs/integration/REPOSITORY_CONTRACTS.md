# Contratos normalizados de repositorio

Los puertos están en `src/application/ports/repositories.ts`. No contienen detalles de Supabase, tablas o RPC.

## Convenciones

- Listados reciben filtros y `{page, pageSize}` y devuelven `{items, page, pageSize, total}`.
- Entidades editables exponen `version` y `updatedAt`.
- Escrituras reciben `expectedVersion` para control optimista.
- Operaciones sensibles reciben `idempotencyKey`.
- Identificadores son opacos.
- Los errores se expresan mediante `AppError`, nunca mediante textos técnicos.

## Puertos

- `ProductRepository`: búsqueda paginada y obtención por id.
- `InventoryRepository`: disponibilidad derivada y simulación de asignaciones; no permite escrituras directas.
- `CustomerRepository`: búsqueda, detalle y guardado versionado.
- `QuoteRepository`: filtros por texto, estado, canal y fechas; CRUD de borradores y duplicación.
- `OrderRepository`: filtros, detalle y guardado versionado.
- `SaleRepository`: consulta, confirmación y anulación idempotentes.
- `PaymentRepository`: registro idempotente con componentes mixtos.
- `CashRepository`: listado, sesión y apertura/cierre idempotentes.
- `SuspendedSaleRepository`: listado, guardado, restauración y eliminación versionados.
- `AuthSessionProvider`: sesión, selector mock y suscripción a cambios.

Las suites de contrato reutilizables para Quote, Order, Sale, Cash y Customer exigen creación, lectura, paginación, incremento de versión, conflicto optimista e idempotencia. Un futuro adaptador debe pasar las mismas suites.

