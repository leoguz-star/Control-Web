import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

export interface ExtractedFields {
  monto_usdt: number | null
  tasa_usdt: number | null
  ref: string | null
  monto_divisa_bs: number | null
  ref2: string | null
  cliente_nombre: string | null
}

export async function extractFromImages(files: File[]): Promise<ExtractedFields> {
  const images = await Promise.all(
    files.map(async (f) => ({
      mime: f.type || 'image/jpeg',
      data: await fileToBase64(f),
    }))
  )

  const { data, error } = await supabase.functions.invoke('extract-transaction', {
    body: { images },
  })

  if (error) {
    // Cuando la función responde con status no-2xx, supabase-js no parsea el
    // body por defecto. Lo leemos manualmente para mostrar el error real.
    if (error instanceof FunctionsHttpError) {
      try {
        const body = await error.context.json()
        if (body?.error) throw new Error(body.error)
      } catch (e) {
        if (e instanceof Error && e.message) throw e
      }
    }
    throw new Error(error.message ?? 'Error invocando función')
  }
  if (data?.error) throw new Error(data.error)
  return data as ExtractedFields
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Remueve el prefijo "data:<mime>;base64,"
      const base64 = result.includes(',') ? result.split(',', 2)[1] : result
      resolve(base64)
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsDataURL(file)
  })
}
