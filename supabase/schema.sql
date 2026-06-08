-- ============================================================================
-- Control Web — Esquema inicial
-- Pegar en el SQL editor de Supabase una sola vez.
-- Requiere la extensión pgcrypto (viene activa por defecto en Supabase).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. SOCIOS
-- ---------------------------------------------------------------------------
create table public.partners (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  commission_share numeric(5,4) not null check (commission_share >= 0 and commission_share <= 1),
  -- ADMIN = casa; SOCIO = caja propia.
  role             text not null default 'SOCIO' check (role in ('ADMIN','SOCIO')),
  -- Reparto de comisión por caja (ver tg_sync_commission):
  --   is_capital_partner -> recibe su % en TODA venta (VITO, 60%).
  --   is_house_operator  -> recibe el % de operador en la caja de la casa (LEO).
  is_capital_partner boolean not null default false,
  is_house_operator  boolean not null default false,
  user_id          uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now()
);

insert into public.partners (name, commission_share, role, is_capital_partner, is_house_operator) values
  ('VITO', 0.60, 'ADMIN', true,  false),
  ('LEO',  0.40, 'ADMIN', false, true);

-- Identidad del usuario logueado (base de la RLS).
create or replace function public.current_partner_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.partners where user_id = auth.uid() limit 1;
$$;

-- ¿Admin? Modo bootstrap: mientras ningún partner tenga user_id, todo
-- autenticado cuenta como admin (evita auto-bloqueo en una BD recién creada).
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
-- 2. CUENTAS
--    Las 4 cuentas en USD + la cuenta BINANCE (USDT).
-- ---------------------------------------------------------------------------
create table public.accounts (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  kind             text not null check (kind in ('FIAT','CRYPTO')),
  currency         text not null,             -- 'USD' o 'USDT'
  initial_balance  numeric(18,4) not null default 0,
  sort_order       int not null default 0,
  is_active        boolean not null default true,
  -- dueño de la caja: NULL = casa (admins); un partner = caja propia del socio.
  owner_partner_id uuid references public.partners(id) on delete cascade,
  created_at       timestamptz not null default now()
);

-- El nombre es único por dueño (cada socio puede tener su 'BINANCE', 'EFECTIVO', etc.).
create unique index accounts_name_owner_key on public.accounts (name, owner_partner_id);

insert into public.accounts (name, kind, currency, sort_order) values
  ('EFECTIVO',      'FIAT',   'USD',  1),
  ('BOFA PERSONAL', 'FIAT',   'USD',  2),
  ('BOFA LLC',      'FIAT',   'USD',  3),
  ('EURO',          'FIAT',   'USD',  4),
  ('BINANCE',       'CRYPTO', 'USDT', 5);

-- Helper: crea el set de cuentas estándar para un socio (idempotente).
--   select public.seed_partner_accounts((select id from public.partners where name = 'PEDRO'));
create or replace function public.seed_partner_accounts(p_partner_id uuid)
returns void
language sql as $$
  insert into public.accounts (name, kind, currency, sort_order, owner_partner_id)
  select v.name, v.kind, v.currency, v.sort_order, p_partner_id
  from (values
    ('EFECTIVO',      'FIAT',   'USD',  1),
    ('BOFA PERSONAL', 'FIAT',   'USD',  2),
    ('BOFA LLC',      'FIAT',   'USD',  3),
    ('EURO',          'FIAT',   'USD',  4),
    ('BINANCE',       'CRYPTO', 'USDT', 5)
  ) as v(name, kind, currency, sort_order)
  on conflict (name, owner_partner_id) do nothing;
$$;

-- ---------------------------------------------------------------------------
-- 3. CLIENTES
-- ---------------------------------------------------------------------------
create table public.clients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  notes      text,
  -- dueño de la caja: NULL = casa (admins); un partner = clientes del socio.
  -- Default: admin -> NULL; socio -> su propio partner.
  owner_partner_id uuid references public.partners(id) on delete cascade
                     default (case when public.is_admin()
                                   then null else public.current_partner_id() end),
  created_at timestamptz not null default now()
);

