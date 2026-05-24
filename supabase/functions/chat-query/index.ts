// Supabase Edge Function: chat-query
// Recibe una pregunta en lenguaje natural, clasifica el intent con Gemini,
// ejecuta la query correspondiente en Supabase y devuelve una respuesta en español.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MODEL = 'gemini-2.5-flash'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface QueryParams {
  nombre?: string | null
  fecha_desde?: string | null
  fecha_hasta?: string | null
  top_n?: number | null
  cuenta?: string | null
}

interface IntentResult {
  intent: string
  params: QueryParams
}

type DB = ReturnType<typeof createClient>

const INTENTS_DESCRIPTION = `
- deuda_cliente: Cuánto debe un cliente específico (ventas PENDIENTE de ese cliente). Requiere params.nombre.
- ventas_cliente: Total de ventas (VENTA CONCILIADO) de un cliente. Requiere params.nombre. Opcional: fecha_desde/fecha_hasta.
- top_clientes: Ranking de clientes por volumen de USDT vendido. Opcional: top_n (default 5), fecha_desde/fecha_hasta.
- balance_cuenta: Saldo actual de una cuenta específica (EFECTIVO, BINANCE, etc.). Requiere params.cuenta.
- balance_todas_cuentas: Saldo de todas las cuentas.
- comision_socio: Comisión acumulada, cobrada y pendiente de un socio (Leo o Vito). Requiere params.nombre.
- transacciones_pendientes: Lista de transacciones con status PENDIENTE.
- historial_cliente: Últimas transacciones de un cliente. Requiere params.nombre.
- resumen_periodo: Resumen de ventas en un período. Requiere fecha_desde y fecha_hasta.
- tasa_promedio: Tasa promedio de USDT/Bs en un período. Requiere fecha_desde y fecha_hasta.
- margen_promedio: Margen de ganancia promedio en un período. Requiere fecha_desde y fecha_hasta.
- clientes_deudores: Lista de todos los clientes con deuda pendiente.
- efectivo_pendiente: Cuánto efectivo está pendiente de conciliar.
- total_usdt_vendido: Total de USDT vendido en un período. Requiere fecha_desde y fecha_hasta.
- pagos_socios: Pagos realizados a socios. Opcional: params.nombre para filtrar por socio.
- ultima_transaccion_cliente: Cuándo fue la última transacción de un cliente. Requiere params.nombre.
- transacciones_hoy: Todas las transacciones del día de hoy.
- clientes_frecuentes: Clientes que más veces han comprado. Opcional: top_n.
- ganancia_total_periodo: Ganancia neta (suma de dif_usd) en un período. Requiere fecha_desde y fecha_hasta.
- bolivar_summary: Resumen del lado en bolívares (ganancias en Bs, comisiones, etc.).
- desconocido: La pregunta no encaja en ningún intent conocido.
`

const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string' },
    params: {
      type: 'object',
      properties: {
        nombre: { type: 'string', nullable: true },
        fecha_desde: { type: 'string', nullable: true },
        fecha_hasta: { type: 'string', nullable: true },
        top_n: { type: 'number', nullable: true },
        cuenta: { type: 'string', nullable: true },
      },
    },
  },
  required: ['intent', 'params'],
}

function fmtUSD(n: number) {
  return new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (!GEMINI_KEY) return json({ error: 'GEMINI_API_KEY no configurada' }, 500)

  let body: { pregunta: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'JSON inválido' }, 400)
  }

  if (!body.pregunta?.trim()) return json({ error: 'Falta la pregunta' }, 400)

  const today = new Date().toISOString().split('T')[0]
  const intentResult = await classifyIntent(body.pregunta, today)

  if (!intentResult) {
    return json({ respuesta: 'Ocurrió un error al entender tu pregunta. Intenta de nuevo.' }, 200)
  }

  if (intentResult.intent === 'desconocido') {
    return json({
      respuesta:
        'No entendí tu pregunta. Puedes preguntarme sobre deudas de clientes, ventas, saldos de cuentas, comisiones de socios, transacciones pendientes, entre otras cosas.',
    }, 200)
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  try {
    const respuesta = await executeIntent(db, intentResult.intent, intentResult.params, today)
    return json({ respuesta }, 200)
  } catch (e) {
    console.error(e)
    return json({ respuesta: 'Ocurrió un error al consultar la base de datos.' }, 200)
  }
})

