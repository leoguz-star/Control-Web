import { fmtNum } from '@/lib/format'
import type { AccountBalance, PartnerCashBalance } from '@/types/database'

export function cashBalanceToAccount(c: PartnerCashBalance): AccountBalance {
  return {
    id: c.account_id,
    name: c.account_name,
    kind: c.kind,
    currency: c.currency,
    sort_order: c.sort_order,
    owner_partner_id: c.partner_id,
    balance: c.balance,
  }
}

function iconClassFor(a: AccountBalance): string {
  if (a.name === 'BINANCE') return 'binance'
  if (a.name === 'EFECTIVO') return 'cash'
  if (a.name === 'EURO') return 'eur'
  return 'usd'
}

function glyphFor(a: AccountBalance): string {
  if (a.name === 'BINANCE') return 'B'
  if (a.name === 'EFECTIVO') return '$'
  if (a.name === 'EURO') return '€'
  return a.name.slice(0, 4).toUpperCase()
}

export function AccountCard({
  acct,
  active = false,
  onClick,
}: {
  acct: AccountBalance
  active?: boolean
  onClick?: () => void
}) {
  const isBinance = acct.name === 'BINANCE'
  const isEur = acct.name === 'EURO'
  const balance = Number(acct.balance)

  return (
    <div
      className={`cw-acct${active ? ' is-active' : ''}`}
      onClick={onClick}
    >
      <div className="cw-acct-row">
        <span className="cw-acct-label">{acct.name}</span>
        <span className={`cw-acct-icon ${iconClassFor(acct)}`}>
          {glyphFor(acct)}
        </span>
      </div>
      <div className="cw-acct-amount">
        {isBinance ? (
          <>
            {fmtNum(balance)}
            <span className="unit">USDT</span>
          </>
        ) : isEur ? (
          <>€{fmtNum(balance)}</>
        ) : (
          <>${fmtNum(balance)}</>
        )}
      </div>
      <div className="cw-acct-meta">
        {isBinance
          ? 'Spot wallet'
          : balance > 0
            ? 'Disponible'
            : 'Sin movimientos'}
      </div>
    </div>
  )
}

export function PendingCashCard({
  amount,
  count,
}: {
  amount: number
  count: number
}) {
  return (
    <div className="cw-acct cw-acct-pending">
      <div className="cw-acct-row">
        <span className="cw-acct-label">EFECTIVO PEND.</span>
        <span className="cw-acct-icon pending">⌛</span>
      </div>
      <div className="cw-acct-amount">${fmtNum(amount)}</div>
      <div className="cw-acct-meta">
        {count > 0
          ? `${count} venta${count === 1 ? '' : 's'} sin conciliar`
          : 'Nada pendiente'}
      </div>
    </div>
  )
}

export function BsStat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'up' | 'down'
}) {
  return (
    <div className="cw-bs-stat">
      <div className="lbl">{label}</div>
      <div className={`val${tone ? ' ' + tone : ''}`}>{value}</div>
    </div>
  )
}