-- El nombre es único por dueño (cada caja puede tener su propio 'Juan').
create unique index clients_name_owner_key on public.clients (name, owner_partner_id);

-- ---------------------------------------------------------------------------
-- 4. TRANSACCIONES
-- ---------------------------------------------------------------------------
create type public.transaction_category as enum ('VENTA','CAMBIO','PAGO','AJUSTE+','AJUSTE-');
create type public.transaction_status   as enum ('PENDIENTE','CONCILIADO');

create table public.transactions (
  id                      uuid primary key default gen_random_uuid(),
  date                    date not null default current_date,
  category                public.transaction_category not null,
  description             text,

  -- cliente para VENTA; opcional para otras
  client_id               uuid references public.clients(id) on delete set null,

  -- cuenta principal afectada (origen en CAMBIO, destino en VENTA, etc.)
  account_id              uuid references public.accounts(id),
  -- solo para CAMBIO: cuenta destino
  destination_account_id  uuid references public.accounts(id),
  -- solo para PAGO: socio que cobra
  partner_id              uuid references public.partners(id),
  -- dueño de la caja a la que pertenece el movimiento (NULL = casa).
  -- Default: admins -> NULL (casa); socios -> su propio partner.
  owner_partner_id        uuid references public.partners(id)
                            default (case when public.is_admin()
                                          then null else public.current_partner_id() end),

  -- lado USDT (Binance)
  monto_usdt              numeric(18,4),
  tasa_usdt               numeric(12,4),
  ref                     text,

  -- lado divisa (cliente)
  monto_divisa            numeric(18,4),
  tasa_divisa             numeric(12,4),
  ref2                    text,

  -- costos por transacción (editables, con defaults por categoría desde la app)
  aplica_pago_movil       boolean not null default false,
  comision_binance_usd    numeric(18,4) not null default 0,

  -- columnas calculadas (todas derivan solo de columnas reales)
  dif_usd numeric(18,4) generated always as (
    case when category = 'VENTA'
         then coalesce(monto_divisa, 0) - coalesce(monto_usdt, 0)
         else 0
    end
  ) stored,

  cambio_usdt_bs numeric(18,4) generated always as (
    coalesce(monto_usdt, 0) * coalesce(tasa_usdt, 0)
  ) stored,

  cambio_divisa_bs numeric(18,4) generated always as (
    coalesce(monto_divisa, 0) * coalesce(tasa_divisa, 0)
  ) stored,

  dif_bs numeric(18,4) generated always as (
    case when category = 'VENTA'
         then coalesce(monto_usdt, 0) * coalesce(tasa_usdt, 0)
            - coalesce(monto_divisa, 0) * coalesce(tasa_divisa, 0)
         else 0
    end
  ) stored,

  comision_pago_movil_bs numeric(18,4) generated always as (
    case when aplica_pago_movil and category = 'VENTA'
         then coalesce(monto_usdt, 0) * coalesce(tasa_usdt, 0) * 0.003
         else 0
    end
  ) stored,

  margen_pct numeric(10,4) generated always as (
    case when category = 'VENTA' and coalesce(monto_divisa, 0) > 0
         then round(
                ((coalesce(monto_divisa, 0) - coalesce(monto_usdt, 0))
                 / monto_divisa) * 100,
                4
              )
         else null
    end
  ) stored,

  status                  public.transaction_status not null default 'PENDIENTE',

  -- auditoría
  created_by              uuid references auth.users(id) default auth.uid(),
  updated_by              uuid references auth.users(id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index idx_tx_date        on public.transactions(date desc);
create index idx_tx_category    on public.transactions(category);
create index idx_tx_account     on public.transactions(account_id);
create index idx_tx_client      on public.transactions(client_id);
create index idx_tx_status      on public.transactions(status);
create index idx_tx_owner       on public.transactions(owner_partner_id);

-- Trigger para mantener updated_at / updated_by
create or replace function public.tg_set_updated_meta()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger trg_tx_updated
  before update on public.transactions
  for each row execute function public.tg_set_updated_meta();

-- ---------------------------------------------------------------------------
-- 5. COMISIONES
--    Cada VENTA genera dos filas ACUMULADO (una por socio).
--    Cada PAGO genera una fila COBRADO (negativa) para el socio indicado.
-- ---------------------------------------------------------------------------
create type public.commission_kind as enum ('ACUMULADO','COBRADO');

create table public.commission_entries (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  partner_id     uuid not null references public.partners(id),
  kind           public.commission_kind not null,
  amount         numeric(18,4) not null,   -- ACUMULADO positivo, COBRADO negativo
  created_at     timestamptz not null default now()
);

create index idx_ce_partner on public.commission_entries(partner_id);
create index idx_ce_tx      on public.commission_entries(transaction_id);

-- Función que reparte la comisión al insertar/actualizar una VENTA
-- o registrar el cobro de un PAGO.
-- SECURITY DEFINER: corre como su dueño para saltar la RLS de commission_entries
-- (sólo admins escriben). Así un socio puede registrar una VENTA y el trigger
-- genera las comisiones sin que la RLS lo bloquee.
create or replace function public.tg_sync_commission()
returns trigger language plpgsql
security definer set search_path = public as $$
declare
  cap      record;
  op_id    uuid;
  op_share numeric;
begin
  -- limpiar entradas previas de esa transacción (útil en UPDATE)
  delete from public.commission_entries where transaction_id = new.id;

  if new.category = 'VENTA' and coalesce(new.dif_usd, 0) > 0 then
    -- Socio(s) capital: su % sobre TODA venta (VITO 60%).
    for cap in select id, commission_share from public.partners where is_capital_partner loop
      insert into public.commission_entries (transaction_id, partner_id, kind, amount)
      values (new.id, cap.id, 'ACUMULADO', round(new.dif_usd * cap.commission_share, 4));
    end loop;

    -- Operador de la caja: el dueño; si es la casa (NULL), el operador de la casa (LEO).
    op_id := coalesce(
      new.owner_partner_id,
      (select id from public.partners where is_house_operator limit 1)
    );

    if op_id is not null
       and not exists (select 1 from public.partners where id = op_id and is_capital_partner) then
      select commission_share into op_share from public.partners where id = op_id;
      insert into public.commission_entries (transaction_id, partner_id, kind, amount)
      values (new.id, op_id, 'ACUMULADO', round(new.dif_usd * coalesce(op_share, 0), 4));
    end if;

  elsif new.category = 'PAGO' and new.partner_id is not null and coalesce(new.monto_usdt, new.monto_divisa, 0) > 0 then
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

create trigger trg_tx_commission_ins
  after insert on public.transactions
  for each row execute function public.tg_sync_commission();

create trigger trg_tx_commission_upd
  after update on public.transactions
  for each row execute function public.tg_sync_commission();

-- ---------------------------------------------------------------------------
-- 6. VISTAS DE SALDOS
-- ---------------------------------------------------------------------------

-- Movimiento por cuenta derivado de cada transacción.
-- Las reglas de signo:
--   VENTA      -> + en account_id (entra divisa, solo CONCILIADO),
--                 - en BINANCE   (sale USDT, SIEMPRE — la venta en Binance ya
--                                 se ejecutó aunque el efectivo aún no entre)
--   CAMBIO     -> - en account_id (origen),       + en destination_account_id
--   PAGO       -> - en account_id (sale plata)
--   AJUSTE+    -> + en account_id
--   AJUSTE-    -> - en account_id
create or replace view public.account_movements
with (security_invoker = on) as
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

  -- lado BINANCE (VENTA): se descuenta el USDT SIEMPRE, contra el BINANCE del
  -- MISMO dueño que la transacción (is not distinct from maneja NULL = casa).
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

-- Total $ de VENTAs PENDIENTES sobre EFECTIVO (alimenta la card del dashboard).
-- Acotado a la caja propia: admin -> casa (owner NULL); socio -> la suya.
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

-- Saldo actual por cuenta = initial_balance + suma de movimientos
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

-- Saldos de la caja propia del que consulta (alimenta "Saldos" del Dashboard):
--   admin -> cuentas de la casa (owner NULL); socio -> sus propias cuentas.
create or replace view public.my_account_balances
with (security_invoker = on) as
select ab.*
from public.account_balances ab
where ab.owner_partner_id is not distinct from
      (case when public.is_admin() then null else public.current_partner_id() end);

-- Cajas por socio (para las tarjetas del dashboard del admin).
-- Sólo cuentas con dueño; las de la casa (owner NULL) quedan fuera.
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

-- Agregados de Bolívares (dashboard)
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
    -- Pago móvil en $: sólo si hay tasa en Bs (consistente con comision_pago_movil_bs).
    - case when aplica_pago_movil and coalesce(tasa_usdt, 0) > 0
           then coalesce(monto_usdt, 0) * 0.003 else 0 end
  ) filter (where category = 'VENTA'), 0)                                       as dif_usd_neto_total
