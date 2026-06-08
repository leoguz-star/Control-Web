import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Mapa id -> nombre de clientes, cuentas y socios, para resolver las
 * referencias (client_id, account_id, partner_id...) en la auditoría.
 * Los UUID son únicos entre tablas, así que un solo mapa basta.
 */
export function useNameMap() {
  const [map, setMap] = useState<Record<string, string>>({})

  useEffect(() => {
    let mounted = true
    async function load() {
      const [c, a, p] = await Promise.all([
        supabase.from('clients').select('id, name'),
        supabase.from('accounts').select('id, name'),
        supabase.from('partners').select('id, name'),
      ])
      if (!mounted) return
      const m: Record<string, string> = {}
      for (const row of [...(c.data ?? []), ...(a.data ?? []), ...(p.data ?? [])]) {
        const r = row as { id: string; name: string }
        m[r.id] = r.name
      }
      setMap(m)
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  return map
}
