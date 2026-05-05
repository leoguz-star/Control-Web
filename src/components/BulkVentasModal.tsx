import { useEffect, useState } from 'react'
import Modal from './Modal'
import ClientCombobox from './ClientCombobox'
import Icon from './Icon'
import { supabase } from '@/lib/supabase'
import { fmtBs, fmtUSD, parseNumber } from '@/lib/format'
import { extractFromImages } from '@/lib/extract'
import { useAccounts } from '@/hooks/useAccounts'
import { useClients } from '@/hooks/useClients'

interface Props {
  open: boolean
  onClose: () => void
  onSaved: () => void
}

const BINANCE_FEE_USD = 0.06

interface Draft {
  id: string
  binance: File
  pagoMovil: File
  status: 'pending' | 'extracting' | 'done' | 'error'
  errorMsg?: string
  monto_usdt: number | null
  tasa_usdt: number | null
  ref: string | null
  monto_divisa_bs: number | null
  ref2: string | null
  cliente_nombre: string | null
  clientName: string
  tasaDivisa: string
  montoDivisa: string
  aplicaPagoMovil: boolean
  accountId: string
}

const todayISO = () => new Date().toISOString().slice(0, 10)
const localId = () => Math.random().toString(36).slice(2, 10)

export default function BulkVentasModal({ open, onClose, onSaved }: Props) {
  const { accounts } = useAccounts()
  const { clients, upsertByName } = useClients()

  const [files, setFiles] = useState<File[]>([])
  const [defaultAccountId, setDefaultAccountId] = useState('')
  const [defaultTasaDivisa, setDefaultTasaDivisa] = useState('')
  const [date, setDate] = useState(todayISO())
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [processing, setProcessing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setFiles([])
      setDrafts([])
      setError(null)
      setProcessing(false)
      setSaving(false)
    }
  }, [open])

  function pairsFromFiles(input: File[]): Array<[File, File]> {
    const pairs: Array<[File, File]> = []
    for (let i = 0; i + 1 < input.length; i += 2) {
      pairs.push([input[i], input[i + 1]])
    }
    return pairs
  }

  async function processAll() {
    setError(null)
    if (files.length === 0) {
      setError('Selecciona imágenes primero')
      return
    }
    if (files.length % 2 !== 0) {
      setError('La cantidad debe ser par: Binance + pago móvil por cada venta')
      return
    }

    const pairs = pairsFromFiles(files)
    const initial: Draft[] = pairs.map(([b, p]) => ({
      id: localId(),
      binance: b,
      pagoMovil: p,
      status: 'pending',
      monto_usdt: null,
      tasa_usdt: null,
      ref: null,
      monto_divisa_bs: null,
      ref2: null,
      cliente_nombre: null,
      clientName: '',
      tasaDivisa: defaultTasaDivisa,
      montoDivisa: '',
      aplicaPagoMovil: true,
      accountId: defaultAccountId,
    }))
    setDrafts(initial)
    setProcessing(true)

    for (const draft of initial) {
      setDrafts((prev) =>
        prev.map((d) => (d.id === draft.id ? { ...d, status: 'extracting' } : d))
      )
      try {
        const r = await extractFromImages([draft.binance, draft.pagoMovil])
        setDrafts((prev) =>
          prev.map((d) => {
            if (d.id !== draft.id) return d
            const tasa = parseNumber(d.tasaDivisa)
            const auto =
              r.monto_divisa_bs != null && tasa != null && tasa > 0
                ? (r.monto_divisa_bs / tasa).toFixed(2)
                : ''
            return {
              ...d,
              status: 'done',
              monto_usdt: r.monto_usdt,
              tasa_usdt: r.tasa_usdt,
              ref: r.ref,
              monto_divisa_bs: r.monto_divisa_bs,
              ref2: r.ref2,
              cliente_nombre: r.cliente_nombre,
              clientName: r.cliente_nombre ?? d.clientName,
              montoDivisa: auto,
            }
          })
        )
      } catch (e) {
        setDrafts((prev) =>
          prev.map((d) =>
            d.id === draft.id
              ? {
                  ...d,
                  status: 'error',
                  errorMsg: e instanceof Error ? e.message : String(e),
                }
              : d
          )
        )
      }
    }

    setProcessing(false)
  }

  function updateDraft(id: string, patch: Partial<Draft>) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.id !== id) return d
        const merged = { ...d, ...patch }
        if ('tasaDivisa' in patch) {
          const tasa = parseNumber(merged.tasaDivisa)
          if (merged.monto_divisa_bs != null && tasa != null && tasa > 0) {
            merged.montoDivisa = (merged.monto_divisa_bs / tasa).toFixed(2)
          }
        }
        return merged
      })
    )
  }

  function removeDraft(id: string) {
    setDrafts((prev) => prev.filter((d) => d.id !== id))
  }

  async function saveAll() {
    setError(null)
    const ready = drafts.filter((d) => d.status === 'done')
    if (ready.length === 0) {
      setError('No hay drafts listos para guardar')
      return
    }
    setSaving(true)

    try {
      const namesSet = new Set(
        ready.map((d) => d.clientName.trim()).filter((n) => n.length > 0)
      )
      const nameToId = new Map<string, string>()
      for (const name of namesSet) {
        const c = await upsertByName(name)
        if (c) nameToId.set(name.toLowerCase(), c.id)
      }

      const payloads = ready.map((d) => ({
        date,
        category: 'VENTA',
        description: null,
        client_id: nameToId.get(d.clientName.trim().toLowerCase()) ?? null,
        account_id: d.accountId || null,
        destination_account_id: null,
        partner_id: null,
        monto_usdt: d.monto_usdt,
        tasa_usdt: d.tasa_usdt,
        ref: d.ref,
        monto_divisa: parseNumber(d.montoDivisa),
        tasa_divisa: parseNumber(d.tasaDivisa),
        ref2: d.ref2,
        aplica_pago_movil: d.aplicaPagoMovil,
        comision_binance_usd: BINANCE_FEE_USD,
      }))

      const { error } = await supabase.from('transactions').insert(payloads)
      if (error) throw error

      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const readyCount = drafts.filter((d) => d.status === 'done').length
  const allDone =
    drafts.length > 0 &&
    drafts.every((d) => d.status === 'done' || d.status === 'error')
  const ventasCount = Math.floor(files.length / 2)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Carga masiva de ventas"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!allDone || readyCount === 0 || saving}
            onClick={saveAll}
          >
            {saving ? 'Guardando…' : `Guardar ${readyCount} venta(s)`}
          </button>
        </>
      }
    >
      <div className="cw-banner">
        Sube imágenes en orden:{' '}
        <strong style={{ color: 'var(--color-primary)' }}>1) Binance</strong>,{' '}
        <strong style={{ color: 'var(--color-primary)' }}>2) Pago móvil</strong>
        , repetido por cada venta. Por ejemplo, 6 imágenes = 3 ventas.
      </div>

      <div className="form-grid-3" style={{ marginBottom: 16 }}>
        <div>
          <label className="input-lbl">Fecha</label>
          <input
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <label className="input-lbl">Cuenta destino (default)</label>
          <select
            className="select"
            value={defaultAccountId}
            onChange={(e) => setDefaultAccountId(e.target.value)}
          >
            <option value="">—</option>
            {accounts
              .filter((a) => a.kind === 'FIAT')
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className="input-lbl">Tasa divisa Bs/$ (default)</label>
          <input
            className="input"
            inputMode="decimal"
            placeholder="ej. 590"
            value={defaultTasaDivisa}
            onChange={(e) => setDefaultTasaDivisa(e.target.value)}
          />
        </div>
      </div>

      <div className="cw-upload" style={{ marginBottom: 16 }}>
        <Icon
          name="image"
          size={22}
          style={{ color: 'var(--color-primary)' }}
        />
        <div className="meta">
          <strong>
            {files.length === 0
              ? 'Sin imágenes seleccionadas'
              : `${files.length} imágenes · ${ventasCount} ventas detectadas`}
          </strong>
          {files.length > 0 &&
            files
              .slice(0, 3)
              .map((f) => f.name)
              .join(', ')}
        </div>
        <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
          <Icon name="upload" size={14} /> Seleccionar
          <input
            type="file"
            multiple
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              setFiles(Array.from(e.target.files ?? []))
              setDrafts([])
              setError(null)
            }}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={files.length === 0 || processing}
          onClick={processAll}
        >
          {processing ? 'Procesando…' : `Procesar ${ventasCount} ventas`}
        </button>
      </div>

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

      {drafts.length > 0 && (
        <div
          style={{
            marginBottom: 8,
            fontSize: 12,
            color: 'var(--color-muted)',
          }}
        >
          {readyCount} / {drafts.length} listas
        </div>
      )}

      {drafts.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            maxHeight: '52vh',
            overflowY: 'auto',
          }}
        >
          {drafts.map((d, i) => (
            <DraftRow
              key={d.id}
              index={i + 1}
              draft={d}
              accounts={accounts.filter((a) => a.kind === 'FIAT')}
              clients={clients}
              onChange={(patch) => updateDraft(d.id, patch)}
              onRemove={() => removeDraft(d.id)}
            />
          ))}
        </div>
      )}
    </Modal>
  )
}

