-- ============================================================================
-- Migración 005 — Reparto de comisión por dueño de la caja
-- ----------------------------------------------------------------------------
-- Regla de negocio:
--   * VITO (socio capital) se lleva el 60% de TODA venta, sea de la caja que sea.
--   * El 40% restante es para quien OPERA la caja:
--       - caja de la casa (owner_partner_id = NULL)  -> LEO
--       - caja de un socio (owner_partner_id = socio) -> ese socio
--   * Siempre 40% para el operador.
--
-- En la vista del socio aparece "VITO 60% / <socio> 40%" (sin LEO), porque sólo
-- ve las comisiones generadas por SUS propias transacciones.
--
-- Idempotente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. MARCAR LOS ROLES DE COMISIÓN
--    is_capital_partner -> recibe su % en TODA venta (VITO, 60%).
--    is_house_operator  -> recibe el % de operador en la caja de la casa (LEO).
--    Los socios reciben su % sólo en su propia caja (no llevan flags).
-- ---------------------------------------------------------------------------
alter table public.partners
  add column if not exists is_capital_partner boolean not null default false;
alter table public.partners
  add column if not exists is_house_operator  boolean not null default false;

update public.partners set is_capital_partner = true  where name = 'VITO';
update public.partners set is_house_operator  = true  where name = 'LEO';

-- Los socios cobran 40% (antes se sugería 0). Ajusta los ya creados.
update public.partners
   set commission_share = 0.40
 where role = 'SOCIO' and commission_share = 0;

-- ---------------------------------------------------------------------------
-- 2. TRIGGER — reparte según el dueño de la caja
-- ---------------------------------------------------------------------------
create or replace function public.tg_sync_commission()
returns trigger language plpgsql as $$
declare
  cap     record;
  op_id   uuid;
  op_share numeric;
begin
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

    -- No duplicar si por alguna razón el operador también es socio capital.
    if op_id is not null
       and not exists (select 1 from public.partners
                        where id = op_id and is_capital_partner) then
      select commission_share into op_share from public.partners where id = op_id;
      insert into public.commission_entries (transaction_id, partner_id, kind, amount)
      values (new.id, op_id, 'ACUMULADO', round(new.dif_usd * coalesce(op_share, 0), 4));
    end if;

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
-- 3. RLS — el socio ve las comisiones de SUS propias transacciones
--    (así ve la línea de VITO 60% sobre su caja, además de su propio 40%).
-- ---------------------------------------------------------------------------
drop policy if exists commission_entries_select on public.commission_entries;
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

-- ---------------------------------------------------------------------------
-- 4. VISTA — sólo partners con comisiones visibles para quien consulta.
--    INNER JOIN: para un socio, sólo aparecen VITO y él (LEO queda fuera).
--    Para un admin, aparece cada partner con comisión acumulada.
-- ---------------------------------------------------------------------------
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
join public.commission_entries c on c.partner_id = p.id
group by p.id, p.name, p.commission_share
order by p.name;
