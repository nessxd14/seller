# Checklist para adaptadores Supabase — Fase 2D

Supabase será el backend central del POS y del WMS. Los adaptadores implementarán exclusivamente los puertos neutrales de la aplicación.

No iniciar adaptadores reales hasta recibir:

- [ ] Firmas definitivas y documentación funcional de RPC.
- [ ] Tipos TypeScript generados aprobados.
- [ ] Matriz de políticas RLS y roles efectiva.
- [ ] Ambiente de staging disponible.
- [ ] URL y anon key de staging.
- [ ] Convención de errores y códigos.
- [ ] Estrategia de versión optimista.
- [ ] Alcance de claves idempotentes.
- [ ] Paginación, ordenamiento y filtros.
- [ ] Transacciones de venta, pago, reserva, despacho y caja.
- [ ] Datos semilla y usuarios de prueba por rol.

Después se crearán adaptadores detrás de los puertos, se mapearán errores y dinero, se ejecutarán las suites de contrato en staging y se habilitará `featureFlags.supabase` solo allí. Los mocks se conservarán.

No conectar componentes directamente al cliente Supabase ni escribir tablas desde la UI.

Quedan fuera del alcance: adaptadores o repositorios Shopify, sincronización de productos/inventario, webhooks, pedidos ecommerce y estados específicos de Shopify. Los IDs históricos, si existen en tipos entregados por backend, se tratarán únicamente como metadatos pasivos.
