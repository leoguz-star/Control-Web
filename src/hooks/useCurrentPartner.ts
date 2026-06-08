import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface CurrentPartner {
  id: string
  name: string
  role: 'ADMIN' | 'SOCIO'
}

/** El partner del usuario logueado (para mostrar el nombre en vez del email). */
export function useCurrentPartner() {
  const [partner, setPartner] = useState<CurrentPartner | null>(null)

  useEffect(() => {
    let mounted = true
    async function load() {
      const { data: auth } = await supabase.auth.getUser()
      const uid = auth.user?.id
      if (!uid) return
      const { data } = await supabase
        .from('partners')
        .select('id, name, role')
        .eq('user_id', uid)
        .maybeSingle()
      if (mounted && data) setPartner(data as CurrentPartner)
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  return partner
}
