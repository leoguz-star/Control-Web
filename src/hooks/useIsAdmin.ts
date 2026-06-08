import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * ¿El usuario logueado es admin (casa)? `null` mientras se resuelve.
 * Se usa para acotar las vistas/consultas a la caja propia: los admins
 * ven la casa (owner_partner_id IS NULL) y los socios sólo lo suyo (vía RLS).
 */
export function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)

  useEffect(() => {
    let mounted = true
    supabase.rpc('is_admin').then(({ data }) => {
      if (mounted) setIsAdmin(data === true)
    })
    return () => {
      mounted = false
    }
  }, [])

  return isAdmin
}
