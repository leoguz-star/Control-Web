import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Client } from '@/types/database'
import { useIsAdmin } from './useIsAdmin'

const CLIENTS_CHANGED_EVENT = 'clients:changed'

export function useClients() {
  const isAdmin = useIsAdmin()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (isAdmin === null) return // esperar a saber el rol
    let q = supabase.from('clients').select('*').order('name')
    // Admin: solo clientes de la casa. Socio: la RLS ya lo limita a los suyos.
    if (isAdmin) q = q.is('owner_partner_id', null)
    const { data } = await q
    if (data) setClients(data as Client[])
    setLoading(false)
  }, [isAdmin])

  useEffect(() => {
    reload()
    const onChanged = () => reload()
    window.addEventListener(CLIENTS_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(CLIENTS_CHANGED_EVENT, onChanged)
  }, [reload])

  /** Upsert por nombre (case-insensitive). Devuelve el Client (nuevo o existente). */
  const upsertByName = useCallback(
    async (rawName: string): Promise<Client | null> => {
      const name = rawName.trim()
      if (!name) return null

      const match = clients.find(
        (c) => c.name.toLowerCase() === name.toLowerCase()
      )
      if (match) return match

      const { data, error } = await supabase
        .from('clients')
        .insert({ name })
        .select()
        .single()

      if (error) {
        console.error(error)
        return null
      }
      const newClient = data as Client
      setClients((prev) => [...prev, newClient].sort((a, b) => a.name.localeCompare(b.name)))
      window.dispatchEvent(new CustomEvent(CLIENTS_CHANGED_EVENT))
      return newClient
    },
    [clients]
  )

  return { clients, loading, upsertByName, reload }
}
