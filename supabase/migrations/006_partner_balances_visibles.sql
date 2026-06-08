-- ============================================================================
-- Migración 006 — Las tarjetas de comisión del socio se ven siempre
-- ----------------------------------------------------------------------------
-- Problema: con el INNER JOIN de la 005, si el socio aún no tiene ventas no
-- aparece ninguna tarjeta de porcentaje (no hay comisiones que unir).
--
-- Solución: elegir QUÉ partners mostrar según quién consulta, con LEFT JOIN
-- (así las tarjetas salen aunque estén en 0):
--   * admin                -> todos los partners.
--   * socio (no admin)     -> el socio capital (VITO) + él mismo. LEO no aparece.
--
-- Los montos siguen filtrados por la RLS de commission_entries: el socio sólo
-- suma las comisiones de SUS transacciones (VITO 60% y su 40%).
--
-- Idempotente.
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
left join public.commission_entries c on c.partner_id = p.id
where public.is_admin()
   or p.is_capital_partner
   or p.id = public.current_partner_id()
group by p.id, p.name, p.commission_share
order by p.name;
