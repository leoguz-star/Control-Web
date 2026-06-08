import { useMemo } from 'react'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table'
import { supabase } from '@/lib/supabase'
import type { TransactionRow } from '@/hooks/useTransactions'
import { fmtBs, fmtNum, fmtPct, fmtUSD } from '@/lib/format'
import Icon from './Icon'

interface Props {
  rows: TransactionRow[]
  onChanged: () => void
  onEdit?: (row: TransactionRow) => void
  /** Solo lectura: sin cambiar estatus, editar ni eliminar (drill-down del admin). */
  readOnly?: boolean
}

const CAT_CLASS: Record<string, string> = {
  VENTA: 'venta',
  CAMBIO: 'cambio',
  PAGO: 'pago',
  'AJUSTE+': 'ajuste-plus',
  'AJUSTE-': 'ajuste-minus',
}

export default function TransactionTable({
  rows,
  onChanged,
  onEdit,
  readOnly = false,
}: Props) {
  const columns = useMemo<ColumnDef<TransactionRow>[]>(
    () => [
      {
        accessorKey: 'date',
        header: 'Fecha',
        cell: ({ getValue }) => {
          const v = getValue<string>()
          if (!v) return '—'
          const [y, m, d] = v.split('-')
          return (
            <span className="cw-num cw-muted">{`${d}/${m}/${y.slice(2)}`}</span>
          )
        },
      },
      {
        id: 'desc',
        header: 'Descripción',
        cell: ({ row }) => (
          <span className="cw-strong">
            {row.original.client?.name ?? row.original.description ?? '—'}
          </span>
        ),
      },
      {
        accessorKey: 'category',
        header: 'Categoría',
        cell: ({ getValue }) => {
          const cat = getValue<string>()
          return (
            <span className={`cw-cat ${CAT_CLASS[cat] ?? ''}`}>{cat}</span>
          )
        },
      },
      {
        id: 'cuenta',
        header: 'Cuenta',
        cell: ({ row }) => {
          const a = row.original.account?.name ?? '—'
          const b = row.original.destination_account?.name
          return (
            <span className="cw-muted">{b ? `${a} → ${b}` : a}</span>
          )
        },
      },
      {
        accessorKey: 'monto_usdt',
        header: () => <span style={{ display: 'block', textAlign: 'right' }}>USDT</span>,
        cell: ({ getValue }) => (
          <div style={{ textAlign: 'right' }} className="cw-num">
            {fmtNum(getValue<number | null>())}
          </div>
        ),
      },
      {
        accessorKey: 'tasa_usdt',
        header: () => (
          <span style={{ display: 'block', textAlign: 'right' }}>Tasa USDT</span>
        ),
        cell: ({ getValue }) => (
          <div style={{ textAlign: 'right' }} className="cw-num cw-muted">
            {fmtNum(getValue<number | null>())}
          </div>
        ),
      },
      {
        accessorKey: 'ref',
        header: () => <span style={{ display: 'block', textAlign: 'right' }}>Ref</span>,
        cell: ({ getValue }) => (
          <div style={{ textAlign: 'right' }} className="cw-num cw-muted">
            {getValue<string | null>() ?? '—'}
          </div>
        ),
      },
      {
        accessorKey: 'monto_divisa',
        header: () => (
          <span style={{ display: 'block', textAlign: 'right' }}>Divisa $</span>
        ),
        cell: ({ getValue }) => (
          <div style={{ textAlign: 'right' }} className="cw-num">
            {fmtUSD(getValue<number | null>())}
          </div>
        ),
      },
      {
        accessorKey: 'tasa_divisa',
        header: () => (
          <span style={{ display: 'block', textAlign: 'right' }}>Tasa Divisa</span>
        ),
        cell: ({ getValue }) => (
          <div style={{ textAlign: 'right' }} className="cw-num cw-muted">
            {fmtNum(getValue<number | null>())}
          </div>
        ),
      },
      {
        accessorKey: 'dif_usd',
        header: () => <span style={{ display: 'block', textAlign: 'right' }}>DIF $</span>,
        cell: ({ getValue, row }) => {
          if (row.original.category !== 'VENTA') {
            return (
              <div style={{ textAlign: 'right' }} className="cw-num cw-muted">
                —
              </div>
            )
          }
          const v = Number(getValue<number>() ?? 0)
          return (
            <div
              style={{ textAlign: 'right' }}
              className={`cw-num ${v >= 0 ? 'up' : 'down'}`}
            >
              {fmtUSD(v)}
            </div>
          )
        },
      },
      {
        accessorKey: 'dif_bs',
        header: () => <span style={{ display: 'block', textAlign: 'right' }}>DIF Bs</span>,
        cell: ({ getValue, row }) => {
          if (row.original.category !== 'VENTA') {
            return (
              <div style={{ textAlign: 'right' }} className="cw-num cw-muted">
                —
              </div>
            )
          }
          const v = Number(getValue<number>() ?? 0)
          return (
            <div
              style={{ textAlign: 'right' }}
              className={`cw-num ${v >= 0 ? 'up' : 'down'}`}
            >
              {fmtBs(v)}
            </div>
          )
        },
      },
      {
        accessorKey: 'margen_pct',
        header: () => <span style={{ display: 'block', textAlign: 'right' }}>%</span>,
        cell: ({ getValue }) => {
          const v = getValue<number | null>()
          if (v == null) {
            return (
              <div style={{ textAlign: 'right' }} className="cw-num cw-muted">
                —
              </div>
            )
          }
          const n = Number(v)
          return (
            <div
              style={{ textAlign: 'right' }}
              className={`cw-num ${n >= 0 ? 'up' : 'down'}`}
            >
              {fmtPct(n)}
            </div>
          )
        },
      },
      {
        accessorKey: 'status',
        header: 'Estatus',
        cell: ({ getValue, row }) => {
          const v = getValue<'PENDIENTE' | 'CONCILIADO'>()
          const cls = `cw-status ${v === 'CONCILIADO' ? 'conciled' : 'pending'}`
          if (readOnly) {
            return <span className={cls}>{v}</span>
          }
          const next = v === 'PENDIENTE' ? 'CONCILIADO' : 'PENDIENTE'
          return (
            <button
              onClick={async () => {
                const { error } = await supabase
                  .from('transactions')
                  .update({ status: next })
                  .eq('id', row.original.id)
                if (!error) onChanged()
              }}
              className={cls}
              title="Click para cambiar estatus"
              style={{ border: 0, cursor: 'pointer' }}
            >
              {v}
            </button>
          )
        },
      },
      ...(readOnly
        ? []
        : [
            {
              id: 'actions',
              header: '',
              cell: ({ row }) => (
                <div className="cw-row-actions">
                  {onEdit && (
                    <button
                      className="btn btn-ghost"
                      onClick={() => onEdit(row.original)}
                    >
                      Editar
                    </button>
                  )}
                  <button
                    className="btn btn-danger-ghost"
                    onClick={async () => {
                      if (!confirm('¿Eliminar esta transacción?')) return
                      const { error } = await supabase
                        .from('transactions')
                        .delete()
                        .eq('id', row.original.id)
                      if (!error) onChanged()
                    }}
                  >
                    Eliminar
                  </button>
                </div>
              ),
            } as ColumnDef<TransactionRow>,
          ]),
    ],
    [onChanged, onEdit, readOnly]
  )

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className="cw-table-wrap">
      {rows.length === 0 ? (
        <div className="cw-empty">
          <div className="ic">
            <Icon name="search" size={28} />
          </div>
          <h3>Sin resultados</h3>
          <div>Ajusta los filtros o crea una nueva transacción.</div>
        </div>
      ) : (
        <table className="cw-table">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id}>
                    {h.isPlaceholder
                      ? null
                      : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
