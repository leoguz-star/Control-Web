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
  user_id          uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now()
);

insert into public.partners (name, commission_share) values
  ('VITO', 0.60),
  ('LEO',  0.40);

-- ---------------------------------------------------------------------------
-- 2. CUENTAS
--    Las 4 cuentas en USD + la cuenta BINANCE (USDT).
-- ---------------------------------------------------------------------------
create table public.accounts (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  kind             text not null check (kind in ('FIAT','CRYPTO')),
  currency         text not null,             -- 'USD' o 'USDT'
  initial_balance  numeric(18,4) not null default 0,
  sort_order       int not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

insert into public.accounts (name, kind, currency, sort_order) values
  ('EFECTIVO',      'FIAT',   'USD',  1),
  ('BOFA PERSONAL', 'FIAT',   'USD',  2),
  ('BOFA LLC',      'FIAT',   'USD',  3),
  ('EURO',          'FIAT',   'USD',  4),
  ('BINANCE',       'CRYPTO', 'USDT', 5);

-- ---------------------------------------------------------------------------
-- 3. CLIENTES
-- ---------------------------------------------------------------------------
create table public.clients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  notes      text,
  created_at timestamptz not null default now()
);

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
create or replace function public.tg_sync_commission()
returns trigger language plpgsql as $$
declare
  p record;
begin
  -- limpiar entradas previas de esa transacción (útil en UPDATE)
  delete from public.commission_entries where transaction_id = new.id;

  if new.category = 'VENTA' and coalesce(new.dif_usd, 0) > 0 then
    for p in select id, commission_share from public.partners loop
      insert into public.commission_entries (transaction_id, partner_id, kind, amount)
      values (new.id, p.id, 'ACUMULADO', round(new.dif_usd * p.commission_share, 4));
    end loop;
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
--   VENTA      -> + en account_id (entra divisa), - en BINANCE (sale USDT)
--   CAMBIO     -> - en account_id (origen),       + en destination_account_id
--   PAGO       -> - en account_id (sale plata)
--   AJUSTE+    -> + en account_id
--   AJUSTE-    -> - en account_id
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

-- Total $ de VENTAs PENDIENTES sobre EFECTIVO (alimenta la card del dashboard).
create or replace view public.cash_pending as
select
  coalesce(sum(t.monto_divisa), 0)::numeric(18,4) as efectivo_pendiente,
  count(*)::int                                    as ventas_pendientes
from public.transactions t
join public.accounts a on a.id = t.account_id
where t.category = 'VENTA'
  and t.status   = 'PENDIENTE'
  and a.name     = 'EFECTIVO';

-- Saldo actual por cuenta = initial_balance + suma de movimientos
create or replace view public.account_balances as
select
  a.id,
  a.name,
  a.kind,
  a.currency,
  a.sort_order,
  a.initial_balance + coalesce(sum(m.amount), 0) as balance
from public.accounts a
left join public.account_movements m on m.account_id = a.id
where a.is_active
group by a.id, a.name, a.kind, a.currency, a.sort_order, a.initial_balance
order by a.sort_order;

-- Agregados de Bolívares (dashboard)
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

-- Saldo de comisiones por socio
create or replace view public.partner_balances as
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

-- ---------------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
--    Política simple: cualquier usuario autenticado puede leer/escribir.
--    Endurecer más adelante si hace falta.
-- ---------------------------------------------------------------------------
alter table public.partners            enable row level security;
alter table public.accounts            enable row level security;
alter table public.clients             enable row level security;
alter table public.transactions        enable row level security;
alter table public.commission_entries  enable row level security;

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'partners','accounts','clients','transactions','commission_entries'
  ]) loop
    execute format($p$
      create policy "authed_read_%1$s"  on public.%1$s for select using (auth.role() = 'authenticated');
      create policy "authed_write_%1$s" on public.%1$s for all    using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
    $p$, t);
  end loop;
end
$$;
