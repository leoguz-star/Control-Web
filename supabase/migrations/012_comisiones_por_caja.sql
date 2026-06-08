-- ============================================================================
-- Migración 012 — Comisiones contabilizadas por caja (sin cruce entre cuentas)
-- ----------------------------------------------------------------------------
-- Bug: partner_balances sumaba TODAS las comisiones visibles. Para un admin eso
-- incluía la comisión que VITO gana en las ventas de los socios, así que el
-- 60% de una venta de PEDRO se le sumaba a VITO también en la vista de LEO
-- (VITO pasaba de 50$ a 80$). Las comisiones de una caja no deben afectar a otra.
--
-- Fix: sumar sólo las comisiones de transacciones de la caja del que consulta
-- (casa = owner NULL para admin; la suya para el socio) y mostrar sólo los
-- partners relevantes a esa caja:
--   * admin (casa) -> VITO (capital) + LEO (operador de la casa).
--   * socio        -> VITO (capital) + él mismo.
--
-- Idempotente. (No cambia las columnas de la vista.)
-- ============================================================================

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
