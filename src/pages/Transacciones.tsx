import { useState } from 'react'
import TransactionFiltersBar from '@/components/TransactionFilters'
import TransactionTable from '@/components/TransactionTable'
import NewTransactionModal from '@/components/NewTransactionModal'
import NewClientModal from '@/components/NewClientModal'
import BulkVentasModal from '@/components/BulkVentasModal'
import Icon from '@/components/Icon'
import { useAccounts } from '@/hooks/useAccounts'
import {
  useTransactions,
  type TransactionFilters,
  type TransactionRow,
} from '@/hooks/useTransactions'

export default function Transacciones() {
  const { accounts } = useAccounts()
  const [filters, setFilters] = useState<TransactionFilters>({})
  const { rows, loading, error, refresh } = useTransactions(filters)
  const [modalOpen, setModalOpen] = useState(false)
  const [clientModalOpen, setClientModalOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [editingTx, setEditingTx] = useState<TransactionRow | null>(null)

  return (
    <div className="cw-page">
      <div className="cw-page-head">
        <div>
          <h1 className="cw-page-title">Transacciones</h1>
          <div className="cw-page-sub">
            {loading ? 'Cargando…' : `${rows.length} registros`}
          </div>
        </div>
        <div className="cw-page-actions">
          <button
            className="btn btn-secondary"
            onClick={() => setClientModalOpen(true)}
          >
            <Icon name="plus" size={14} /> Cliente
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setBulkOpen(true)}
          >
            <Icon name="plus" size={14} /> Carga masiva
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setModalOpen(true)}
          >
            <Icon name="plus" size={14} /> Nueva
          </button>
        </div>
      </div>

      <TransactionFiltersBar
        value={filters}
        onChange={setFilters}
        accounts={accounts}
      />

      {error && (
        <div
          className="cw-banner"
          style={{
            borderLeftColor: 'var(--color-trading-down)',
            color: 'var(--color-trading-down)',
          }}
        >
          {error}
        </div>
      )}

      <TransactionTable
        rows={rows}
        onChanged={refresh}
        onEdit={(row) => setEditingTx(row)}
      />

      <NewTransactionModal
        open={modalOpen || editingTx !== null}
        onClose={() => {
          setModalOpen(false)
          setEditingTx(null)
        }}
        onSaved={refresh}
        editing={editingTx}
      />

      <NewClientModal
        open={clientModalOpen}
        onClose={() => setClientModalOpen(false)}
      />

      <BulkVentasModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onSaved={refresh}
      />
    </div>
  )
}
