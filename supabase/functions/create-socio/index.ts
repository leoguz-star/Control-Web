// Supabase Edge Function: create-socio
// Crea un socio COMPLETO (login + partner + cuentas) en un solo paso.
// El socio entra por NOMBRE; el email es interno y derivado del nombre.
//
// Seguridad: sólo un admin puede llamarla. Se verifica con el JWT del que llama
// (rpc is_admin); la creación usa la service_role (bypassa RLS).
//
// Secrets usados (los inyecta Supabase automáticamente):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Misma lógica que src/lib/socio.ts — mantener en sync.
function socioNameToEmail(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
  return `${slug}@socios.local`
}

function json(status: number, obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // 1. Verificar que quien llama es admin (con SU jwt).
    const authHeader = req.headers.get('Authorization') ?? ''
    const caller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: isAdmin, error: adminErr } = await caller.rpc('is_admin')
    if (adminErr) return json(401, { error: 'No autenticado' })
    if (isAdmin !== true) return json(403, { error: 'Solo un admin puede crear socios' })

    // 2. Validar input.
    const body = await req.json().catch(() => ({}))
    const name = String(body.name ?? '').trim()
    const password = String(body.password ?? '')
    const commission_share =
      body.commission_share != null ? Number(body.commission_share) : 0.4
    if (!name) return json(400, { error: 'El nombre es obligatorio' })
    if (password.length < 6)
      return json(400, { error: 'La contraseña debe tener al menos 6 caracteres' })

    const admin = createClient(SUPABASE_URL, SERVICE_KEY)
    const email = socioNameToEmail(name)

    // 3. Crear el usuario de Auth (confirmado, para que pueda entrar ya).
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (cErr || !created?.user) {
      return json(400, { error: `No se pudo crear el login: ${cErr?.message ?? 'desconocido'}` })
    }
    const userId = created.user.id

    // 4. Crear el partner (socio).
    const { data: partner, error: pErr } = await admin
      .from('partners')
      .insert({ name, commission_share, role: 'SOCIO', user_id: userId })
      .select()
      .single()
    if (pErr) {
      await admin.auth.admin.deleteUser(userId) // rollback del login
      return json(400, { error: `No se pudo crear el socio: ${pErr.message}` })
    }

    // 5. Crear su set de cuentas.
    const { error: aErr } = await admin.rpc('seed_partner_accounts', {
      p_partner_id: partner.id,
    })
    if (aErr) {
      return json(400, {
        error: `Socio creado, pero fallaron las cuentas: ${aErr.message}`,
      })
    }

    return json(200, { ok: true, partner })
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) })
  }
})
