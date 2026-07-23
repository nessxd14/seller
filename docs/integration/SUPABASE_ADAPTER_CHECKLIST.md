# Checklist para adaptadores Supabase — Fase 2D

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

