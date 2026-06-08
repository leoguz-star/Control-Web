import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Account } from '@/types/database'
import { useIsAdmin } from './useIsAdmin'

export function useAccounts() {
  const isAdmin = useIsAdmin()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (isAdmin === null) return // esperar a saber el rol
    let mounted = true
    let q = supabase
      .from('accounts')
      .select('*')
      .eq('is_active', true)
      .order('sort_order')
    // Admin: solo cuentas de la casa. Socio: la RLS ya lo limita a las suyas.
    if (isAdmin) q = q.is('owner_partner_id', null)
    q.then(({ data }) => {
      if (!mounted) return
      if (data) setAccounts(data as Account[])
      setLoading(false)
    })
    return () => {
      mounted = false
    }
  }, [isAdmin])

  return { accounts, loading }
}
