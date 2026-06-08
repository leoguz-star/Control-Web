-- ============================================================================
-- ROLLBACK de la migración 004 — vuelve al modelo de "todos ven todo".
-- Úsalo sólo si necesitas revertir. NO borra las cuentas/transacciones de
-- socios que ya hayas creado (eso hazlo a mano si aplica).
-- ============================================================================

-- 1. Restaurar políticas blanket (cualquier autenticado lee/escribe todo).
do $$
declare t text;
begin
  for t in select unnest(array['accounts','transactions','commission_entries']) loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write',  t);
    execute format($p$
      create policy "authed_read_%1$s"  on public.%1$s for select using (auth.role() = 'authenticated');
      create policy "authed_write_%1$s" on public.%1$s for all    using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
    $p$, t);
  end loop;
end $$;

drop policy if exists partners_write on public.partners;
create policy "authed_write_partners" on public.partners for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 2. Vistas sin security_invoker y BINANCE global (estado de la migración 003).
drop view if exists public.partner_cash_balances;

create or replace view public.account_movements as
with moves as (
  select t.id as transaction_id, t.date, t.account_id,
    case t.category
      when 'VENTA'   then coalesce(t.monto_divisa, 0)
      when 'CAMBIO'  then -1 * coalesce(t.monto_usdt, t.monto_divisa, 0)
      when 'PAGO'    then -1 * coalesce(t.monto_usdt, t.monto_divisa, 0)
      when 'AJUSTE+' then coalesce(t.monto_divisa, t.monto_usdt, 0)
      when 'AJUSTE-' then -1 * coalesce(t.monto_divisa, t.monto_usdt, 0)
    end as amount
  from public.transactions t
  where t.account_id is not null and t.status = 'CONCILIADO'
  union all
  select t.id, t.date, t.destination_account_id, coalesce(t.monto_usdt, t.monto_divisa, 0)
  from public.transactions t
  where t.category = 'CAMBIO' and t.destination_account_id is not null and t.status = 'CONCILIADO'
  union all
  select t.id, t.date, (select id from public.accounts where name = 'BINANCE'),
         -1 * coalesce(t.monto_usdt, 0)
  from public.transactions t where t.category = 'VENTA'
)
select * from moves where amount is not null and amount <> 0;

create or replace view public.account_balances as
select a.id, a.name, a.kind, a.currency, a.sort_order,
       a.initial_balance + coalesce(sum(m.amount), 0) as balance
from public.accounts a
left join public.account_movements m on m.account_id = a.id
where a.is_active
group by a.id, a.name, a.kind, a.currency, a.sort_order, a.initial_balance
order by a.sort_order;

create or replace view public.cash_pending as
select coalesce(sum(t.monto_divisa), 0)::numeric(18,4) as efectivo_pendiente,
       count(*)::int as ventas_pendientes
from public.transactions t
join public.accounts a on a.id = t.account_id
where t.category = 'VENTA' and t.status = 'PENDIENTE' and a.name = 'EFECTIVO';

create or replace view public.bolivar_summary as
select
  count(*) filter (where category = 'VENTA') as ventas_count,
  coalesce(sum(dif_bs), 0) as dif_bs_total,
  coalesce(sum(comision_pago_movil_bs), 0) as comision_pago_movil_total,
  coalesce(sum(comision_binance_usd), 0) as comision_binance_total,
  coalesce(sum(dif_bs - comision_pago_movil_bs), 0) as dif_bs_neto_total,
  coalesce(sum(
    (coalesce(monto_divisa, 0) - coalesce(monto_usdt, 0))
    - coalesce(comision_binance_usd, 0)
    - case when aplica_pago_movil then coalesce(monto_usdt, 0) * 0.003 else 0 end
  ) filter (where category = 'VENTA'), 0) as dif_usd_neto_total
from public.transactions;

create or replace view public.partner_balances as
select p.id, p.name, p.commission_share,
  coalesce(sum(case when c.kind = 'ACUMULADO' then c.amount else 0 end), 0) as acumulado_total,
  coalesce(sum(case when c.kind = 'COBRADO' then -c.amount else 0 end), 0)  as cobrado_total,
  coalesce(sum(c.amount), 0) as pendiente
from public.partners p
left join public.commission_entries c on c.partner_id = p.id
group by p.id, p.name, p.commission_share
order by p.name;

-- 3. Trigger de comisiones: volver a repartir entre TODOS los partners.
create or replace function public.tg_sync_commission()
returns trigger language plpgsql as $$
declare p record;
begin
  delete from public.commission_entries where transaction_id = new.id;
  if new.category = 'VENTA' and coalesce(new.dif_usd, 0) > 0 then
    for p in select id, commission_share from public.partners loop
      insert into public.commission_entries (transaction_id, partner_id, kind, amount)
      values (new.id, p.id, 'ACUMULADO', round(new.dif_usd * p.commission_share, 4));
    end loop;
  elsif new.category = 'PAGO' and new.partner_id is not null
        and coalesce(new.monto_usdt, new.monto_divisa, 0) > 0 then
    insert into public.commission_entries (transaction_id, partner_id, kind, amount)
    values (new.id, new.partner_id, 'COBRADO', -1 * coalesce(new.monto_usdt, new.monto_divisa));
  end if;
  return new;
end;
$$;

-- 4. Quitar columnas/funciones nuevas. (Deja accounts_name_key como índice único
--    por nombre; si tienes cuentas duplicadas de socios, resuélvelas antes.)
alter table public.transactions drop column if exists owner_partner_id;
drop index  if exists public.accounts_name_owner_key;
alter table public.accounts     drop column if exists owner_partner_id;
alter table public.partners     drop column if exists role;
drop function if exists public.is_admin();
drop function if exists public.current_partner_id();