async function classifyIntent(pregunta: string, today: string): Promise<IntentResult | null> {
  const prompt = `Eres un clasificador de intenciones para un sistema de consultas de un negocio de intercambio de divisas (USDT/Bs/EUR).
Hoy es ${today}.

Clasifica la siguiente pregunta en uno de estos intents y extrae los parámetros relevantes:
${INTENTS_DESCRIPTION}

Reglas:
- Para fechas relativas ("hoy", "este mes", "mayo", "la semana pasada"), conviértelas a fechas absolutas YYYY-MM-DD usando la fecha de hoy.
- "este mes" = primer día del mes actual hasta hoy.
- Si no se menciona período, deja fecha_desde y fecha_hasta en null.
- top_n: null si no se menciona (el handler usará 5 por defecto).
- nombre: extrae el nombre tal como fue mencionado.

Pregunta: "${pregunta}"`

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: INTENT_SCHEMA,
        },
      }),
    }
  )

  if (!r.ok) return null
  const data = await r.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'
  try {
    return JSON.parse(text) as IntentResult
  } catch {
    return null
  }
}

async function findClientByName(db: DB, nombre: string) {
  const { data } = await db
    .from('clients')
    .select('id, name')
    .ilike('name', `%${nombre}%`)
    .limit(1)
    .single()
  return data
}

async function findPartnerByName(db: DB, nombre: string) {
  const { data } = await db
    .from('partners')
    .select('id, name')
    .ilike('name', `%${nombre}%`)
    .limit(1)
    .single()
  return data
}

