import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Account } from '@/types/database'

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    supabase
      .from('accounts')
      .select('*')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        if (!mounted) return
        if (data) setAccounts(data as Account[])
        setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [])

  return { accounts, loading }
}
