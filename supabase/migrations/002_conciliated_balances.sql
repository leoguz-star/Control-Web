-- ============================================================================
-- Migración 002 — Saldos por conciliación + Efectivo pendiente
-- 1) account_movements ahora SOLO suma transacciones CONCILIADAS, así los
--    saldos del dashboard reflejan dinero realmente acreditado.
-- 2) Nueva vista cash_pending con el total de VENTAs PENDIENTES sobre
--    EFECTIVO — alimenta la card "Efectivo pendiente".
--
-- Idempotente: se puede correr varias veces.
-- ============================================================================

create or replace view public.account_movements as
with moves as (
  -- lado "principal" (account_id)
  select
    t.id             as transaction_id,
    t.date,
    t.account_id,
    case t.category
      when 'VENTA'   then coalesce(t.monto_divisa, 0)
      when 'CAMBIO'  then -1 * coalesce(t.monto_usdt, t.monto_divisa, 0)
      when 'PAGO'    then -1 * coalesce(t.monto_usdt, t.monto_divisa, 0)
      when 'AJUSTE+' then coalesce(t.monto_divisa, t.monto_usdt, 0)
      when 'AJUSTE-' then -1 * coalesce(t.monto_divisa, t.monto_usdt, 0)
    end              as amount
  from public.transactions t
  where t.account_id is not null
    and t.status = 'CONCILIADO'

  union all

  -- lado destino (CAMBIO)
  select
    t.id,
    t.date,
    t.destination_account_id,
    coalesce(t.monto_usdt, t.monto_divisa, 0)
  from public.transactions t
  where t.category = 'CAMBIO'
    and t.destination_account_id is not null
    and t.status = 'CONCILIADO'

  union all

  -- lado BINANCE (VENTA): se descuenta el USDT entregado al cliente
  select
    t.id,
    t.date,
    (select id from public.accounts where name = 'BINANCE'),
    -1 * coalesce(t.monto_usdt, 0)
  from public.transactions t
  where t.category = 'VENTA'
    and t.status = 'CONCILIADO'
)
select * from moves where amount is not null and amount <> 0;

-- ---------------------------------------------------------------------------
-- Vista de efectivo pendiente: total $ de VENTAs PENDIENTES sobre EFECTIVO.
-- Devuelve siempre exactamente 1 fila (con ceros si no hay nada).
-- ---------------------------------------------------------------------------
create or replace view public.cash_pending as
select
  coalesce(sum(t.monto_divisa), 0)::numeric(18,4) as efectivo_pendiente,
  count(*)::int                                    as ventas_pendientes
from public.transactions t
join public.accounts a on a.id = t.account_id
where t.category = 'VENTA'
  and t.status   = 'PENDIENTE'
  and a.name     = 'EFECTIVO';
