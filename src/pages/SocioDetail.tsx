import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { fmtBs, fmtUSD } from '@/lib/format'
import {
  AccountCard,
  BsStat,
  PendingCashCard,
} from '@/components/SaldoCards'
import TransactionTable from '@/components/TransactionTable'
import AuditList from '@/components/AuditList'
import { useTransactions } from '@/hooks/useTransactions'
import type {
  AccountBalance,
  AuditLogEntry,
  BolivarSummary,
  CashPending,
} from '@/types/database'

interface PartnerByOwner {
  partner_id: string
  name: string
  commission_share: number
  acumulado_total: number
  cobrado_total: number
  pendiente: number
}

export default function SocioDetail() {
  const { id = '' } = useParams()
  const [name, setName] = useState<string>('')
  const [accounts, setAccounts] = useState<AccountBalance[]>([])
  const [cashPending, setCashPending] = useState<CashPending | null>(null)
  const [bolivares, setBolivares] = useState<BolivarSummary | null>(null)
  const [partners, setPartners] = useState<PartnerByOwner[]>([])
  const [audit, setAudit] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  const { rows: txRows } = useTransactions({ ownerPartnerId: id })

  useEffect(() => {
    let mounted = true
    async function load() {
      const [p, acc, cp, bo, pb, au] = await Promise.all([
        supabase.from('partners').select('name').eq('id', id).maybeSingle(),
        supabase
          .from('account_balances')
          .select('*')
          .eq('owner_partner_id', id)
          .order('sort_order'),
        supabase
          .from('cash_pending_by_owner')
          .select('*')
          .eq('owner_partner_id', id)
          .maybeSingle(),
        supabase
          .from('bolivar_summary_by_owner')
          .select('*')
          .eq('owner_partner_id', id)
          .maybeSingle(),
        supabase
          .from('partner_balances_by_owner')
          .select('*')
          .eq('caja_partner_id', id),
        supabase
          .from('audit_log_view')
          .select('*')
          .eq('owner_partner_id', id)
          .limit(100),
      ])
      if (!mounted) return
      setName((p.data?.name as string) ?? 'Socio')
      if (acc.data) setAccounts(acc.data as AccountBalance[])
      setCashPending((cp.data as CashPending) ?? null)
      setBolivares((bo.data as BolivarSummary) ?? null)
      if (pb.data) setPartners(pb.data as PartnerByOwner[])
      if (au.data) setAudit(au.data as AuditLogEntry[])
      setLoading(false)
    }
    load()

    const channel = supabase
      .channel(`socio-${id}-tx`)
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
  }, [id])

  if (loading) {
    return (
      <div className="cw-page" style={{ color: 'var(--color-muted)' }}>
        Cargando…
      </div>
    )
  }

  const totalUsd = accounts.reduce((acc, a) => acc + Number(a.balance), 0)

  return (
    <div className="cw-page">
      <div className="cw-page-head">
        <div>
          <Link to="/" className="cw-back-link">
            ← Volver al panel
          </Link>
          <h1 className="cw-page-title">Caja de {name}</h1>
          <div className="cw-page-sub">Vista de solo lectura</div>
        </div>
      </div>

      {/* Saldos */}
      <section className="cw-section">
        <div className="cw-section-head">
          <div>
            <div className="cw-section-title">Saldos</div>
            <div className="cw-section-sub">Cuentas y wallet de Binance del socio</div>
          </div>
        </div>

        <div className="cw-acct-grid">
          {accounts.flatMap((a) => {
            const card = <AccountCard key={a.id} acct={a} />
            if (a.name === 'EFECTIVO' && cashPending) {
              return [
                card,
                <PendingCashCard
                  key="efectivo-pendiente"
                  amount={Number(cashPending.efectivo_pendiente)}
                  count={Number(cashPending.ventas_pendientes)}
                />,
              ]
            }
            return [card]
          })}
        </div>

        <div className="cw-total">
          Total cuentas <span className="cw-muted">(divisa conciliada + Binance):</span>
          <strong>{fmtUSD(totalUsd)}</strong>
        </div>
      </section>

      {/* Bolívares */}
      {bolivares && (
        <section className="cw-section">
          <div className="cw-section-head">
            <div>
              <div className="cw-section-title">Bolívares</div>
              <div className="cw-section-sub">
                Cálculo de diferencia y comisiones sobre ventas
              </div>
            </div>
          </div>
          <div className="cw-card">
            <div className="cw-bs-grid">
              <BsStat
                label="Ventas contabilizadas"
                value={String(Number(bolivares.ventas_count ?? 0))}
              />
              <BsStat
                label="DIF Bs bruto"
                value={fmtBs(Number(bolivares.dif_bs_total))}
                tone={Number(bolivares.dif_bs_total) >= 0 ? 'up' : 'down'}
              />
              <BsStat
                label="Comisión pago móvil (Bs)"
                value={fmtBs(Number(bolivares.comision_pago_movil_total))}
              />
              <BsStat
                label="DIF Bs neto"
                value={fmtBs(Number(bolivares.dif_bs_neto_total))}
                tone={Number(bolivares.dif_bs_neto_total) >= 0 ? 'up' : 'down'}
              />
              <BsStat
                label="Comisión Binance total"
                value={fmtUSD(Number(bolivares.comision_binance_total))}
              />
              <BsStat
                label="DIF $ neto (tras comisiones)"
                value={fmtUSD(Number(bolivares.dif_usd_neto_total))}
                tone={Number(bolivares.dif_usd_neto_total) >= 0 ? 'up' : 'down'}
              />
            </div>
          </div>
        </section>
      )}

      {/* Comisiones */}
      {partners.length > 0 && (
        <section className="cw-section">
          <div className="cw-section-head">
            <div>
              <div className="cw-section-title">Comisiones</div>
              <div className="cw-section-sub">Reparto de las ventas de esta caja</div>
            </div>
          </div>
          <div className="cw-partner-grid">
            {partners.map((p) => (
              <div key={p.partner_id} className="cw-partner">
                <div className="cw-partner-head">
                  <div className="cw-partner-name">{p.name}</div>
                  <div className="cw-partner-pct">
                    {Math.round(Number(p.commission_share) * 100)}%
                  </div>
                </div>
                <div className="cw-partner-row">
                  <div>
                    <div className="lbl">Acumulado</div>
                    <div className="val">{fmtUSD(Number(p.acumulado_total))}</div>
                  </div>
                  <div>
                    <div className="lbl">Cobrado</div>
                    <div className="val">{fmtUSD(Number(p.cobrado_total))}</div>
                  </div>
                  <div>
                    <div className="lbl">Pendiente</div>
                    <div className="val pending">{fmtUSD(Number(p.pendiente))}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Transacciones */}
      <section className="cw-section">
        <div className="cw-section-head">
          <div>
            <div className="cw-section-title">Transacciones</div>
            <div className="cw-section-sub">{txRows.length} registros</div>
          </div>
        </div>
        <TransactionTable rows={txRows} onChanged={() => {}} readOnly />
      </section>

      {/* Actividad / auditoría */}
      {audit.length > 0 && (
        <section className="cw-section">
          <div className="cw-section-head">
            <div>
              <div className="cw-section-title">Actividad</div>
              <div className="cw-section-sub">
                Creaciones, ediciones y borrados en esta caja
              </div>
            </div>
          </div>
          <AuditList entries={audit} />
        </section>
      )}
    </div>
  )
}
