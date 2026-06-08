import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { fmtUSD } from '@/lib/format'
import { AccountCard, cashBalanceToAccount } from '@/components/SaldoCards'
import { useIsAdmin } from '@/hooks/useIsAdmin'
import type { PartnerCashBalance } from '@/types/database'

export default function CajasSocios() {
  const isAdmin = useIsAdmin()
  const [partnerCajas, setPartnerCajas] = useState<PartnerCashBalance[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (isAdmin !== true) return
    let mounted = true
    async function load() {
      const { data } = await supabase.from('partner_cash_balances').select('*')
      if (!mounted) return
      if (data) setPartnerCajas(data as PartnerCashBalance[])
      setLoading(false)
    }
    load()

    const channel = supabase
      .channel('cajas-socios-tx')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions' },
        () => load(),
      )
      .subscribe()

    return () => {
      mounted = false
      supabase.removeChannel(channel)
    }
  }, [isAdmin])

  // Solo admin. Mientras se resuelve el rol, esperamos.
  if (isAdmin === null) {
    return (
      <div className="cw-page" style={{ color: 'var(--color-muted)' }}>
        Cargando…
      </div>
    )
  }
  if (isAdmin === false) return <Navigate to="/" replace />

  const cajasPorSocio = Object.values(
    partnerCajas.reduce<
      Record<string, { id: string; name: string; accts: PartnerCashBalance[] }>
    >((acc, c) => {
      if (!acc[c.partner_id]) {
        acc[c.partner_id] = { id: c.partner_id, name: c.partner_name, accts: [] }
      }
      acc[c.partner_id].accts.push(c)
      return acc
    }, {}),
  )

  return (
    <div className="cw-page">
      <div className="cw-page-head">
        <div>
          <h1 className="cw-page-title">Cajas de socios</h1>
          <div className="cw-page-sub">
            {loading
              ? 'Cargando…'
              : `${cajasPorSocio.length} socio${cajasPorSocio.length === 1 ? '' : 's'} · saldos en tiempo real`}
          </div>
        </div>
      </div>

      {!loading && cajasPorSocio.length === 0 && (
        <div className="cw-empty">
          <h3>Sin socios todavía</h3>
          <div>Cuando des de alta un socio, su caja aparecerá aquí.</div>
        </div>
      )}

      {cajasPorSocio.map((socio) => {
        const totalSocio = socio.accts.reduce(
          (acc, c) => acc + Number(c.balance),
          0,
        )
        return (
          <section key={socio.id} className="cw-section">
            <div className="cw-socio-caja-head">
              <Link to={`/socios/${socio.id}`} className="cw-socio-caja-name">
                {socio.name}{' '}
                <span className="cw-socio-caja-link">ver caja →</span>
              </Link>
              <span className="cw-socio-caja-total">{fmtUSD(totalSocio)}</span>
            </div>
            <div className="cw-acct-grid">
              {socio.accts.map((c) => (
                <AccountCard key={c.account_id} acct={cashBalanceToAccount(c)} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
