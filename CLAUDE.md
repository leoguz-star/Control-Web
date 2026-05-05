# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start the Vite dev server.
- `npm run build` — type-check (`tsc -b`) then build with Vite. The TypeScript step will fail on `noUnusedLocals` / `noUnusedParameters`, so `build` is the canonical "does it compile" check.
- `npm run lint` — run ESLint over the repo.
- `npm run preview` — serve the production build locally.

There is no test runner configured.

Environment: copy `.env.example` to `.env` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The Supabase client throws on startup if either is missing ([src/lib/supabase.ts](src/lib/supabase.ts)).

Path alias: `@/*` → `src/*` (configured in both [tsconfig.json](tsconfig.json) and [vite.config.ts](vite.config.ts)).

## Architecture

This is a small internal tool (currency-exchange ledger) built as a thin React+Vite SPA on top of a Supabase Postgres backend. **Most business logic lives in the database, not the frontend.** Treat the SQL as the source of truth.

### Data flow

1. The app authenticates with Supabase Auth (email/password). [src/App.tsx](src/App.tsx) gates the entire router on `useAuth()` — unauthenticated users only ever see [Login.tsx](src/pages/Login.tsx).
2. Pages call Supabase directly via the singleton in [src/lib/supabase.ts](src/lib/supabase.ts). There is no API layer or global store; each page/hook issues its own queries.
3. Hooks under [src/hooks/](src/hooks/) wrap individual tables/views (`useTransactions`, `useAccounts`, `usePartners`, `useClients`). They are the closest thing to a data layer.
4. The Dashboard reads from **views**, not tables: `account_balances`, `partner_balances`, `bolivar_summary`. Mutations go to base tables (`transactions`, `clients`); the views recompute automatically.

### The schema is the business logic

[supabase/schema.sql](supabase/schema.sql) (plus the additive migration in [supabase/migrations/001_bolivar_fields.sql](supabase/migrations/001_bolivar_fields.sql)) defines:

- **Generated columns** on `transactions` (`dif_usd`, `dif_bs`, `cambio_usdt_bs`, `cambio_divisa_bs`, `comision_pago_movil_bs`, `margen_pct`). The frontend must never try to write these — they are computed by Postgres.
- **A trigger** (`tg_sync_commission`) that, on every `INSERT`/`UPDATE` of `transactions`, deletes and re-inserts rows in `commission_entries`. VENTAs split `dif_usd` between partners by `commission_share`; PAGOs record a negative COBRADO. This means the only way to "pay a partner" is to insert a `PAGO` transaction with `partner_id` set.
- **Views** (`account_movements`, `account_balances`, `partner_balances`, `bolivar_summary`, `cash_pending`) that derive everything else. Account balances follow these sign rules baked into `account_movements`:
  - VENTA → `+monto_divisa` on `account_id`, `−monto_usdt` on BINANCE
  - CAMBIO → `−` on `account_id`, `+` on `destination_account_id`
  - PAGO → `−` on `account_id`
  - AJUSTE+ / AJUSTE- → `±` on `account_id`
- `account_movements` filters to `status = 'CONCILIADO'` only — pending transactions never affect account balances. Toggling a row's status from PENDIENTE → CONCILIADO is what actually credits the destination account in the Dashboard.
- `cash_pending` is a 1-row view summing `monto_divisa` for VENTAs that are still PENDIENTE on the EFECTIVO account. The Dashboard renders it as a dashed yellow card next to EFECTIVO; once a row is conciliated it disappears from this view and shows up in `account_balances` for EFECTIVO instead.

When changing how money flows, almost always you'll be editing SQL (schema or a new migration), not TypeScript.

### Transaction categories

`category` is an enum: `VENTA | CAMBIO | PAGO | AJUSTE+ | AJUSTE-`. The five categories use the same `transactions` row but populate different fields:

- **VENTA** (sale): both USDT side (`monto_usdt`/`tasa_usdt`) and divisa side (`monto_divisa`/`tasa_divisa`) are filled. `account_id` is the FIAT account that receives the divisa. The trigger generates commission entries.
- **CAMBIO** (transfer between own accounts): `account_id` is origin, `destination_account_id` is target.
- **PAGO** (partner cash-out): `partner_id` is required. Trigger generates a COBRADO row.
- **AJUSTE+/−** (manual balance correction): only `account_id` and an amount.

[src/components/NewTransactionModal.tsx](src/components/NewTransactionModal.tsx) is the single entry point for creating any of these — its form swaps fields based on `category` and previews the same calculations the DB will redo on insert.

### Domain constants

Two business numbers are hard-coded in **both** the SQL (in generated columns) and the frontend preview ([src/components/NewTransactionModal.tsx](src/components/NewTransactionModal.tsx)):

- `BINANCE_FEE_USD = 0.06` — flat per-VENTA fee
- `PAGO_MOVIL_RATE = 0.003` — 0.3% on the Bs side when `aplica_pago_movil` is true

If either changes, both places must be updated.

### Frontend conventions

- Tailwind for styling. Custom `brand` palette in [tailwind.config.js](tailwind.config.js).
- All number formatting goes through [src/lib/format.ts](src/lib/format.ts) (`fmtUSD`, `fmtBs`, `fmtNum`, `fmtPct`, `parseNumber`). `parseNumber` accepts both `,` and `.` as decimal separators because users paste from Excel.
- The UI is in Spanish; keep new copy in Spanish to match.
- Strict TS with `noUnusedLocals` / `noUnusedParameters` — dead variables will break `npm run build`.

### Importing from Excel

The historical data lives in an Excel file that is the prior system being replaced. The `Importar` page is a stub ([src/pages/Importar.tsx](src/pages/Importar.tsx)); the `xlsx` dependency is installed for the upcoming import flow but it is not wired up yet.

## Working with Supabase changes

There is no Supabase CLI / local DB in this repo — schema changes are applied by pasting SQL into the Supabase dashboard. When adding a schema change:

1. Add a new file under `supabase/migrations/NNN_description.sql` (additive, idempotent — use `if not exists` / `create or replace`).
2. Update [supabase/schema.sql](supabase/schema.sql) to reflect the new "from-scratch" state, so a fresh DB can be bootstrapped from one file.
3. Mirror any new columns in [src/types/database.ts](src/types/database.ts).

### Edge Functions

Functions live under `supabase/functions/<name>/index.ts` (Deno). Currently:
- `extract-transaction` — receives 1-2 base64 images and calls Gemini 2.5 Flash to extract VENTA fields (USDT amount/rate, refs, total Bs, client name). Requires the `GEMINI_API_KEY` secret in the Supabase project. Frontend calls it via `supabase.functions.invoke('extract-transaction', ...)` from [src/lib/extract.ts](src/lib/extract.ts).

Deploy via Supabase dashboard (Edge Functions → New function → paste the file) or, if the CLI is available, `supabase functions deploy extract-transaction`.
