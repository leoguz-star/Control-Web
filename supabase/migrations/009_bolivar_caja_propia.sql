-- ============================================================================
-- Migración 009 — "Bolívares" del dashboard, acotado a la caja propia
-- ----------------------------------------------------------------------------
-- bolivar_summary agregaba TODAS las transacciones, así que para el admin
-- mezclaba la casa con los socios. Se acota a la caja del que consulta, igual
-- que my_account_balances y cash_pending:
--   admin -> casa (owner NULL); socio -> la suya.
--
-- Idempotente.
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
    - case when aplica_pago_movil then coalesce(monto_usdt, 0) * 0.003 else 0 end
  ) filter (where category = 'VENTA'), 0)                                       as dif_usd_neto_total
from public.transactions
where owner_partner_id is not distinct from
      (case when public.is_admin() then null else public.current_partner_id() end);
