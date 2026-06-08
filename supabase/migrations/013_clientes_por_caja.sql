-- ============================================================================
-- Migración 013 — Clientes por caja (no se cruzan entre cuentas)
-- ----------------------------------------------------------------------------
-- Los clientes eran una tabla global compartida. Ahora cada caja tiene los
-- suyos: owner_partner_id = NULL (casa) o el socio dueño.
--   * RLS: admin todo; socio sólo los suyos.
--   * El nombre es único por dueño (cada caja puede tener su propio 'Juan').
--   * Default: admin -> NULL (casa); socio -> su propio partner.
--   * Los clientes históricos quedan como casa (NULL), sin backfill.
--
-- Idempotente.
-- ============================================================================

alter table public.clients
  add column if not exists owner_partner_id uuid references public.partners(id) on delete cascade;

alter table public.clients
  alter column owner_partner_id
  set default (case when public.is_admin() then null else public.current_partner_id() end);

-- Nombre único por dueño (antes era único global).
alter table public.clients drop constraint if exists clients_name_key;
create unique index if not exists clients_name_owner_key
  on public.clients (name, owner_partner_id);

-- RLS: admin todo; socio sólo los suyos.
drop policy if exists "authed_read_clients"  on public.clients;
drop policy if exists "authed_write_clients" on public.clients;
drop policy if exists clients_select on public.clients;
drop policy if exists clients_write  on public.clients;
create policy clients_select on public.clients for select
  using (public.is_admin() or owner_partner_id = public.current_partner_id());
create policy clients_write on public.clients for all
  using (public.is_admin() or owner_partner_id = public.current_partner_id())
  with check (public.is_admin() or owner_partner_id = public.current_partner_id());
