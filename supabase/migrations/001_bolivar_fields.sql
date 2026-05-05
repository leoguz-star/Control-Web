-- ============================================================================
-- Migración 001 — Campos de Bolívares
-- Agrega cálculo de ganancia en Bs, comisión Binance ($0.06 fija) y pago móvil
-- (0.3% sobre el cambio en Bs).
--
-- Pegar en el SQL editor de Supabase UNA SOLA VEZ sobre una BD ya inicializada
-- con schema.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columnas nuevas (editables)
-- ---------------------------------------------------------------------------
alter table public.transactions
  add column if not exists aplica_pago_movil    boolean not null default false,
  add column if not exists comision_binance_usd numeric(18,4) not null default 0;

-- Backfill: las VENTAs ya registradas asumimos que usaron pago móvil y pagaron
-- la comisión estándar de Binance. Si alguna no aplica, se edita a mano.
update public.transactions
set aplica_pago_movil    = true,
    comision_binance_usd = 0.06
where category = 'VENTA'
  and aplica_pago_movil = false
  and comision_binance_usd = 0;

-- ---------------------------------------------------------------------------
-- 2. Columnas calculadas (generated columns)
-- ---------------------------------------------------------------------------
alter table public.transactions
  add column if not exists cambio_usdt_bs numeric(18,4) generated always as (
    coalesce(monto_usdt, 0) * coalesce(tasa_usdt, 0)
  ) stored;

alter table public.transactions
  add column if not exists cambio_divisa_bs numeric(18,4) generated always as (
    coalesce(monto_divisa, 0) * coalesce(tasa_divisa, 0)
  ) stored;

alter table public.transactions
  add column if not exists dif_bs numeric(18,4) generated always as (
    case when category = 'VENTA'
         then coalesce(monto_usdt, 0) * coalesce(tasa_usdt, 0)
            - coalesce(monto_divisa, 0) * coalesce(tasa_divisa, 0)
         else 0
    end
  ) stored;

alter table public.transactions
  add column if not exists comision_pago_movil_bs numeric(18,4) generated always as (
    case when aplica_pago_movil and category = 'VENTA'
         then coalesce(monto_usdt, 0) * coalesce(tasa_usdt, 0) * 0.003
         else 0
    end
  ) stored;

alter table public.transactions
  add column if not exists margen_pct numeric(10,4) generated always as (
    case when category = 'VENTA' and coalesce(monto_divisa, 0) > 0
         then round(
                ((coalesce(monto_divisa, 0) - coalesce(monto_usdt, 0))
                 / monto_divisa) * 100,
                4
              )
         else null
    end
  ) stored;

-- ---------------------------------------------------------------------------
-- 3. Vista agregada para el panel de Bolívares
-- ---------------------------------------------------------------------------
create or replace view public.bolivar_summary as
select
  count(*)                                    filter (where category = 'VENTA') as ventas_count,
  coalesce(sum(dif_bs), 0)                                                      as dif_bs_total,
  coalesce(sum(comision_pago_movil_bs), 0)                                      as comision_pago_movil_total,
  coalesce(sum(comision_binance_usd), 0)                                        as comision_binance_total,
  coalesce(sum(dif_bs - comision_pago_movil_bs), 0)                             as dif_bs_neto_total,
  coalesce(sum(
    (coalesce(monto_divisa, 0) - coalesce(monto_usdt, 0))
    - coalesce(comision_binance_usd, 0)
    - case when aplica_pago_movil then coalesce(monto_usdt, 0) * 0.003 else 0 end
  ) filter (where category = 'VENTA'), 0)                                       as dif_usd_neto_total
from public.transactions;