async function executeIntent(db: DB, intent: string, params: QueryParams, today: string): Promise<string> {
  switch (intent) {
    case 'deuda_cliente': {
      if (!params.nombre) return 'Necesito el nombre del cliente para buscar su deuda.'
      const client = await findClientByName(db, params.nombre)
      if (!client) return `No encontré ningún cliente con el nombre "${params.nombre}".`
      const { data } = await db
        .from('transactions')
        .select('monto_divisa, monto_usdt, accounts(name)')
        .eq('client_id', client.id)
        .eq('status', 'PENDIENTE')
        .eq('category', 'VENTA')
      if (!data || data.length === 0) return `${client.name} no tiene ventas pendientes.`
      type PendRow = { monto_divisa: number | null; monto_usdt: number | null; accounts: { name: string } | null }
      const rows = data as PendRow[]
      const totalDivisa = rows.reduce((s, t) => s + (t.monto_divisa ?? 0), 0)
      const totalUsdt = rows.reduce((s, t) => s + (t.monto_usdt ?? 0), 0)
      const cuentas = [...new Set(rows.map((t) => t.accounts?.name).filter(Boolean))].join(', ')
      const n = data.length
      return `${client.name} tiene ${n} venta${n > 1 ? 's' : ''} pendiente${n > 1 ? 's' : ''}:\n• Lo comprado: ${fmtUSD(totalDivisa)}${cuentas ? ` (${cuentas})` : ''}\n• En USDT equivalente: $${fmtUSD(totalUsdt)}`
    }

    case 'ventas_cliente': {
      if (!params.nombre) return 'Necesito el nombre del cliente.'
      const client = await findClientByName(db, params.nombre)
      if (!client) return `No encontré ningún cliente con el nombre "${params.nombre}".`
      let q = db
        .from('transactions')
        .select('monto_usdt')
        .eq('client_id', client.id)
        .eq('category', 'VENTA')
        .eq('status', 'CONCILIADO')
      if (params.fecha_desde) q = q.gte('date', params.fecha_desde)
      if (params.fecha_hasta) q = q.lte('date', params.fecha_hasta)
      const { data } = await q
      if (!data || data.length === 0) {
        return `${client.name} no tiene ventas conciliadas${params.fecha_desde ? ' en ese período' : ''}.`
      }
      const total = data.reduce((s, t) => s + (t.monto_usdt ?? 0), 0)
      const periodo = params.fecha_desde ? ` entre ${params.fecha_desde} y ${params.fecha_hasta ?? today}` : ''
      return `${client.name} realizó ${data.length} compra${data.length > 1 ? 's' : ''}${periodo} por un total de $${fmtUSD(total)} USDT.`
    }

    case 'top_clientes': {
      const n = params.top_n ?? 5
      let q = db
        .from('transactions')
        .select('client_id, monto_usdt, clients(name)')
        .eq('category', 'VENTA')
        .eq('status', 'CONCILIADO')
      if (params.fecha_desde) q = q.gte('date', params.fecha_desde)
      if (params.fecha_hasta) q = q.lte('date', params.fecha_hasta)
      const { data } = await q
      if (!data || data.length === 0) return 'No hay ventas conciliadas en ese período.'
      const map = new Map<string, { name: string; total: number; count: number }>()
      for (const t of data) {
        const cId = t.client_id ?? '__sin_cliente__'
        const cName = (t.clients as { name: string } | null)?.name ?? 'Sin cliente'
        const e = map.get(cId) ?? { name: cName, total: 0, count: 0 }
        e.total += t.monto_usdt ?? 0
        e.count += 1
        map.set(cId, e)
      }
      const sorted = [...map.values()].sort((a, b) => b.total - a.total).slice(0, n)
      const periodo = params.fecha_desde ? ` (${params.fecha_desde} → ${params.fecha_hasta ?? today})` : ''
      const lines = sorted.map((c, i) => `${i + 1}. ${c.name} — $${fmtUSD(c.total)} USDT (${c.count} op.)`)
      return `Top ${sorted.length} clientes por volumen${periodo}:\n${lines.join('\n')}`
    }

    case 'balance_cuenta': {
      if (!params.cuenta) return 'Necesito el nombre de la cuenta.'
      const { data } = await db
        .from('account_balances')
        .select('name, balance, currency')
        .ilike('name', `%${params.cuenta}%`)
      if (!data || data.length === 0) return `No encontré ninguna cuenta con el nombre "${params.cuenta}".`
      return data.map((a) => `${a.name}: $${fmtUSD(Number(a.balance))} ${a.currency}`).join('\n')
    }

    case 'balance_todas_cuentas': {
      const { data } = await db
        .from('account_balances')
        .select('name, balance, currency')
        .order('sort_order')
      if (!data || data.length === 0) return 'No hay cuentas registradas.'
      const lines = data.map((a) => `• ${a.name}: $${fmtUSD(Number(a.balance))} ${a.currency}`)
      return `Saldos actuales:\n${lines.join('\n')}`
    }

    case 'comision_socio': {
      if (!params.nombre) return 'Necesito el nombre del socio.'
      const { data } = await db
        .from('partner_balances')
        .select('name, acumulado_total, cobrado_total, pendiente')
        .ilike('name', `%${params.nombre}%`)
      if (!data || data.length === 0) return `No encontré ningún socio con el nombre "${params.nombre}".`
      const p = data[0]
      return `${p.name}: acumulado $${fmtUSD(Number(p.acumulado_total))}, cobrado $${fmtUSD(Number(p.cobrado_total))}, pendiente $${fmtUSD(Number(p.pendiente))}.`
    }

    case 'transacciones_pendientes': {
      const { data } = await db
        .from('transactions')
        .select('date, category, monto_usdt, clients(name)')
        .eq('status', 'PENDIENTE')
        .order('date', { ascending: false })
        .limit(15)
      if (!data || data.length === 0) return 'No hay transacciones pendientes.'
      const lines = data.map((t) => {
        const cName = (t.clients as { name: string } | null)?.name ?? '—'
        return `• ${t.date} | ${t.category} | ${cName} | $${fmtUSD(t.monto_usdt ?? 0)}`
      })
      return `Transacciones pendientes:\n${lines.join('\n')}`
    }

    case 'historial_cliente': {
      if (!params.nombre) return 'Necesito el nombre del cliente.'
      const client = await findClientByName(db, params.nombre)
      if (!client) return `No encontré ningún cliente con el nombre "${params.nombre}".`
      const { data } = await db
        .from('transactions')
        .select('date, category, monto_usdt, status')
        .eq('client_id', client.id)
        .order('date', { ascending: false })
        .limit(10)
      if (!data || data.length === 0) return `${client.name} no tiene transacciones registradas.`
      const lines = data.map((t) => `• ${t.date} | ${t.category} | $${fmtUSD(t.monto_usdt ?? 0)} | ${t.status}`)
      return `Últimas ${data.length} transacciones de ${client.name}:\n${lines.join('\n')}`
    }

    case 'resumen_periodo': {
      const desde = params.fecha_desde
      const hasta = params.fecha_hasta ?? today
      if (!desde) return 'Necesito el período para el resumen. Ejemplo: "resumen de mayo 2026".'
      const { data } = await db
        .from('transactions')
        .select('monto_usdt, dif_usd, status')
        .eq('category', 'VENTA')
        .gte('date', desde)
        .lte('date', hasta)
      if (!data || data.length === 0) return `No hay ventas entre ${desde} y ${hasta}.`
      const conciliadas = data.filter((t) => t.status === 'CONCILIADO')
      const totalUsdt = conciliadas.reduce((s, t) => s + (t.monto_usdt ?? 0), 0)
      const totalGanancia = conciliadas.reduce((s, t) => s + (t.dif_usd ?? 0), 0)
      return `Período ${desde} → ${hasta}:\n• Ventas totales: ${data.length} (${conciliadas.length} conciliadas)\n• USDT vendido: $${fmtUSD(totalUsdt)}\n• Ganancia neta: $${fmtUSD(totalGanancia)}`
    }

    case 'tasa_promedio': {
      const desde = params.fecha_desde
      const hasta = params.fecha_hasta ?? today
      if (!desde) return 'Necesito el período. Ejemplo: "tasa promedio de mayo".'
      const { data } = await db
        .from('transactions')
        .select('tasa_usdt')
        .eq('category', 'VENTA')
        .not('tasa_usdt', 'is', null)
        .gte('date', desde)
        .lte('date', hasta)
      if (!data || data.length === 0) return 'No hay ventas en ese período.'
      const avg = data.reduce((s, t) => s + (t.tasa_usdt ?? 0), 0) / data.length
      return `Tasa promedio USDT/Bs entre ${desde} y ${hasta}: ${fmtUSD(avg)} Bs/USDT (${data.length} ventas).`
    }

    case 'margen_promedio': {
      const desde = params.fecha_desde
      const hasta = params.fecha_hasta ?? today
      if (!desde) return 'Necesito el período.'
      const { data } = await db
        .from('transactions')
        .select('margen_pct')
        .eq('category', 'VENTA')
        .eq('status', 'CONCILIADO')
        .not('margen_pct', 'is', null)
        .gte('date', desde)
        .lte('date', hasta)
      if (!data || data.length === 0) return 'No hay ventas conciliadas en ese período.'
      const avg = data.reduce((s, t) => s + (t.margen_pct ?? 0), 0) / data.length
      return `Margen promedio entre ${desde} y ${hasta}: ${avg.toFixed(2)}% (${data.length} ventas).`
    }

    case 'clientes_deudores': {
      const { data } = await db
        .from('transactions')
        .select('client_id, monto_divisa, clients(name)')
        .eq('status', 'PENDIENTE')
        .eq('category', 'VENTA')
      if (!data || data.length === 0) return 'No hay clientes con deuda pendiente.'
      const map = new Map<string, { name: string; total: number; count: number }>()
      for (const t of data as Array<{ client_id: string | null; monto_divisa: number | null; clients: { name: string } | null }>) {
        const cId = t.client_id ?? '__sin_cliente__'
        const cName = t.clients?.name ?? 'Sin cliente'
        const e = map.get(cId) ?? { name: cName, total: 0, count: 0 }
        e.total += t.monto_divisa ?? 0
        e.count += 1
        map.set(cId, e)
      }
      const sorted = [...map.values()].sort((a, b) => b.total - a.total)
      const lines = sorted.map((c) => `• ${c.name}: ${fmtUSD(c.total)} (${c.count} op.)`)
      return `Clientes con deuda pendiente:\n${lines.join('\n')}`
    }

    case 'efectivo_pendiente': {
      const { data } = await db.from('cash_pending').select('*').single()
      if (!data) return 'No hay efectivo pendiente.'
      return `Efectivo pendiente de conciliar: $${fmtUSD(Number(data.efectivo_pendiente))} en ${data.ventas_pendientes} venta${data.ventas_pendientes > 1 ? 's' : ''}.`
    }

    case 'total_usdt_vendido': {
      const desde = params.fecha_desde
      const hasta = params.fecha_hasta ?? today
      if (!desde) return 'Necesito el período.'
      const { data } = await db
        .from('transactions')
        .select('monto_usdt')
        .eq('category', 'VENTA')
        .eq('status', 'CONCILIADO')
        .gte('date', desde)
        .lte('date', hasta)
      if (!data || data.length === 0) return `No hay ventas conciliadas entre ${desde} y ${hasta}.`
      const total = data.reduce((s, t) => s + (t.monto_usdt ?? 0), 0)
      return `USDT vendido entre ${desde} y ${hasta}: $${fmtUSD(total)} (${data.length} ventas).`
    }

    case 'pagos_socios': {
      let q = db
        .from('transactions')
        .select('date, monto_usdt, partners(name)')
        .eq('category', 'PAGO')
        .order('date', { ascending: false })
        .limit(10)
      if (params.nombre) {
        const partner = await findPartnerByName(db, params.nombre)
        if (!partner) return `No encontré ningún socio con el nombre "${params.nombre}".`
        q = q.eq('partner_id', partner.id)
      }
      const { data } = await q
      if (!data || data.length === 0) return 'No hay pagos a socios registrados.'
      const lines = data.map((t) => {
        const pName = (t.partners as { name: string } | null)?.name ?? '—'
        return `• ${t.date} | ${pName} | $${fmtUSD(t.monto_usdt ?? 0)} USDT`
      })
      return `Últimos pagos a socios:\n${lines.join('\n')}`
    }

    case 'ultima_transaccion_cliente': {
      if (!params.nombre) return 'Necesito el nombre del cliente.'
      const client = await findClientByName(db, params.nombre)
      if (!client) return `No encontré ningún cliente con el nombre "${params.nombre}".`
      const { data } = await db
        .from('transactions')
        .select('date, category, monto_usdt, status')
        .eq('client_id', client.id)
        .order('date', { ascending: false })
        .limit(1)
        .single()
      if (!data) return `${client.name} no tiene transacciones registradas.`
      return `Última transacción de ${client.name}: ${data.date} | ${data.category} | $${fmtUSD(data.monto_usdt ?? 0)} USDT | ${data.status}.`
    }

    case 'transacciones_hoy': {
      const { data } = await db
        .from('transactions')
        .select('category, monto_usdt, status, clients(name)')
        .eq('date', today)
        .order('created_at', { ascending: false })
      if (!data || data.length === 0) return `No hay transacciones registradas para hoy (${today}).`
      const lines = data.map((t) => {
        const cName = (t.clients as { name: string } | null)?.name ?? '—'
        return `• ${t.category} | ${cName} | $${fmtUSD(t.monto_usdt ?? 0)} | ${t.status}`
      })
      return `Transacciones de hoy (${today}):\n${lines.join('\n')}`
    }

    case 'clientes_frecuentes': {
      const n = params.top_n ?? 5
      const { data } = await db
        .from('transactions')
        .select('client_id, clients(name)')
        .eq('category', 'VENTA')
      if (!data || data.length === 0) return 'No hay ventas registradas.'
      const map = new Map<string, { name: string; count: number }>()
      for (const t of data) {
        const cId = t.client_id ?? '__sin_cliente__'
        const cName = (t.clients as { name: string } | null)?.name ?? 'Sin cliente'
        const e = map.get(cId) ?? { name: cName, count: 0 }
        e.count += 1
        map.set(cId, e)
      }
      const sorted = [...map.values()].sort((a, b) => b.count - a.count).slice(0, n)
      const lines = sorted.map((c, i) => `${i + 1}. ${c.name} — ${c.count} operaciones`)
      return `Clientes más frecuentes:\n${lines.join('\n')}`
    }

    case 'ganancia_total_periodo': {
      const desde = params.fecha_desde
      const hasta = params.fecha_hasta ?? today
      if (!desde) return 'Necesito el período.'
      const { data } = await db
        .from('transactions')
        .select('dif_usd')
        .eq('category', 'VENTA')
        .eq('status', 'CONCILIADO')
        .gte('date', desde)
        .lte('date', hasta)
      if (!data || data.length === 0) return `No hay ventas conciliadas entre ${desde} y ${hasta}.`
      const total = data.reduce((s, t) => s + (t.dif_usd ?? 0), 0)
      return `Ganancia neta entre ${desde} y ${hasta}: $${fmtUSD(total)} (${data.length} ventas).`
    }

    case 'bolivar_summary': {
      const { data } = await db.from('bolivar_summary').select('*').single()
      if (!data) return 'No hay datos de bolívares.'
      return `Resumen Bs:\n• Ventas: ${data.ventas_count}\n• DIF Bs total: ${fmtUSD(Number(data.dif_bs_total))}\n• Com. Pago Móvil: ${fmtUSD(Number(data.comision_pago_movil_total))}\n• Com. Binance: ${fmtUSD(Number(data.comision_binance_total))}\n• DIF Bs neto: ${fmtUSD(Number(data.dif_bs_neto_total))}\n• DIF USD neto: $${fmtUSD(Number(data.dif_usd_neto_total))}`
    }

    default:
      return 'No entendí tu pregunta.'
  }
}

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
