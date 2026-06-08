import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fmtBs, fmtUSD } from '@/lib/format'
import { AccountCard, BsStat, PendingCashCard } from '@/components/SaldoCards'
import type {
  AccountBalance,
  BolivarSummary,
  CashPending,
  PartnerBalance,
} from '@/types/database'

export default function Dashboard() {
  const [accounts, setAccounts] = useState<AccountBalance[]>([])
  const [partners, setPartners] = useState<PartnerBalance[]>([])
  const [bolivares, setBolivares] = useState<BolivarSummary | null>(null)
  const [cashPending, setCashPending] = useState<CashPending | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeAcct, setActiveAcct] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    async function load() {
      const [a, p, b, cp] = await Promise.all([
        supabase.from('my_account_balances').select('*').order('sort_order'),
        supabase.from('partner_balances').select('*'),
        supabase.from('bolivar_summary').select('*').single(),
        supabase.from('cash_pending').select('*').single(),
      ])
      if (!mounted) return
      if (a.data) setAccounts(a.data as AccountBalance[])
      if (p.data) setPartners(p.data as PartnerBalance[])
      if (b.data) setBolivares(b.data as BolivarSummary)
      if (cp.data) setCashPending(cp.data as CashPending)
      setLoading(false)
    }
    load()

    // Refresco en tiempo real: cualquier cambio en transactions recarga el panel.
    const channel = supabase
      .channel('dashboard-tx')
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
  }, [])

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
      {/* Saldos */}
      <section className="cw-section">
        <div className="cw-section-head">
          <div>
            <div className="cw-section-title">Saldos</div>
            <div className="cw-section-sub">
              Resumen de cuentas y wallet de Binance
            </div>
          </div>
        </div>

        <div className="cw-acct-grid">
          {accounts.flatMap((a) => {
            const card = (
              <AccountCard
                key={a.id}
                acct={a}
                active={activeAcct === a.id}
                onClick={() =>
                  setActiveAcct((cur) => (cur === a.id ? null : a.id))
                }
              />
            )
            // Insertamos la card de "Efectivo pendiente" justo después de EFECTIVO
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
                tone={
                  Number(bolivares.dif_bs_total) >= 0 ? 'up' : 'down'
                }
              />
              <BsStat
                label="Comisión pago móvil (Bs)"
                value={fmtBs(Number(bolivares.comision_pago_movil_total))}
              />
              <BsStat
                label="DIF Bs neto"
                value={fmtBs(Number(bolivares.dif_bs_neto_total))}
                tone={
                  Number(bolivares.dif_bs_neto_total) >= 0 ? 'up' : 'down'
                }
              />
              <BsStat
                label="Comisión Binance total"
                value={fmtUSD(Number(bolivares.comision_binance_total))}
              />
              <BsStat
                label="DIF $ neto (tras comisiones)"
                value={fmtUSD(Number(bolivares.dif_usd_neto_total))}
                tone={
                  Number(bolivares.dif_usd_neto_total) >= 0 ? 'up' : 'down'
                }
              />
            </div>
          </div>
          <div className="cw-fineprint">
            "Neto Bs" = DIF Bs − comisión de pago móvil (0.3%). "DIF $ neto"
            también descuenta $0.06 por transacción de Binance.
          </div>
        </section>
      )}

      {/* Comisiones por socio */}
      <section className="cw-section">
        <div className="cw-section-head">
          <div>
            <div className="cw-section-title">Comisiones por socio</div>
            <div className="cw-section-sub">
              Acumulado, cobrado y pendiente del periodo
            </div>
          </div>
        </div>
        <div className="cw-partner-grid">
          {partners.map((p) => (
            <div key={p.id} className="cw-partner">
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
                  <div className="val pending">
                    {fmtUSD(Number(p.pendiente))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