from public.transactions
-- Acotado a la caja propia: admin -> casa (owner NULL); socio -> la suya.
where owner_partner_id is not distinct from
      (case when public.is_admin() then null else public.current_partner_id() end);

-- Saldo de comisiones por socio, contabilizado POR CAJA (sin cruce entre cuentas).
-- Sólo suma comisiones de transacciones de la caja del que consulta (casa =
-- owner NULL para admin; la suya para el socio) y muestra los partners relevantes:
--   * admin (casa) -> VITO (capital) + LEO (operador de la casa).
--   * socio        -> VITO (capital) + él mismo.
-- LEFT JOIN para que las tarjetas salgan aunque estén en 0.
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
left join public.commission_entries c
       on c.partner_id = p.id
      and exists (
            select 1 from public.transactions t
             where t.id = c.transaction_id
               and t.owner_partner_id is not distinct from
                   (case when public.is_admin() then null else public.current_partner_id() end)
          )
where p.is_capital_partner
   or (public.is_admin()       and p.is_house_operator)
   or (not public.is_admin()   and p.id = public.current_partner_id())
group by p.id, p.name, p.commission_share
order by p.name;

-- Variantes "por dueño" para el drill-down del admin (caja completa de un socio).
-- Saldos del socio: se reusa account_balances filtrado por owner_partner_id.
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

