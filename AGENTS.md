# AGENTS.md — Seller (pos-cation)

Reglas para cualquier agente que trabaje en este repo (Codex, Claude Code u otro).
`CLAUDE.md` importa este archivo: hay un solo juego de reglas.

La primera parte es el **bloque común** de los repos de Cation (Seller, Conciliador,
almacen_cation) y se mantiene igual en los tres. La segunda parte es propia del Seller.

---

## Bloque común

### Supabase / Postgres

- Cada `CREATE` o `CREATE OR REPLACE FUNCTION` lleva en el mismo archivo `REVOKE ALL … FROM anon, public`
  y `GRANT EXECUTE … TO authenticated, service_role`. Supabase no respeta los default privileges
  para funciones: toda función nueva nace con EXECUTE para `PUBLIC` y `anon`.
- Antes de cualquier `DROP FUNCTION`, se obtiene la firma con `p.oid::regprocedure::text` desde
  `pg_proc`. Nunca se reescribe la firma de memoria (`DROP FUNCTION IF EXISTS` con un tipo mal
  escrito falla en silencio).
- Si cambia la lista de parámetros, primero `DROP` y después `CREATE`. `CREATE OR REPLACE` con otra
  lista crea una sobrecarga y PostgREST queda con llamadas ambiguas.
- PostgREST corta en 1000 filas sin avisar. Los datos se leen por `.rpc()` con paginación real,
  nunca con `SELECT` directo a tablas grandes.
- El kardex es append-only (el trigger `kardex_no_update` bloquea UPDATE/DELETE). Las correcciones
  se hacen con AJUSTE compensatorio, y `stock_actual` solo lo escribe el trigger.
- Antes de usar una columna en un trigger, se revisa `information_schema.columns.generation_expression`.
  En un trigger BEFORE, una columna GENERATED se lee como NULL (ej.: `producto.precio_municipal`).
- `ALTER TYPE … ADD VALUE` va en un archivo propio, porque no corre dentro de una transacción.
- Si una migración tiene un bloque sin escribir, ese bloque va en un archivo separado. Nunca se deja
  vacío dentro de un archivo que corre de arriba abajo.

### Ritual de migraciones

1. Ensayo en `BEGIN…ROLLBACK` con `RAISE EXCEPTION` (no `RAISE NOTICE`) para ver los valores y abortar.
2. Ness revisa los resultados.
3. Se aplica: Ness en el SQL Editor, o el agente **solo con permiso explícito** de Ness.
4. Se verifica con un `SELECT` limpio en otra sesión.

Las migraciones que bloquean un PR se marcan en el brief y se verifican en la base antes del merge.
Si un ensayo falla con "already exists", primero se revisa qué ya está aplicado en la base.

### Seguridad

- La `SERVICE_ROLE_KEY` nunca llega al cliente ni a los agentes.
- Cada endpoint tiene su propio secreto, y los secretos se comparan con `crypto.timingSafeEqual`.
- Nunca se borra y se recrea una cuenta de usuario: el `ON DELETE CASCADE` sobre `perfil` resetea el rol.

### Flujo de trabajo

- Un PR por agente: Claude y Codex no mezclan su trabajo.
- Se trabaja en local primero y luego se hace push. Si ya existe un PR para la tarea, no se abre un segundo.
- No se reformatean archivos que no son parte del cambio.

---

## Seller

**Repo:** `nessxd14/seller` · local `D:\Proyectos\pos-cation`
**Stack:** Vite 8, React 19, TypeScript 5.9, Supabase y funciones serverless de Vercel (`api/`).

### Validación

| Qué | Comando |
|---|---|
| Unit tests (Vitest, `src` y `api`) | `npm test` |
| Integración SQL sobre PGlite | `npm run test:integration` |
| Cotizaciones (PGlite) | `npm run test:quotations` |
| Lint | `npm run lint` |
| Build + typecheck | `npm run build` (`tsc -b && vite build`) |
| E2E general | `npx playwright test` |
| E2E checkout | `npx playwright test --config playwright.checkout.config.ts` |
| E2E impresión | `npm run test:print` |
| E2E caja | `npx playwright test --config playwright.cash.config.ts` (levanta `../caja-cation`, debe existir al lado) |

- El typecheck va por `npm run build`: `tsconfig.json` usa project references, así que
  `tsc --noEmit` en la raíz no revisa nada.
- `test:integration` corre sobre PGlite en memoria. Si existe `CATION_TEST_PG_URL`, solo acepta un
  Postgres local con base `cation_pruebas`. Nunca se apunta a la base de Supabase.

### Mapa del repo

- Dominio en `src/domain/`, documentado en `docs/domain/` (reglas de negocio, estados, pagos, inventario).
- Funciones serverless en `api/` (`api/caja`, `api/cron`, `api/hermes`).
- Migraciones en `supabase/migrations/` (incluidas las `*_hermes_*`), con sus ensayos en
  `supabase/ensayos/` y tests SQL en `supabase/tests/`.
- `db/migrations/` es legado: no se agregan migraciones ahí.
- Modo mock: `VITE_POS_MODE=mock`.

### Migraciones en este repo

- Nombre: `supabase/migrations/<YYYYMMDDHHMMSS>_<nombre>.sql`.
- Ensayo con el mismo prefijo: `supabase/ensayos/<YYYYMMDDHHMMSS>_<nombre>_ENSAYO.sql`
  (`BEGIN … ROLLBACK`, no deja nada en la base).
- La cabecera de la migración dice qué hace, qué migraciones requiere y si ya están aplicadas.
- Funciones `SECURITY DEFINER` con `SET search_path` fijo.
- Grants: la regla por defecto es `authenticated, service_role`. Las funciones del esquema
  `hermes_privado` se otorgan solo a `hermes_app`. En los dos casos el `REVOKE … FROM anon, public`
  va explícito en el mismo archivo.

### UI

- `DESIGN.md` y `.impeccable/design.json` mandan sobre la UI. Las reglas de estilo de ECC no las pisan.

---

## Agentes y piezas de ECC

Copiadas sin cambios de [affaan-m/ECC](https://github.com/affaan-m/ECC) v2.2.3,
commit `d2ef2680594f9a17526a6e1a2e18b3d242c5d17b`, salvo `verification-loop` (adaptada a este repo).
Para actualizarlas se vuelve a copiar desde un commit fijado, no se editan a mano.

- Agentes: `code-reviewer`, `typescript-reviewer`, `e2e-runner` y el propio `supabase-migration-reviewer`.
- Skills: `e2e-testing`, `verification-loop`.
- Reglas: `.claude/rules/ecc/common/{security,coding-style,patterns}.md` y
  `.claude/rules/ecc/typescript/{security,coding-style,patterns}.md`.
- Sin hooks, sin plugin de ECC y sin cambios en `.claude/settings.json`.

Ajustes de este repo sobre lo que dicen las piezas de ECC:

- No hay Prettier: no se corre `prettier --check` ni se reformatea nada.
- E2E con el Playwright del repo y sus configs. No se instala `agent-browser` ni otra herramienta global.
- No se exige cobertura mínima ni se escriben tests de relleno.
- El límite de tamaño de archivo de ECC es orientativo: no justifica refactors fuera del alcance del cambio.
- Agentes o skills que ECC menciona y no están instalados (`react-reviewer`, `security-reviewer`,
  `typescript-patterns`, `postgres-patterns`, etc.) se ignoran.
- Si una regla de ECC choca con este archivo, manda este archivo.
