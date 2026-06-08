-- ============================================================================
-- Migración 004 — Multi-socio con caja propia + RLS por dueño
-- ----------------------------------------------------------------------------
-- Modelo resultante:
--   * Cada socio (role = 'SOCIO') opera su PROPIA caja: sus propias cuentas y
--     transacciones, marcadas con owner_partner_id = su partner.
--   * La caja de la casa (admins VITO/LEO) usa owner_partner_id = NULL.
--   * Toda VENTA, sin importar de quién sea la caja, reparte su dif_usd al
--     pool 60/40 (partners con commission_share > 0). Los socios aportan
--     volumen, no comparten ganancia.
--   * RLS: un socio sólo ve/escribe lo suyo; un admin ve/escribe todo.
--   * Las vistas usan security_invoker = on, así el Dashboard filtra por sí solo.
--
-- IMPORTANTE — orden de aplicación en PRODUCCIÓN:
--   1. Haz un backup antes (Supabase → Database → Backups).
--   2. Corre TODO este archivo.
--   3. Ve a la sección [VINCULAR USUARIOS] al final y enlaza tu usuario de
--      auth con un partner ADMIN. Hasta que enlaces al menos un user_id, la
--      función is_admin() opera en modo bootstrap (todo autenticado = admin)
--      para que NO te quedes bloqueado. Al enlazar el primero, se vuelve estricta.
--
-- Idempotente: se puede correr varias veces.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ROL EN PARTNERS  (ADMIN = casa/pool, SOCIO = caja propia)
-- ---------------------------------------------------------------------------
alter table public.partners
  add column if not exists role text not null default 'SOCIO';

alter table public.partners
  drop constraint if exists partners_role_check;
alter table public.partners
  add constraint partners_role_check check (role in ('ADMIN','SOCIO'));

-- Los partners actuales del pool (VITO/LEO) son admins.
update public.partners set role = 'ADMIN' where commission_share > 0;

-- ---------------------------------------------------------------------------
-- 2. FUNCIONES DE IDENTIDAD  (base de toda la RLS)
-- ---------------------------------------------------------------------------
-- Partner del usuario logueado (NULL si no está vinculado).
create or replace function public.current_partner_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.partners where user_id = auth.uid() limit 1;
$$;

-- ¿El usuario logueado es admin?
-- Modo bootstrap: mientras NINGÚN partner tenga user_id vinculado, cualquier
-- autenticado cuenta como admin (evita auto-bloqueo al aplicar la migración).
-- En cuanto vinculas el primer user_id, pasa a ser estricta.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
           select 1 from public.partners
            where user_id = auth.uid() and role = 'ADMIN'
         )
      or not exists (
           select 1 from public.partners where user_id is not null
         );
$$;

-- ---------------------------------------------------------------------------
-- 3. PROPIEDAD DE CUENTAS  (cada socio su set; NULL = casa)
-- ---------------------------------------------------------------------------
alter table public.accounts
  add column if not exists owner_partner_id uuid references public.partners(id) on delete cascade;

-- El nombre de cuenta deja de ser único global: ahora cada socio puede tener
-- su propio 'BINANCE', 'EFECTIVO', etc. Único por (nombre, dueño).
alter table public.accounts drop constraint if exists accounts_name_key;
create unique index if not exists accounts_name_owner_key
  on public.accounts (name, owner_partner_id);

-- ---------------------------------------------------------------------------
-- 4. PROPIEDAD DE TRANSACCIONES
-- ---------------------------------------------------------------------------
-- Se añade SIN default para que las filas históricas queden como casa (NULL);
-- luego se fija el default para inserts nuevos: admins -> NULL (casa),
-- socios -> su propio partner.
alter table public.transactions
  add column if not exists owner_partner_id uuid references public.partners(id);

alter table public.transactions
  alter column owner_partner_id
  set default (case when public.is_admin() then null else public.current_partner_id() end);

create index if not exists idx_tx_owner on public.transactions(owner_partner_id);

