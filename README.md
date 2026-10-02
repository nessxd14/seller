# Seller · Cation

Punto de venta conectado a Cation: ventas, clientes, pedidos, VTD y turnos de caja. El modo Supabase comparte autenticación y cartera con el conciliador; el modo mock conserva datos demostrativos locales.

## Ejecutar localmente

```powershell
npm install
npm run dev -- --host 0.0.0.0 --port 5180 --strictPort
```

Configura `.env.local` según `.env.example`, con la URL y la clave publicable del proyecto Cation. Para una demostración aislada usa `VITE_POS_MODE=mock`; en ese modo no se registran cobros reales.

La copia local se actualizó el 2 de octubre de 2026 hasta `origin/main`, commit `73363d7`. Sobre esa versión están los cambios locales de integración y caja.

## Caja y conciliador

[Guía de integración y pruebas locales](INTEGRACION_HERMES_CATION.md).

Caja móvil está en [nessxd14/caja-roari](https://github.com/nessxd14/caja-roari). En desarrollo conjunto, la carpeta contigua `../caja-cation` usa los componentes y repositorios de `src/features/cash`. Para compilar por separado, Caja incluye un snapshot con el commit de Seller y hashes de sus archivos. Consulta los mismos turnos y movimientos; no duplica cobros.

## Validación

```powershell
npm test
npm run test:integration
npm run lint
npm run build
npx playwright test --config playwright.cash.config.ts
```

La última orden requiere la carpeta contigua de Caja y sus dependencias. Las pruebas financieras de integración usan PostgreSQL aislado con PGlite; las de navegador interceptan Supabase y usan datos sintéticos.

## Dominio y diseño

El dominio independiente de React está en `src/domain/`. La documentación funcional comienza en `docs/domain/DOMAIN_OVERVIEW.md`.

`PRODUCT.md`, `DESIGN.md` y `.impeccable/design.json` describen el alcance y el diseño compartido de caja. El resto del POS conserva sus pantallas existentes.
