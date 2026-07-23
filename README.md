# ROARI POS — Fase 1

Interfaz desktop-first del nuevo punto de venta de ROARI. Funciona enteramente con datos mock locales; no incluye backend, autenticación, persistencia de inventario ni integraciones externas.

## Ejecutar localmente

```bash
npm install
npm run dev
```

Vite mostrará la URL local (normalmente `http://localhost:5173`).

## Validación

```bash
npm run lint
npm run build
```

La venta suspendida se almacena solo en `localStorage`. Los cobros, pedidos, cotizaciones y anticipos son demostrativos.

## Dominio — Fase 2A

La capa independiente de React está en `src/domain/`. Define dinero en centavos, entidades, estados, reglas puras, contratos de repositorio y adaptadores mock. La documentación funcional comienza en `docs/domain/DOMAIN_OVERVIEW.md` y las decisiones pendientes del negocio están en `docs/domain/OPEN_QUESTIONS.md`.

```bash
npm test
```

Esta fase no crea tablas ni conecta Supabase, Zakaeus u otros servicios externos.
