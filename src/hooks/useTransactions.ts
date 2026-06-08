import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useIsAdmin } from './useIsAdmin'
import type {
  Transaction,
  TransactionCategory,
  TransactionStatus,
} from '@/types/database'

export interface TransactionRow extends Transaction {
  account: { name: string } | null
  destination_account: { name: string } | null
  client: { name: string } | null
  partner: { name: string } | null
}

export interface TransactionFilters {
  from?: string
  to?: string
  category?: TransactionCategory | ''
  accountId?: string | ''
  status?: TransactionStatus | ''
  search?: string
  /** Drill-down del admin: ver la caja de un socio concreto en vez de la propia. */
  ownerPartnerId?: string
}

export function useTransactions(filters: TransactionFilters) {
  const isAdmin = useIsAdmin()
  const [rows, setRows] = useState<TransactionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const lastReq = useRef(0)

  const fetchRows = useCallback(async () => {
    if (isAdmin === null) return // esperar a saber el rol
    setLoading(true)
    setError(null)
    const reqId = ++lastReq.current

    let q = supabase
      .from('transactions')
      .select(
        `
          *,
          account:account_id ( name ),
          destination_account:destination_account_id ( name ),
          client:client_id ( name ),
          partner:partner_id ( name )
        `
      )
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(500)

    // Drill-down: caja de un socio concreto. Si no, admin -> casa (owner NULL);
    // socio -> la RLS ya lo limita a lo suyo.
    if (filters.ownerPartnerId) {
      q = q.eq('owner_partner_id', filters.ownerPartnerId)
    } else if (isAdmin) {
      q = q.is('owner_partner_id', null)
    }

    if (filters.from) q = q.gte('date', filters.from)
    if (filters.to) q = q.lte('date', filters.to)
    if (filters.category) q = q.eq('category', filters.category)
    if (filters.accountId) q = q.eq('account_id', filters.accountId)
    if (filters.status) q = q.eq('status', filters.status)

    const { data, error } = await q
    if (reqId !== lastReq.current) return
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    setRows((data ?? []) as unknown as TransactionRow[])
    setLoading(false)
  }, [
    isAdmin,
    filters.from,
    filters.to,
    filters.category,
    filters.accountId,
    filters.status,
    filters.ownerPartnerId,
  ])

  useEffect(() => {
    fetchRows()
  }, [fetchRows])

  const filteredRows = useMemo(() => {
    const term = filters.search?.trim().toLowerCase()
    if (!term) return rows
    return rows.filter((r) => {
      const desc = r.description?.toLowerCase() ?? ''
      const client = r.client?.name.toLowerCase() ?? ''
      return desc.includes(term) || client.includes(term)
    })
  }, [rows, filters.search])

  return { rows: filteredRows, loading, error, refresh: fetchRows }
}