-- ---------------------------------------------------------------------------
-- 5. COMISIONES — repartir SÓLO entre el pool (commission_share > 0)
--    El reparto ignora de quién es la caja: toda VENTA alimenta el 60/40.
-- ---------------------------------------------------------------------------
create or replace function public.tg_sync_commission()
returns trigger language plpgsql as $$
declare
  p record;
begin
  delete from public.commission_entries where transaction_id = new.id;

  if new.category = 'VENTA' and coalesce(new.dif_usd, 0) > 0 then
    for p in
      select id, commission_share from public.partners where commission_share > 0
    loop
      insert into public.commission_entries (transaction_id, partner_id, kind, amount)
      values (new.id, p.id, 'ACUMULADO', round(new.dif_usd * p.commission_share, 4));
    end loop;
  elsif new.category = 'PAGO' and new.partner_id is not null
        and coalesce(new.monto_usdt, new.monto_divisa, 0) > 0 then
    insert into public.commission_entries (transaction_id, partner_id, kind, amount)
    values (
      new.id,
      new.partner_id,
      'COBRADO',
      -1 * coalesce(new.monto_usdt, new.monto_divisa)
    );
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. VISTAS  (security_invoker = on  -> respetan la RLS del que consulta)
-- ---------------------------------------------------------------------------

-- 6a. Movimientos por cuenta. La pata BINANCE ahora apunta al BINANCE del
--     MISMO dueño que la transacción (is not distinct from maneja NULL = casa).
create or replace view public.account_movements
with (security_invoker = on) as
with moves as (
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

  -- BINANCE de la VENTA: se descuenta SIEMPRE, contra el BINANCE del dueño.
  select
    t.id,
    t.date,
    ba.id,
    -1 * coalesce(t.monto_usdt, 0)
  from public.transactions t
  join public.accounts ba
    on ba.name = 'BINANCE'
   and ba.owner_partner_id is not distinct from t.owner_partner_id
  where t.category = 'VENTA'
)
select * from moves where amount is not null and amount <> 0;

-- 6b. Saldo por cuenta — expone owner_partner_id para agrupar por caja.
--     owner_partner_id va al FINAL: create or replace sólo deja agregar columnas
--     al final (no reordenar las existentes).
create or replace view public.account_balances
with (security_invoker = on) as
select
  a.id,
  a.name,
  a.kind,
  a.currency,
  a.sort_order,
  a.initial_balance + coalesce(sum(m.amount), 0) as balance,
  a.owner_partner_id
from public.accounts a
left join public.account_movements m on m.account_id = a.id
where a.is_active
group by a.id, a.name, a.kind, a.currency, a.sort_order, a.owner_partner_id, a.initial_balance
order by a.sort_order;

-- 6c. Efectivo pendiente (1 fila). Con security_invoker cada socio ve el suyo;
--     el admin ve el agregado de todas las cajas.
create or replace view public.cash_pending
with (security_invoker = on) as
select
  coalesce(sum(t.monto_divisa), 0)::numeric(18,4) as efectivo_pendiente,
  count(*)::int                                    as ventas_pendientes
from public.transactions t
join public.accounts a on a.id = t.account_id
where t.category = 'VENTA'
  and t.status   = 'PENDIENTE'
  and a.name     = 'EFECTIVO';

-- 6d. Agregados de Bolívares.
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
from public.transactions;

-- 6e. Saldo de comisiones por socio del pool.
create or replace view public.partner_balances
with (security_invoker = on) as
select
  p.id,
  p.name,
  p.commission_share,
  coalesce(sum(case when c.kind = 'ACUMULADO' then c.amount else 0 end), 0)       as acumulado_total,
  coalesce(sum(case when c.kind = 'COBRADO'   then -c.amount else 0 end), 0)      as cobrado_total,
  coalesce(sum(c.amount), 0)                                                      as pendiente
from public.partners p
left join public.commission_entries c on c.partner_id = p.id
group by p.id, p.name, p.commission_share
order by p.name;

