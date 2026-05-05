import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Partner } from '@/types/database'

export function usePartners() {
  const [partners, setPartners] = useState<Partner[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    supabase
      .from('partners')
      .select('*')
      .order('name')
      .then(({ data }) => {
        if (!mounted) return
        if (data) setPartners(data as Partner[])
        setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [])

  return { partners, loading }
}
