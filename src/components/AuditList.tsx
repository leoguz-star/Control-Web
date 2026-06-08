import { fmtNum } from '@/lib/format'
import { useNameMap } from '@/hooks/useNameMap'
import type { AuditLogEntry } from '@/types/database'

type NameMap = Record<string, string>

const ACTION_LABEL: Record<string, string> = {
  INSERT: 'Creó',
  UPDATE: 'Editó',
  DELETE: 'Eliminó',
}
const TABLE_LABEL: Record<string, string> = {
  transactions: 'transacción',
  clients: 'cliente',
  accounts: 'cuenta',
}
const FIELD_LABEL: Record<string, string> = {
  date: 'Fecha',
  category: 'Categoría',
  description: 'Descripción',
  monto_usdt: 'USDT',
  tasa_usdt: 'Tasa USDT',
  ref: 'Ref',
  monto_divisa: 'Divisa $',
  tasa_divisa: 'Tasa divisa',
  ref2: 'Ref 2',
  aplica_pago_movil: 'Pago móvil',
  comision_binance_usd: 'Comisión Binance',
  status: 'Estatus',
  name: 'Nombre',
  notes: 'Notas',
  is_active: 'Cuenta activa',
  sort_order: 'Orden',
  initial_balance: 'Saldo inicial',
  client_id: 'Cliente',
  account_id: 'Cuenta',
  destination_account_id: 'Cuenta destino',
  partner_id: 'Socio (pago)',
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtVal(field: string, v: unknown, names: NameMap): string {
  if (v === null || v === undefined || v === '') return '∅'
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  // Referencias (client_id, account_id, partner_id...) -> nombre legible.
  if (field.endsWith('_id')) return names[String(v)] ?? '(eliminado)'
  if (typeof v === 'number') return fmtNum(v)
  return String(v)
}

function contexto(e: AuditLogEntry, names: NameMap): string {
  const d = (e.new_data ?? e.old_data ?? {}) as Record<string, unknown>
  if (e.table_name === 'transactions') {
    const cat = (d.category as string) ?? '—'
    const cliente = d.client_id ? names[String(d.client_id)] : ''
    const usdt = d.monto_usdt != null ? `${fmtNum(Number(d.monto_usdt))} USDT` : ''
    const fecha = (d.date as string) ?? ''
    return [cat, cliente, usdt, fecha].filter(Boolean).join(' · ')
  }
  return (d.name as string) ?? '—'
}

/** Lista de eventos de auditoría. `showActor` muestra quién hizo cada acción. */
export default function AuditList({
  entries,
  showActor = true,
}: {
  entries: AuditLogEntry[]
  showActor?: boolean
}) {
  const names = useNameMap()
  return (
    <div className="cw-audit-list">
      {entries.map((e) => (
        <div key={e.id} className={`cw-audit-item action-${e.action}`}>
          <div className="cw-audit-head">
            {showActor && (
              <span className="cw-audit-actor">{e.actor_name ?? '—'}</span>
            )}
            <span className={`cw-audit-action ${e.action}`}>
              {ACTION_LABEL[e.action] ?? e.action}
            </span>
            <span className="cw-audit-obj">
              {TABLE_LABEL[e.table_name] ?? e.table_name}
            </span>
            <span className="cw-audit-ctx">· {contexto(e, names)}</span>
            <span className="cw-audit-when">{fmtDateTime(e.created_at)}</span>
          </div>

          {e.action === 'UPDATE' && e.changed_fields && (
            <div className="cw-audit-changes">
              {e.changed_fields.map((f) => (
                <div key={f} className="cw-audit-change">
                  <span className="f">{FIELD_LABEL[f] ?? f}</span>
                  <span className="old">{fmtVal(f, e.old_data?.[f], names)}</span>
                  <span className="arr">→</span>
                  <span className="new">{fmtVal(f, e.new_data?.[f], names)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
