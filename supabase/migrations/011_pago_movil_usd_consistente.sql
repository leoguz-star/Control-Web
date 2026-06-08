-- ============================================================================
-- Migración 011 — Pago móvil en $ consistente con el de Bs
-- ----------------------------------------------------------------------------
-- Bug: comision_pago_movil_bs = monto_usdt * tasa_usdt * 0.003  (0 si no hay
-- tasa en Bs). Pero "DIF $ neto" restaba monto_usdt * 0.003 SIEMPRE, aun en
-- ventas solo en dólares (sin tasa). Resultado: el pago móvil salía 0 Bs pero
-- igual descontaba ~1.35 $, dejando el neto en 48.59 en vez de 49.94.
--
-- Fix: el pago móvil en $ sólo aplica cuando hay tasa en Bs (tasa_usdt > 0),
-- igual que el de Bs.
--
-- Idempotente. (No cambia las columnas de la vista, sólo la fórmula.)
-- ============================================================================

create or replace view public.bolivar_summary
with (security_invoker = on) as
select
  count(*)                                    filter (where category = 'VENTA') as ventas_count,
  coalesce(sum(dif_bs), 0)                                                      as dif_bs_total,
  coalesce(sum(comision_pago_movil_bs), 0)                                      as comision_pago_movil_total,
  coalesce(sum(comision_binance_usd), 0)                                        as comision_binance_total,
  coalesce(sum(dif_bs - comision_pago_movil_bs), 0)                             as dif_bs_neto_total,
  coalesce(sum(
    (coalesce(monto_divisa, 0) - coalesce(monto_usdt, 0))
    - coalesce(comision_binance_usd, 0)
    - case when aplica_pago_movil and coalesce(tasa_usdt, 0) > 0
           then coalesce(monto_usdt, 0) * 0.003 else 0 end
  ) filter (where category = 'VENTA'), 0)                                       as dif_usd_neto_total
from public.transactions
where owner_partner_id is not distinct from
      (case when public.is_admin() then null else public.current_partner_id() end);
