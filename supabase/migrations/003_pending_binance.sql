-- ============================================================================
-- Migración 003 — VENTAs PENDIENTES también descuentan de BINANCE
-- La venta en Binance se ejecuta para fondear la compra de divisa, así que el
-- USDT ya salió aunque el efectivo del cliente aún no se haya entregado.
-- A partir de ahora la pata BINANCE de una VENTA se descuenta siempre,
-- independientemente del status. La pata de divisa (account_id) sigue
-- gateada por status = 'CONCILIADO', así "Efectivo pendiente" se mantiene
-- como indicador de cash en tránsito.
--
-- Idempotente: se puede correr varias veces.
-- ============================================================================

create or replace view public.account_movements as
with moves as (
  -- lado "principal" (account_id): solo cuando está CONCILIADO
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

  -- lado destino (CAMBIO): solo cuando está CONCILIADO
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

  -- lado BINANCE (VENTA): se descuenta el USDT SIEMPRE, sin importar el status.
  -- La venta en Binance ya se ejecutó; el status sólo refleja si el efectivo
  -- del cliente ya entró en la cuenta de divisa.
  select
    t.id,
    t.date,
    (select id from public.accounts where name = 'BINANCE'),
    -1 * coalesce(t.monto_usdt, 0)
  from public.transactions t
  where t.category = 'VENTA'
)
select * from moves where amount is not null and amount <> 0;
