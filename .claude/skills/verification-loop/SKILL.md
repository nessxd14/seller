---
name: verification-loop
description: Run the Seller's verification — build and typecheck, lint, unit tests, SQL integration tests, targeted E2E, security grep and diff review — then produce a PASS/FAIL report. Use after finishing a feature or refactor, before opening a PR, or when quality gates must pass.
license: MIT
metadata:
  origin: ECC v2.2.3 (d2ef2680594f9a17526a6e1a2e18b3d242c5d17b), adapted for nessxd14/seller
---

# Verification Loop — Seller

Adapted from ECC's `verification-loop`. Commands are the ones in `package.json`; `AGENTS.md` wins
if they ever disagree. They work the same in PowerShell (Ness's machine) and bash.

## When to Use

- After completing a feature or significant change
- Before opening a PR (and before saying a PR is ready)
- After a refactor

## Phases

### 1. Build + typecheck
```
npm run build
```
`build` is `tsc -b && vite build`, so it is also the typecheck. Do not run `tsc --noEmit` at the root:
`tsconfig.json` only has project references and checks nothing. If the build fails, STOP and fix it.

### 2. Lint
```
npm run lint
```
There is no Prettier in this repo. Do not run a formatter and do not reformat files outside the change.

### 3. Unit tests
```
npm test
```
Runs Vitest over `src` and `api`. Report passed / failed. There is no coverage target; do not add
tests just to raise coverage.

### 4. SQL integration (when `supabase/` changed or the change calls a changed RPC)
```
npm run test:integration
npm run test:quotations   # only if quotations are involved
```
Both run on in-memory PGlite. Never point them at Supabase. If `CATION_TEST_PG_URL` is set, it must be a
local `cation_pruebas` database.

If the change adds or edits a migration, also run the `supabase-migration-reviewer` agent.

### 5. E2E (only the configs the change touches)
```
npx playwright test                                          # general flows (vite preview on :4173)
npx playwright test --config playwright.checkout.config.ts   # checkout
npm run test:print                                           # printing
npx playwright test --config playwright.cash.config.ts       # caja — needs ../caja-cation next to this repo
```
If an E2E config cannot run locally (missing `../caja-cation`, no browsers installed), say so in the
report instead of marking it PASS.

### 6. Security scan
```
git grep -n -E "SERVICE_ROLE|service_role_key|sk-[A-Za-z0-9]{10,}" -- src
git grep -n -E "(===|!==)[[:space:]]*(process\.env\.|.Bearer)" -- api
git grep -n "console.log" -- src api
```
- Nothing under `src/` may reference the service role key — `src/` ships to the browser.
- Secret comparisons in `api/` must use `crypto.timingSafeEqual`, not `===` / `!==`.
- `console.log` left in changed files is a finding; pre-existing ones outside the change are not.

### 7. Diff review
```
git diff --stat main...HEAD
git diff --name-only main...HEAD
```
Check every changed file for: changes outside the task, reformatting noise, files that belong to
another agent's PR, missing error handling, and edge cases.

## Target acceptance

Local checks passing is not the same as working in production. If the task needs the deployed app or the
database, report it separately: environment, evidence, and the next permitted step. Migrations that block
the PR must be applied by Ness (or with his explicit permission) and verified with a clean `SELECT` in
another session before the merge. Never apply a migration or touch production on your own.

## Report

```
VERIFICACIÓN — Seller
=====================
Build/tipos:   [PASS/FAIL]
Lint:          [PASS/FAIL] (N avisos)
Unit tests:    [PASS/FAIL] (X/Y)
Integración:   [PASS/FAIL/NO APLICA]
E2E:           [PASS/FAIL/NO EJECUTADO] (configs: …)
Seguridad:     [PASS/FAIL] (N hallazgos)
Diff:          [N archivos] — fuera de alcance: [ninguno / lista]

General:       [LISTO / NO LISTO] para PR
Destino:       [VERIFICADO/FALLÓ/NO REALIZADO/NO APLICA] (entorno, evidencia)
Migraciones que bloquean el merge: [ninguna / lista]
Siguiente paso permitido: […]

Para corregir:
1. …
```
