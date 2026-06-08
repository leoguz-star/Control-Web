-- ============================================================================
-- Migración 007 — "Saldos" muestra sólo la caja propia del que consulta
-- ----------------------------------------------------------------------------
-- Problema: un admin (LEO) ve en "Saldos" las cuentas de la casa Y las de cada
-- socio (EFECTIVO/BINANCE duplicados). Las cajas de los socios deben ir en una
-- sección aparte, no mezcladas con la caja de la casa.
--
-- Solución: una vista que devuelve sólo la caja del que mira:
--   * admin -> cuentas de la casa (owner_partner_id IS NULL).
--   * socio -> sus propias cuentas.
-- Y cash_pending se acota igual (el "EFECTIVO PEND." de la casa no suma el de
-- los socios).
--
-- Idempotente.
-- ============================================================================

-- Saldos de la caja propia del usuario logueado.
create or replace view public.my_account_balances
with (security_invoker = on) as
select ab.*
from public.account_balances ab
where ab.owner_partner_id is not distinct from
      (case when public.is_admin() then null else public.current_partner_id() end);

-- Efectivo pendiente, acotado a la caja propia.
create or replace view public.cash_pending
with (security_invoker = on) as
select
  coalesce(sum(t.monto_divisa), 0)::numeric(18,4) as efectivo_pendiente,
  count(*)::int                                    as ventas_pendientes
from public.transactions t
join public.accounts a on a.id = t.account_id
where t.category = 'VENTA'
  and t.status   = 'PENDIENTE'
  and a.name     = 'EFECTIVO'
  and a.owner_partner_id is not distinct from
      (case when public.is_admin() then null else public.current_partner_id() end);