-- ---------------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
--    Admin (casa) ve/escribe todo; socio sólo su propia caja.
-- ---------------------------------------------------------------------------
alter table public.partners            enable row level security;
alter table public.accounts            enable row level security;
alter table public.clients             enable row level security;
alter table public.transactions        enable row level security;
alter table public.commission_entries  enable row level security;

-- partners: lectura para cualquier autenticado; escritura sólo admin.
create policy "authed_read_partners" on public.partners for select
  using (auth.role() = 'authenticated');
create policy partners_write on public.partners for all
  using (public.is_admin()) with check (public.is_admin());

-- clients: por caja. Admin todo; socio sólo los suyos.
create policy clients_select on public.clients for select
  using (public.is_admin() or owner_partner_id = public.current_partner_id());
create policy clients_write on public.clients for all
  using (public.is_admin() or owner_partner_id = public.current_partner_id())
  with check (public.is_admin() or owner_partner_id = public.current_partner_id());

-- accounts: admin todo; socio sólo lo suyo.
create policy accounts_select on public.accounts for select
  using (public.is_admin() or owner_partner_id = public.current_partner_id());
create policy accounts_write on public.accounts for all
  using (public.is_admin() or owner_partner_id = public.current_partner_id())
  with check (public.is_admin() or owner_partner_id = public.current_partner_id());

