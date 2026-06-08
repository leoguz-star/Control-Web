# Dar de alta un socio

Cada socio opera su **propia caja** (sus propias cuentas y transacciones). Solo
ve lo suyo; los admins (VITO/LEO) ven todo. Reparto de su ganancia: **VITO 60% /
el socio 40%** (ver `supabase/migrations/005_reparto_por_caja.sql`).

Son 3 pasos. El 1 es en el dashboard de Supabase; el 2 y 3 en el SQL editor.

## 1. Crear el login

Supabase → **Authentication → Users → Add user**:
- Email y contraseña del socio.
- Marca **"Auto Confirm User"** (si no, tendría que confirmar por correo).

## 2. Crear el partner

Enlazado a ese usuario por email. `commission_share = 0.40` es lo que se le
muestra y lo que el trigger le acredita; `role = 'SOCIO'` lo limita a su caja.

```sql
insert into public.partners (name, commission_share, role, user_id)
values (
  'PEDRO',                                       -- nombre del socio (único)
  0.40,                                          -- su 40%
  'SOCIO',
  (select id from auth.users where email = 'pedro@ejemplo.com')
);
```

## 3. Crearle el set de cuentas

Mismo set que la casa (EFECTIVO, BOFA PERSONAL, BOFA LLC, EURO, BINANCE).
La función es idempotente (omite las que ya existan):

```sql
select public.seed_partner_accounts(
         (select id from public.partners where name = 'PEDRO'));
```

> ⚠️ El socio **necesita su cuenta BINANCE** sí o sí: la pata USDT de cada venta
> busca el BINANCE de su misma caja. `seed_partner_accounts` ya la incluye.

## Capital inicial (opcional)

Si el socio arranca con fondos, ajusta el `initial_balance` de la cuenta que
corresponda:

```sql
update public.accounts
set initial_balance = 500
where owner_partner_id = (select id from public.partners where name = 'PEDRO')
  and name = 'BINANCE';
```

## Verificar

```sql
select name, role, commission_share, user_id
from public.partners where name = 'PEDRO';

select name, currency, initial_balance
from public.accounts
where owner_partner_id = (select id from public.partners where name = 'PEDRO')
order by sort_order;
```

El socio entra al sitio con su email/contraseña y verá solo su caja. Los admins
lo ven en la sección **"Cajas de socios"** del Dashboard.