-- 6f. NUEVA — cajas por socio, para las tarjetas del dashboard del admin.
--     Sólo cuentas con dueño (las de la casa, owner NULL, quedan fuera).
create or replace view public.partner_cash_balances
with (security_invoker = on) as
select
  p.id    as partner_id,
  p.name  as partner_name,
  ab.id   as account_id,
  ab.name as account_name,
  ab.kind,
  ab.currency,
  ab.sort_order,
  ab.balance
from public.account_balances ab
join public.partners p on p.id = ab.owner_partner_id
order by p.name, ab.sort_order;

-- ---------------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY  — reemplaza las políticas blanket de la 1ª versión
-- ---------------------------------------------------------------------------

-- accounts: admin todo; socio sólo lo suyo.
drop policy if exists "authed_read_accounts"  on public.accounts;
drop policy if exists "authed_write_accounts" on public.accounts;
drop policy if exists accounts_select on public.accounts;
drop policy if exists accounts_write  on public.accounts;
create policy accounts_select on public.accounts for select
  using (public.is_admin() or owner_partner_id = public.current_partner_id());
create policy accounts_write on public.accounts for all
  using (public.is_admin() or owner_partner_id = public.current_partner_id())
  with check (public.is_admin() or owner_partner_id = public.current_partner_id());

-- transactions: admin todo; socio sólo lo suyo (y no puede falsear el dueño).
drop policy if exists "authed_read_transactions"  on public.transactions;
drop policy if exists "authed_write_transactions" on public.transactions;
drop policy if exists transactions_select on public.transactions;
drop policy if exists transactions_write  on public.transactions;
create policy transactions_select on public.transactions for select
  using (public.is_admin() or owner_partner_id = public.current_partner_id());
create policy transactions_write on public.transactions for all
  using (public.is_admin() or owner_partner_id = public.current_partner_id())
  with check (public.is_admin() or owner_partner_id = public.current_partner_id());

-- commission_entries: pool privado de los admins.
drop policy if exists "authed_read_commission_entries"  on public.commission_entries;
drop policy if exists "authed_write_commission_entries" on public.commission_entries;
drop policy if exists commission_entries_select on public.commission_entries;
drop policy if exists commission_entries_write  on public.commission_entries;
create policy commission_entries_select on public.commission_entries for select
  using (public.is_admin() or partner_id = public.current_partner_id());
create policy commission_entries_write on public.commission_entries for all
  using (public.is_admin())
  with check (public.is_admin());

-- partners y clients: lectura para cualquier autenticado; escritura sólo admin
-- en partners (gestionar socios) y abierta en clients (los socios crean clientes).
drop policy if exists "authed_write_partners" on public.partners;
drop policy if exists partners_write on public.partners;
create policy partners_write on public.partners for all
  using (public.is_admin())
  with check (public.is_admin());
-- (authed_read_partners y las políticas de clients se mantienen de la 1ª versión.)

-- ---------------------------------------------------------------------------
-- 8. [VINCULAR USUARIOS]  — EJECUTAR DESPUÉS, con los UUID reales
-- ---------------------------------------------------------------------------
-- Encuentra el UUID en Supabase → Authentication → Users y enlázalo:
--
--   update public.partners set user_id = '<uuid-de-leo>'  where name = 'LEO';
--   update public.partners set user_id = '<uuid-de-vito>' where name = 'VITO';
--
-- Para dar de alta un socio nuevo (después de crear su usuario en Auth):
--
--   with nuevo as (
--     insert into public.partners (name, commission_share, role, user_id)
--     values ('SOCIO_X', 0, 'SOCIO', '<uuid-del-socio>')
--     returning id
--   )
--   insert into public.accounts (name, kind, currency, sort_order, owner_partner_id)
--   select v.name, v.kind, v.currency, v.sort_order, nuevo.id
--   from nuevo,
--   (values
--     ('EFECTIVO','FIAT','USD',1),
--     ('BINANCE','CRYPTO','USDT',5)
--   ) as v(name, kind, currency, sort_order);
-- ============================================================================