-- transactions: admin todo; socio sólo lo suyo (no puede falsear el dueño).
create policy transactions_select on public.transactions for select
  using (public.is_admin() or owner_partner_id = public.current_partner_id());
create policy transactions_write on public.transactions for all
  using (public.is_admin() or owner_partner_id = public.current_partner_id())
  with check (public.is_admin() or owner_partner_id = public.current_partner_id());

-- commission_entries: admin todo; el socio ve las comisiones de SUS propias
-- transacciones (su 40% y la línea de VITO 60% sobre su caja).
create policy commission_entries_select on public.commission_entries for select
  using (
    public.is_admin()
    or partner_id = public.current_partner_id()
    or exists (
         select 1 from public.transactions t
          where t.id = transaction_id
            and t.owner_partner_id = public.current_partner_id()
       )
  );
create policy commission_entries_write on public.commission_entries for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 8. REGISTRO DE AUDITORÍA
--    Trigger a nivel de BD que captura toda creación/edición/borrado en
--    transactions, clients y accounts (quién, cuándo, qué cambió).
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id               uuid primary key default gen_random_uuid(),
  table_name       text not null,
  record_id        uuid,
  action           text not null check (action in ('INSERT','UPDATE','DELETE')),
  actor_user_id    uuid,
  actor_partner_id uuid references public.partners(id),
  owner_partner_id uuid,             -- caja del registro afectado (NULL = casa)
  changed_fields   text[],
  old_data         jsonb,
  new_data         jsonb,
  created_at       timestamptz not null default now()
);

create index idx_audit_owner     on public.audit_log(owner_partner_id);
create index idx_audit_actor      on public.audit_log(actor_partner_id);
create index idx_audit_created    on public.audit_log(created_at desc);
create index idx_audit_table_rec  on public.audit_log(table_name, record_id);

create or replace function public.tg_audit()
returns trigger
language plpgsql
security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  v_new jsonb := case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) else null end;
  v_changed text[];
  v_ignore  text[] := array[
    'updated_at','updated_by','created_at','created_by',
    'dif_usd','cambio_usdt_bs','cambio_divisa_bs','dif_bs',
    'comision_pago_movil_bs','margen_pct'
  ];
begin
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key)
      into v_changed
    from jsonb_each(v_new) n
    where n.value is distinct from (v_old -> n.key)
      and not (n.key = any(v_ignore));
    if v_changed is null then return new; end if;  -- solo metadata/generadas
  end if;

  insert into public.audit_log(
    table_name, record_id, action, actor_user_id, actor_partner_id,
    owner_partner_id, changed_fields, old_data, new_data)
  values (
    tg_table_name,
    coalesce((v_new->>'id')::uuid, (v_old->>'id')::uuid),
    tg_op,
    auth.uid(),
    public.current_partner_id(),
    coalesce((v_new->>'owner_partner_id')::uuid, (v_old->>'owner_partner_id')::uuid),
    v_changed, v_old, v_new
  );

  return coalesce(new, old);
end;
$$;

create trigger trg_audit_transactions
  after insert or update or delete on public.transactions
  for each row execute function public.tg_audit();
create trigger trg_audit_clients
  after insert or update or delete on public.clients
  for each row execute function public.tg_audit();
create trigger trg_audit_accounts
  after insert or update or delete on public.accounts
  for each row execute function public.tg_audit();

alter table public.audit_log enable row level security;
create policy audit_select on public.audit_log for select
  using (public.is_admin());

-- Vista con nombres legibles para el frontend.
create or replace view public.audit_log_view
with (security_invoker = on) as
select
  al.id, al.table_name, al.record_id, al.action,
  al.actor_partner_id, ap.name as actor_name,
  al.owner_partner_id,  op.name as owner_name,
  al.changed_fields, al.old_data, al.new_data, al.created_at
from public.audit_log al
left join public.partners ap on ap.id = al.actor_partner_id
left join public.partners op on op.id = al.owner_partner_id
order by al.created_at desc;
