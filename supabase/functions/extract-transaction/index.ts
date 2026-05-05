// Supabase Edge Function: extract-transaction
// Recibe 1-2 imágenes (base64) + tipo opcional, llama a Gemini 2.5 Flash y
// devuelve los campos de la transacción que pudo identificar.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY')
const MODEL = 'gemini-2.5-flash'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface ImageInput {
  mime: string
  data: string // base64 sin prefijo data:
}

interface RequestBody {
  images: ImageInput[]
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    monto_usdt: {
      type: 'number',
      nullable: true,
      description:
        'Cantidad de USDT visible en la captura de Binance P2P (campo "Monto"/"Cantidad").',
    },
    tasa_usdt: {
      type: 'number',
      nullable: true,
      description:
        'Precio en Bs por USDT en Binance (campo "Precio" / "Price"). En Bolívares por USDT.',
    },
    ref: {
      type: 'string',
      nullable: true,
      description:
        'Últimos 4 dígitos de la referencia / Order ID de la operación de Binance.',
    },
    monto_divisa_bs: {
      type: 'number',
      nullable: true,
      description:
        'Total en bolívares pagado por el cliente en la captura de pago móvil / banco.',
    },
    ref2: {
      type: 'string',
      nullable: true,
      description:
        'Últimos 4 dígitos del número de referencia del pago móvil.',
    },
    cliente_nombre: {
      type: 'string',
      nullable: true,
      description:
        'Nombre del remitente SOLO de la captura de pago móvil. NUNCA del Binance.',
    },
  },
}

const PROMPT = `
Eres un asistente que extrae datos de capturas de pantalla de operaciones de
exchange en Venezuela. Las imágenes que recibes pueden ser:

1. Captura de Binance P2P: muestra Monto en USDT, Precio en Bs/USDT, y un Order
   ID o Reference (alfanumérico, normalmente largo).
2. Captura de pago móvil venezolano (BDV, Mercantil, Provincial, Banesco, etc.):
   muestra el monto en Bs, la referencia y el nombre del remitente.

Extrae solo los campos del esquema. Reglas:
- Devuelve null para los campos que no veas claramente, no inventes.
- Para "ref": SOLO los últimos 4 caracteres del Order ID/Reference de Binance.
- Para "ref2": SOLO los últimos 4 dígitos del número de referencia del pago móvil.
- Los montos son números puros (sin separadores ni símbolos): 5890.00, no "5.890,00".
- "tasa_usdt" debe ser el precio Bs/USDT (suele estar entre 30 y 200).
- "monto_divisa_bs" es el total en Bs del pago móvil (NO conviertas a $).
- "cliente_nombre": ÚNICAMENTE el nombre del remitente del pago móvil.
  IMPORTANTE: el remitente que aparece en la captura de Binance NO es el
  cliente (es la contraparte P2P). Si solo recibes la captura de Binance y
  no la de pago móvil, devuelve null en cliente_nombre.
`

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (!GEMINI_KEY) {
    return json({ error: 'GEMINI_API_KEY no configurada' }, 500)
  }

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'JSON inválido' }, 400)
  }

  const images = body.images ?? []
  if (images.length === 0) {
    return json({ error: 'Falta al menos una imagen' }, 400)
  }
  if (images.length > 4) {
    return json({ error: 'Máximo 4 imágenes' }, 400)
  }

  const parts: unknown[] = [{ text: PROMPT }]
  for (const img of images) {
    if (!img.data || !img.mime) {
      return json({ error: 'Imagen sin mime/data' }, 400)
    }
    parts.push({ inline_data: { mime_type: img.mime, data: img.data } })
  }

  const r = await callGeminiWithRetry(parts)

  if (!r.ok) {
    const errText = await r.text()
    return json({ error: `Gemini ${r.status}: ${errText}` }, 502)
  }

  const data = await r.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return json({ error: 'Respuesta de Gemini no es JSON válido', raw: text }, 502)
  }

  return json(parsed, 200)
})

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Reintenta el llamado a Gemini con backoff exponencial cuando devuelve 503
// (saturación), 429 (rate limit) o 5xx genéricos. Devuelve la última Response
// recibida (incluso si falló) para que el caller decida qué hacer.
async function callGeminiWithRetry(parts: unknown[]): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`
  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  })

  const delaysMs = [0, 1500, 4000, 8000] // 4 intentos
  let last: Response | null = null

  for (const delay of delaysMs) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay))

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    if (r.ok) return r

    // Solo reintentamos errores transitorios.
    const retryable = r.status === 429 || r.status === 503 || r.status >= 500
    if (!retryable) return r

    last = r
  }

  return last!
}
