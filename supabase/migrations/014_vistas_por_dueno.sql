-- ============================================================================
-- Migración 014 — Vistas "por dueño" para el drill-down del admin
-- ----------------------------------------------------------------------------
-- Las vistas del dashboard se auto-acotan a la caja propia (admin -> casa). Para
-- que el admin pueda ver la caja COMPLETA de un socio, se exponen variantes
-- agregadas por owner_partner_id, que el frontend filtra con el id del socio.
--
-- Siguen siendo security_invoker: la RLS protege igual (un socio que entre por
-- la URL sólo verá sus propios datos; el admin ve todas las cajas).
--
-- Saldos del socio: se reusa account_balances (ya expone owner_partner_id).
--
-- Idempotente.
-- ============================================================================

-- Bolívares por caja.
create or replace view public.bolivar_summary_by_owner
with (security_invoker = on) as
select
  owner_partner_id,
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
group by owner_partner_id;

-- Efectivo pendiente por caja.
create or replace view public.cash_pending_by_owner
with (security_invoker = on) as
select
  a.owner_partner_id,
  coalesce(sum(t.monto_divisa), 0)::numeric(18,4) as efectivo_pendiente,
  count(*)::int                                    as ventas_pendientes
from public.transactions t
join public.accounts a on a.id = t.account_id
where t.category = 'VENTA'
  and t.status   = 'PENDIENTE'
  and a.name     = 'EFECTIVO'
group by a.owner_partner_id;

-- Comisiones por caja: para cada caja (caja_partner_id), el split por partner.
-- Para la caja de un socio devuelve VITO (60%) + ese socio (40%).
create or replace view public.partner_balances_by_owner
with (security_invoker = on) as
select
  t.owner_partner_id as caja_partner_id,
  p.id               as partner_id,
  p.name,
  p.commission_share,
  coalesce(sum(case when c.kind = 'ACUMULADO' then c.amount else 0 end), 0)       as acumulado_total,
  coalesce(sum(case when c.kind = 'COBRADO'   then -c.amount else 0 end), 0)      as cobrado_total,
  coalesce(sum(c.amount), 0)                                                      as pendiente
from public.commission_entries c
join public.transactions t on t.id = c.transaction_id
join public.partners p     on p.id = c.partner_id
group by t.owner_partner_id, p.id, p.name, p.commission_share
order by p.name;
