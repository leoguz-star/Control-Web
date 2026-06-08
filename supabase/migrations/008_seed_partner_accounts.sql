-- ============================================================================
-- Migración 008 — Helper para crear el set de cuentas estándar de un socio
-- ----------------------------------------------------------------------------
-- Cada socio debe tener el mismo set de cuentas que la casa:
--   EFECTIVO, BOFA PERSONAL, BOFA LLC, EURO, BINANCE.
-- Esta función las crea (idempotente: omite las que ya existan).
--
-- Uso:
--   select public.seed_partner_accounts(
--            (select id from public.partners where name = 'PEDRO'));
--
-- Idempotente.
-- ============================================================================

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
