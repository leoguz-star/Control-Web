# Entorno de Staging

Guía para probar cambios grandes (sobre todo migraciones de base de datos y RLS)
**sin tocar la base de producción**. La idea: un segundo proyecto de Supabase,
idéntico en esquema, cargado con una copia de los datos reales.

> Regla de oro: nunca apuntes `npm run dev:staging` al proyecto de producción.
> Verifica siempre la URL en `.env.staging` antes de probar migraciones.

---

## 1. Crear el proyecto de staging en Supabase

1. En [app.supabase.com](https://app.supabase.com) → **New project**
   (mismo plan gratis sirve). Nómbralo p.ej. `control-web-staging`.
2. Anota el **Project URL** y la **anon key**:
   Project Settings → API.
3. Anota la **connection string** de la base:
   Project Settings → Database → *Connection string* → **URI**
   (usa la conexión directa, puerto `5432`). La necesitarás para el dump.

## 2. Configurar el frontend para staging

```powershell
# En la raíz del repo (Windows / PowerShell)
Copy-Item .env.staging.example .env.staging
```

Edita `.env.staging` con la URL y anon key del proyecto **de staging**:

```env
VITE_SUPABASE_URL=https://xxxxxstaging.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_APP_ENV=staging
```

`.env.staging` está en `.gitignore`, no se commitea.

Arranca apuntando a staging:

```powershell
npm run dev:staging      # vite --mode staging  → usa .env.staging
```

Build/preview de staging si lo necesitas: `npm run build:staging`, `npm run preview:staging`.

## 3. Bootstrap del esquema en staging

En el **SQL editor del proyecto de staging** (no el de prod), pega y ejecuta, en orden:

1. [`supabase/schema.sql`](../supabase/schema.sql) — estado "from-scratch".
2. Cada archivo de [`supabase/migrations/`](../supabase/migrations/) en orden numérico
   (`001_…`, `003_…`, etc.) que **no** esté ya incluido en `schema.sql`.

Esto deja staging con la misma estructura que producción pero **sin datos**.

## 4. Clonar los datos de producción → staging

Necesitas las herramientas de cliente de Postgres (`pg_dump` y `psql`). Vienen con
[PostgreSQL](https://www.postgresql.org/download/windows/); basta instalar
"Command Line Tools". Comprueba con `pg_dump --version`.

Define las dos connection strings (las de Project Settings → Database → URI):

```powershell
$PROD    = "postgresql://postgres:PWD_PROD@db.PROD_REF.supabase.co:5432/postgres"
$STAGING = "postgresql://postgres:PWD_STAGING@db.STAGING_REF.supabase.co:5432/postgres"
```

### 4a. Volcar solo los datos de producción (esquema `public`)

```powershell
pg_dump $PROD `
  --data-only --no-owner --no-privileges `
  --schema=public `
  --file=prod_data.sql
```

`--data-only` no copia el esquema (ya lo creaste en el paso 3) y omite las
columnas generadas automáticamente. No copia el esquema `auth`, así que los
usuarios de login se crean aparte (paso 5).

### 4b. Cargar el dump en staging

Carga con las **FK y los triggers desactivados** en la sesión. Esto evita dos
problemas: (a) `created_by`/`updated_by` apuntan a usuarios de prod que no existen
en staging, y (b) el trigger `tg_sync_commission` volvería a generar comisiones
sobre filas que ya las traen. `session_replication_role = replica` apaga ambos:

```powershell
psql $STAGING --single-transaction `
  -c "SET session_replication_role = replica" `
  -f prod_data.sql
```

> Si más adelante quieres **refrescar** staging con datos nuevos de prod, primero
> vacía las tablas en staging y vuelve a cargar:
> ```sql
> truncate public.transactions, public.commission_entries,
>          public.clients, public.accounts, public.partners restart identity cascade;
> ```
> (luego repite 4a/4b).

## 5. Crear usuarios de prueba en staging

Como el esquema `auth` no se copia, crea logins de prueba en staging:

1. Staging → Authentication → Users → **Add user** (email + password).
   Crea al menos un admin y uno o dos "socios".
2. Vincula cada usuario a su fila de `partners` (esto es lo que la nueva RLS
   usará para saber qué puede ver cada quien). En el SQL editor de staging:
   ```sql
   update public.partners
      set user_id = '<uuid-del-usuario-auth>'
    where name = 'VITO';
   ```
   (El UUID está en Authentication → Users.)

Ahora puedes entrar con `npm run dev:staging` como admin o como socio y verificar
el comportamiento de la migración antes de aplicarla a producción.

## 6. Aplicar a producción

Cuando la migración esté validada en staging:

1. Pega la **misma** migración (idempotente) en el SQL editor de **producción**.
2. Mergea el código a `main` y despliega.

---

## Checklist antes de subir a producción

- [ ] La migración corre limpia sobre una copia real de datos (paso 4).
- [ ] Cada socio ve **solo** su propia caja; el admin ve todas.
- [ ] La pata de BINANCE por socio cuadra los saldos.
- [ ] El `dif_usd` de un socio sigue cayendo en el pool 60/40.
- [ ] El dashboard del admin refleja los movimientos de los socios en tiempo real.