interface DraftRowProps {
  index: number
  draft: Draft
  accounts: ReturnType<typeof useAccounts>['accounts']
  clients: ReturnType<typeof useClients>['clients']
  onChange: (patch: Partial<Draft>) => void
  onRemove: () => void
}

function DraftRow({
  index,
  draft,
  accounts,
  clients,
  onChange,
  onRemove,
}: DraftRowProps) {
  const status =
    draft.status === 'pending'
      ? { text: 'en cola', tone: 'var(--color-muted)' }
      : draft.status === 'extracting'
        ? { text: 'procesando…', tone: 'var(--color-primary)' }
        : draft.status === 'done'
          ? { text: 'listo', tone: 'var(--color-trading-up)' }
          : { text: 'error', tone: 'var(--color-trading-down)' }

  return (
    <div
      style={{
        background: 'var(--color-canvas-dark)',
        border: '1px solid var(--color-hairline-on-dark)',
        borderRadius: 8,
        padding: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: draft.status === 'done' ? 12 : 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#fff', fontWeight: 700 }}>#{index}</span>
          <span style={{ color: status.tone, fontSize: 12 }}>
            {status.text}
          </span>
          <span
            style={{ color: 'var(--color-muted)', fontSize: 11 }}
            title={`${draft.binance.name} + ${draft.pagoMovil.name}`}
          >
            {draft.binance.name.length > 24
              ? draft.binance.name.slice(0, 24) + '…'
              : draft.binance.name}{' '}
            +{' '}
            {draft.pagoMovil.name.length > 24
              ? draft.pagoMovil.name.slice(0, 24) + '…'
              : draft.pagoMovil.name}
          </span>
        </div>
        <button className="btn btn-danger-ghost" onClick={onRemove}>
          Quitar
        </button>
      </div>

      {draft.status === 'error' && (
        <div
          className="cw-banner"
          style={{
            margin: '8px 0 0',
            borderLeftColor: 'var(--color-trading-down)',
            color: 'var(--color-trading-down)',
          }}
        >
          {draft.errorMsg}
        </div>
      )}

      {draft.status === 'done' && (
        <>
          <div
            className="bulk-draft-readonly"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(6, 1fr)',
              gap: 10,
              marginBottom: 12,
              fontSize: 12,
            }}
          >
            <ReadOnly
              label="USDT"
              value={
                draft.monto_usdt != null ? String(draft.monto_usdt) : '—'
              }
            />
            <ReadOnly
              label="Tasa USDT"
              value={
                draft.tasa_usdt != null ? String(draft.tasa_usdt) : '—'
              }
            />
            <ReadOnly label="Ref Bin." value={draft.ref ?? '—'} />
            <ReadOnly
              label="Total Bs"
              value={
                draft.monto_divisa_bs != null
                  ? fmtBs(draft.monto_divisa_bs)
                  : '—'
              }
            />
            <ReadOnly label="Ref PM" value={draft.ref2 ?? '—'} />
            <ReadOnly label="Detectado" value={draft.cliente_nombre ?? '—'} />
          </div>

          <div
            className="bulk-draft-fields"
            style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1fr 1fr 1fr',
              gap: 10,
            }}
          >
            <div>
              <label className="input-lbl">Cliente</label>
              <ClientCombobox
                value={draft.clientName}
                onChange={(v) => onChange({ clientName: v })}
                clients={clients}
                placeholder="—"
              />
            </div>
            <div>
              <label className="input-lbl">Tasa Bs/$</label>
              <input
                className="input"
                inputMode="decimal"
                placeholder="ej. 590"
                value={draft.tasaDivisa}
                onChange={(e) => onChange({ tasaDivisa: e.target.value })}
              />
            </div>
            <div>
              <label className="input-lbl">Monto $</label>
              <input
                className="input"
                inputMode="decimal"
                placeholder="ej. 10"
                value={draft.montoDivisa}
                onChange={(e) => onChange({ montoDivisa: e.target.value })}
              />
            </div>
            <div>
              <label className="input-lbl">Cuenta</label>
              <select
                className="select"
                value={draft.accountId}
                onChange={(e) => onChange({ accountId: e.target.value })}
              >
                <option value="">—</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {draft.monto_divisa_bs != null &&
            parseNumber(draft.montoDivisa) != null &&
            draft.monto_usdt != null && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: 'var(--color-muted)',
                }}
              >
                DIF $:{' '}
                <span
                  className="cw-num"
                  style={{
                    color: '#fff',
                    fontWeight: 600,
                  }}
                >
                  {fmtUSD(
                    (parseNumber(draft.montoDivisa) ?? 0) -
                      (draft.monto_usdt ?? 0)
                  )}
                </span>
              </div>
            )}
        </>
      )}
    </div>
  )
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          color: 'var(--color-muted)',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: '#fff',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </div>
    </div>
  )
}
