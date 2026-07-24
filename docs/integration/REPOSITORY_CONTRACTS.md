# Contratos normalizados de repositorio

Los puertos están en `src/application/ports/repositories.ts`. No contienen detalles de Supabase, tablas o RPC.

## Neutralidad de plataforma

Los contratos describen capacidades propias del POS y del WMS. No incluyen repositorios, estados, eventos, webhooks ni identificadores funcionales de plataformas de ecommerce.

Supabase será el backend central futuro. Si un tipo generado o histórico contiene un identificador Shopify, el adaptador podrá conservarlo como metadato opaco para trazabilidad, pero el dominio no lo usará para precios, inventario, pedidos, ventas ni decisiones de estado.

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
