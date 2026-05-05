import type { TransactionFilters } from '@/hooks/useTransactions'
import type { Account } from '@/types/database'

const CATEGORIES: Array<TransactionFilters['category']> = [
  '',
  'VENTA',
  'CAMBIO',
  'PAGO',
  'AJUSTE+',
  'AJUSTE-',
]
const STATUSES: Array<TransactionFilters['status']> = ['', 'PENDIENTE', 'CONCILIADO']

interface Props {
  value: TransactionFilters
  onChange: (next: TransactionFilters) => void
  accounts: Account[]
}

export default function TransactionFiltersBar({ value, onChange, accounts }: Props) {
  const set = <K extends keyof TransactionFilters>(key: K, v: TransactionFilters[K]) =>
    onChange({ ...value, [key]: v })

  return (
    <div className="cw-filters">
      <div>
        <label className="input-lbl">Desde</label>
        <input
          type="date"
          value={value.from ?? ''}
          onChange={(e) => set('from', e.target.value || undefined)}
          className="input"
        />
      </div>
      <div>
        <label className="input-lbl">Hasta</label>
        <input
          type="date"
          value={value.to ?? ''}
          onChange={(e) => set('to', e.target.value || undefined)}
          className="input"
        />
      </div>
      <div>
        <label className="input-lbl">Categoría</label>
        <select
          value={value.category ?? ''}
          onChange={(e) => set('category', e.target.value as TransactionFilters['category'])}
          className="select"
        >
          {CATEGORIES.map((c) => (
            <option key={c || 'all'} value={c}>
              {c || 'Todas'}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="input-lbl">Cuenta</label>
        <select
          value={value.accountId ?? ''}
          onChange={(e) => set('accountId', e.target.value || '')}
          className="select"
        >
          <option value="">Todas</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="input-lbl">Estatus</label>
        <select
          value={value.status ?? ''}
          onChange={(e) => set('status', e.target.value as TransactionFilters['status'])}
          className="select"
        >
          {STATUSES.map((s) => (
            <option key={s || 'all'} value={s}>
              {s || 'Todos'}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="input-lbl">Buscar</label>
        <input
          type="text"
          placeholder="Descripción / nombre"
          value={value.search ?? ''}
          onChange={(e) => set('search', e.target.value || undefined)}
          className="input"
        />
      </div>
    </div>
  )
}
