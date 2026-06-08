-- ============================================================================
-- Migración 015 — Registro de auditoría (quién hizo qué, cuándo y qué cambió)
-- ----------------------------------------------------------------------------
-- Un trigger a nivel de BD captura TODA creación/edición/borrado en
-- transactions, clients y accounts. Registra: actor (usuario/socio), acción,
-- caja (owner), campos que cambiaron y los datos antes/después (jsonb).
-- Como es a nivel de BD, captura todo sin importar desde dónde se haga.
--
-- Idempotente.
-- ============================================================================

create table if not exists public.audit_log (
  id               uuid primary key default gen_random_uuid(),
  table_name       text not null,
  record_id        uuid,
  action           text not null check (action in ('INSERT','UPDATE','DELETE')),
  actor_user_id    uuid,
  actor_partner_id uuid references public.partners(id),
  owner_partner_id uuid,             -- caja del registro afectado (NULL = casa)
  changed_fields   text[],           -- solo en UPDATE
  old_data         jsonb,
  new_data         jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists idx_audit_owner    on public.audit_log(owner_partner_id);
create index if not exists idx_audit_actor    on public.audit_log(actor_partner_id);
create index if not exists idx_audit_created  on public.audit_log(created_at desc);
create index if not exists idx_audit_table_rec on public.audit_log(table_name, record_id);

-- Columnas que NO cuentan como "cambio" (metadata y columnas generadas).
-- Función de trigger genérica.
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
    -- Si solo cambió metadata/generadas, no registrar.
    if v_changed is null then return new; end if;
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
    v_changed,
    v_old,
    v_new
  );

  return coalesce(new, old);
end;
$$;

-- Adjuntar a las tablas que queremos auditar.
drop trigger if exists trg_audit_transactions on public.transactions;
create trigger trg_audit_transactions
  after insert or update or delete on public.transactions
  for each row execute function public.tg_audit();

drop trigger if exists trg_audit_clients on public.clients;
create trigger trg_audit_clients
  after insert or update or delete on public.clients
  for each row execute function public.tg_audit();

drop trigger if exists trg_audit_accounts on public.accounts;
create trigger trg_audit_accounts
  after insert or update or delete on public.accounts
  for each row execute function public.tg_audit();

-- RLS: solo el admin lee el log. El trigger (definer) es el único que escribe.
alter table public.audit_log enable row level security;
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select
  using (public.is_admin());

-- Vista con nombres legibles para el frontend.
create or replace view public.audit_log_view
with (security_invoker = on) as
select
  al.id,
  al.table_name,
  al.record_id,
  al.action,
  al.actor_partner_id,
  ap.name as actor_name,
  al.owner_partner_id,
  op.name as owner_name,
  al.changed_fields,
  al.old_data,
  al.new_data,
  al.created_at
from public.audit_log al
left join public.partners ap on ap.id = al.actor_partner_id
left join public.partners op on op.id = al.owner_partner_id
order by al.created_at desc;
