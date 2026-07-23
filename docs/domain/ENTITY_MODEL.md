# Modelo de entidades

## Decisiones de modelado

- `ProductPresentation` representa variantes/presentaciones vendibles; no se crean dos conceptos separados hasta conocer si ROARI maneja atributos combinables.
- `ProductIdentifier` admite SKU, código de barras y código de fábrica sin columnas repetidas.
- `StockBalance` es una proyección por producto/presentación y ubicación; `InventoryMovement` es el registro histórico.
- `InventoryReservation` compromete stock; `InventoryAllocation` registra de dónde se abastece una línea. Pueden coexistir, pero no son equivalentes.
- `Fulfillment` unifica preparación/picking. `Delivery` conserva el despacho y recepción externos.
- Quote, Order y Sale tienen líneas propias para preservar snapshots y ciclos de vida independientes.
- User/Role/Permission se modelan como contratos futuros, sin autenticación en esta fase.

## Diagrama textual

```text
Category 1 ── * Product 1 ── * ProductPresentation
                         └── * ProductIdentifier
Product/Presentation * ── * ProductPrice * ── 1 PriceList
Customer 1 ── * CustomerSpecialPrice ── 1 Product

InventoryLocation 1 ── * StockBalance ── 1 Product
InventoryLocation 1 ── * InventoryMovement
SalesOrderItem 1 ── * InventoryAllocation ── 1 InventoryLocation
SalesOrderItem 1 ── * InventoryReservation

Quote 1 ── * QuoteItem ──convertir──> SalesOrder 1 ── * SalesOrderItem
SalesOrder 1 ── * Fulfillment / Delivery ──> Sale 1 ── * SaleItem
Sale * <── * PaymentAllocation * ── 1 Payment
Sale 1 ── * Return 1 ── * ReturnItem

CashRegister 1 ── * CashSession 1 ── * CashMovement
User * ── * Role * ── * Permission
Todos los agregados ──> AuditLog / IntegrationJob
```

