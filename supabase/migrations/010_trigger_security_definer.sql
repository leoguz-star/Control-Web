-- ============================================================================
-- Migración 010 — tg_sync_commission corre como SECURITY DEFINER
-- ----------------------------------------------------------------------------
-- Problema: cuando un SOCIO registra una VENTA, el trigger intenta insertar en
-- commission_entries, pero la RLS de esa tabla sólo permite escritura a admins
-- (with check is_admin()). El trigger corría con los permisos del socio, así que
-- la inserción se bloqueaba y fallaba toda la transacción.
--
-- Solución: marcar la función SECURITY DEFINER (corre como su dueño, que
-- bypassa RLS) con search_path fijo. Así las comisiones se generan sin importar
-- quién dispare la venta. Las políticas de RLS de commission_entries siguen
-- controlando la LECTURA (cada socio ve sólo lo suyo).
--
-- Idempotente.
-- ============================================================================

create or replace function public.tg_sync_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cap      record;
  op_id    uuid;
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

    if op_id is not null
       and not exists (select 1 from public.partners where id = op_id and is_capital_partner) then
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
