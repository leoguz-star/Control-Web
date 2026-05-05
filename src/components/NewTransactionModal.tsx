import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import ClientCombobox from './ClientCombobox'
import Icon from './Icon'
import { supabase } from '@/lib/supabase'
import { fmtBs, fmtUSD, parseNumber } from '@/lib/format'
import { extractFromImages, type ExtractedFields } from '@/lib/extract'
import { useAccounts } from '@/hooks/useAccounts'
import { usePartners } from '@/hooks/usePartners'
import { useClients } from '@/hooks/useClients'
import type { TransactionCategory } from '@/types/database'
import type { TransactionRow } from '@/hooks/useTransactions'

interface Props {
  open: boolean
  onClose: () => void
  onSaved: () => void
  editing?: TransactionRow | null
}

const CATEGORIES: TransactionCategory[] = [
  'VENTA',
  'CAMBIO',
  'PAGO',
  'AJUSTE+',
  'AJUSTE-',
]

const BINANCE_FEE_USD = 0.06
const PAGO_MOVIL_RATE = 0.003

const todayISO = () => new Date().toISOString().slice(0, 10)

export default function NewTransactionModal({
  open,
  onClose,
  onSaved,
  editing,
}: Props) {
  const { accounts } = useAccounts()
  const { partners } = usePartners()
  const { clients, upsertByName } = useClients()

  const [category, setCategory] = useState<TransactionCategory>('VENTA')
  const [date, setDate] = useState(todayISO())
  const [clientName, setClientName] = useState('')
  const [description, setDescription] = useState('')
  const [accountId, setAccountId] = useState('')
  const [destAccountId, setDestAccountId] = useState('')
  const [partnerId, setPartnerId] = useState('')
  const [montoUsdt, setMontoUsdt] = useState('')
  const [tasaUsdt, setTasaUsdt] = useState('')
  const [ref, setRef] = useState('')
  const [montoDivisa, setMontoDivisa] = useState('')
  const [tasaDivisa, setTasaDivisa] = useState('')
  const [ref2, setRef2] = useState('')
  const [aplicaPagoMovil, setAplicaPagoMovil] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-llenado por imágenes
  const [files, setFiles] = useState<File[]>([])
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [detected, setDetected] = useState<ExtractedFields | null>(null)

  useEffect(() => {
    setAplicaPagoMovil(category === 'VENTA')
  }, [category])

  function reset() {
    setCategory('VENTA')
    setDate(todayISO())
    setClientName('')
    setDescription('')
    setAccountId('')
    setDestAccountId('')
    setPartnerId('')
    setMontoUsdt('')
    setTasaUsdt('')
    setRef('')
    setMontoDivisa('')
    setTasaDivisa('')
    setRef2('')
    setAplicaPagoMovil(true)
    setError(null)
    setFiles([])
    setDetected(null)
    setExtractError(null)
    setExtracting(false)
  }

  useEffect(() => {
    if (!open) return
    if (editing) {
      setCategory(editing.category)
      setDate(editing.date)
      setClientName(editing.client?.name ?? '')
      setDescription(editing.description ?? '')
      setAccountId(editing.account_id ?? '')
      setDestAccountId(editing.destination_account_id ?? '')
      setPartnerId(editing.partner_id ?? '')
      setMontoUsdt(editing.monto_usdt != null ? String(editing.monto_usdt) : '')
      setTasaUsdt(editing.tasa_usdt != null ? String(editing.tasa_usdt) : '')
      setRef(editing.ref ?? '')
      setMontoDivisa(
        editing.monto_divisa != null ? String(editing.monto_divisa) : ''
      )
      setTasaDivisa(
        editing.tasa_divisa != null ? String(editing.tasa_divisa) : ''
      )
      setRef2(editing.ref2 ?? '')
      setAplicaPagoMovil(editing.aplica_pago_movil)
      setError(null)
      setFiles([])
      setDetected(null)
      setExtractError(null)
    } else {
      reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing])

  async function onExtract() {
    if (files.length === 0) return
    setExtracting(true)
    setExtractError(null)
    try {
      const result = await extractFromImages(files)
      setDetected(result)
      if (result.monto_usdt != null) setMontoUsdt(String(result.monto_usdt))
      if (result.tasa_usdt != null) setTasaUsdt(String(result.tasa_usdt))
      if (result.ref) setRef(result.ref)
      if (result.ref2) setRef2(result.ref2)
      if (result.cliente_nombre && !clientName.trim()) {
        setClientName(result.cliente_nombre)
      }
    } catch (e) {
      setExtractError(e instanceof Error ? e.message : String(e))
    } finally {
      setExtracting(false)
    }
  }

  const preview = useMemo(() => {
    if (category !== 'VENTA') return null
    const mU = parseNumber(montoUsdt)
    const tU = parseNumber(tasaUsdt)
    const mD = parseNumber(montoDivisa)
    const tD = parseNumber(tasaDivisa)
    if (mU == null || mD == null) return null

    const cambioUsdtBs = (mU ?? 0) * (tU ?? 0)
    const cambioDivisaBs = (mD ?? 0) * (tD ?? 0)
    const difBs = cambioUsdtBs - cambioDivisaBs
    const pagoMovilBs = aplicaPagoMovil ? cambioUsdtBs * PAGO_MOVIL_RATE : 0
    const difBsNeto = difBs - pagoMovilBs

    const difUsd = mD - mU
    const binanceUsd = BINANCE_FEE_USD
    const pagoMovilUsd = aplicaPagoMovil ? mU * PAGO_MOVIL_RATE : 0
    const difUsdNeto = difUsd - binanceUsd - pagoMovilUsd

    const margenPct = mD > 0 ? (difUsd / mD) * 100 : null

    return {
      cambioUsdtBs,
      cambioDivisaBs,
      difBs,
      pagoMovilBs,
      difBsNeto,
      difUsd,
      binanceUsd,
      pagoMovilUsd,
      difUsdNeto,
      margenPct,
    }
  }, [category, montoUsdt, tasaUsdt, montoDivisa, tasaDivisa, aplicaPagoMovil])

  async function submit() {
    setSaving(true)
    setError(null)

    try {
      let clientId: string | null = null
      if (category === 'VENTA' && clientName.trim()) {
        const c = await upsertByName(clientName)
        clientId = c?.id ?? null
      }

      const payload: Record<string, unknown> = {
        date,
        category,
        description: description.trim() || null,
        client_id: clientId,
        account_id: accountId || null,
        destination_account_id:
          category === 'CAMBIO' ? destAccountId || null : null,
        partner_id: category === 'PAGO' ? partnerId || null : null,
        monto_usdt: parseNumber(montoUsdt),
        tasa_usdt: parseNumber(tasaUsdt),
        ref: ref.trim() || null,
        monto_divisa: parseNumber(montoDivisa),
        tasa_divisa: parseNumber(tasaDivisa),
        ref2: ref2.trim() || null,
        aplica_pago_movil: category === 'VENTA' ? aplicaPagoMovil : false,
        comision_binance_usd: category === 'VENTA' ? BINANCE_FEE_USD : 0,
      }

      if (!payload.account_id) throw new Error('Selecciona la cuenta')
      if (category === 'CAMBIO' && !payload.destination_account_id)
        throw new Error('Selecciona la cuenta destino del cambio')
      if (
        category === 'CAMBIO' &&
        payload.account_id === payload.destination_account_id
      )
        throw new Error('La cuenta origen y destino deben ser distintas')
      if (category === 'PAGO' && !payload.partner_id)
        throw new Error('Selecciona el socio que cobra')
      if (!editing && category === 'VENTA') {
        if (payload.monto_usdt == null) throw new Error('Falta Monto USDT')
        if (payload.monto_divisa == null) throw new Error('Falta Monto Divisa ($)')
      }
      if (
        ['CAMBIO', 'PAGO', 'AJUSTE+', 'AJUSTE-'].includes(category) &&
        payload.monto_usdt == null &&
        payload.monto_divisa == null
      ) {
        throw new Error('Falta el monto')
      }

      const { error } = editing
        ? await supabase
            .from('transactions')
            .update(payload)
            .eq('id', editing.id)
        : await supabase.from('transactions').insert(payload)
      if (error) throw error

      if (!editing) reset()
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    submit()
  }

  const isAjuste = category === 'AJUSTE+' || category === 'AJUSTE-'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Editar transacción' : 'Nueva transacción'}
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving}
            onClick={submit}
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      <form onSubmit={onSubmit}>
        {/* Segmented control de categoría */}
        <div className="cw-seg" style={{ marginBottom: 18 }}>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              className={category === c ? 'is-active' : ''}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Fecha + Cliente / Descripción */}
        <div className="form-grid-2" style={{ marginBottom: 14 }}>
          <div>
            <label className="input-lbl">Fecha</label>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input"
            />
          </div>

          {category === 'VENTA' ? (
            <div>
              <label className="input-lbl">Cliente</label>
              <ClientCombobox
                value={clientName}
                onChange={setClientName}
                clients={clients}
                required={!editing}
                onCreate={(n) => {
                  upsertByName(n)
                  setClientName(n)
                }}
              />
            </div>
          ) : (
            <div>
              <label className="input-lbl">Descripción</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="input"
                placeholder="ej. VITO CAMBIO ZELLE A USDT"
              />
            </div>
          )}
        </div>

        {/* Cuentas / Socio */}
        {(() => {
          const hasSecond = category === 'CAMBIO' || category === 'PAGO'
          return (
            <div className="form-grid-2" style={{ marginBottom: 16 }}>
              <div style={hasSecond ? undefined : { gridColumn: '1 / -1' }}>
                <label className="input-lbl">
                  {category === 'CAMBIO' ? 'Cuenta origen' : 'Cuenta'}
                </label>
                <select
                  required={!editing}
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="select"
                >
                  <option value="">—</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>

              {category === 'CAMBIO' && (
                <div>
                  <label className="input-lbl">Cuenta destino</label>
                  <select
                    required
                    value={destAccountId}
                    onChange={(e) => setDestAccountId(e.target.value)}
                    className="select"
                  >
                    <option value="">—</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {category === 'PAGO' && (
                <div>
                  <label className="input-lbl">Socio que cobra</label>
                  <select
                    required
                    value={partnerId}
                    onChange={(e) => setPartnerId(e.target.value)}
                    className="select"
                  >
                    <option value="">—</option>
                    {partners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )
        })()}

        {/* Bloque VENTA: extractor + grids */}
        {category === 'VENTA' && (
          <>
            {!editing && (
              <div
                className="auto-fill-banner"
                style={{
                  background: 'var(--color-canvas-dark)',
                  border: '1px dashed var(--color-hairline-on-dark)',
                  borderRadius: 8,
                  padding: '12px 14px',
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <Icon
                  name="image"
                  size={18}
                  style={{ color: 'var(--color-primary)' }}
                />
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div
                    style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}
                  >
                    Auto-llenar con capturas
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                    Sube la captura de Binance y/o del pago móvil — los campos
                    se rellenan solos.
                  </div>
                </div>
                <label
                  className="btn btn-secondary"
                  style={{ cursor: 'pointer' }}
                >
                  <Icon name="upload" size={14} />{' '}
                  {files.length > 0
                    ? `${files.length} archivo(s)`
                    : 'Seleccionar'}
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      setFiles(Array.from(e.target.files ?? []))
                      setDetected(null)
                      setExtractError(null)
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={files.length === 0 || extracting}
                  onClick={onExtract}
                >
                  {extracting ? 'Procesando…' : 'Procesar'}
                </button>
              </div>
            )}

            {extractError && (
              <div
                className="cw-banner"
                style={{
                  borderLeftColor: 'var(--color-trading-down)',
                  color: 'var(--color-trading-down)',
                }}
              >
                {extractError}
              </div>
            )}

            {detected && (
              <div className="cw-banner">
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Detectado</div>
                <div className="form-grid-3" style={{ gap: '4px 16px' }}>
                  {detected.monto_usdt != null && (
                    <Detected label="USDT" value={String(detected.monto_usdt)} />
                  )}
                  {detected.tasa_usdt != null && (
                    <Detected
                      label="Tasa USDT"
                      value={String(detected.tasa_usdt)}
                    />
                  )}
                  {detected.ref && (
                    <Detected label="Ref Binance" value={detected.ref} />
                  )}
                  {detected.ref2 && (
                    <Detected label="Ref pago móvil" value={detected.ref2} />
                  )}
                  {detected.cliente_nombre && (
                    <Detected
                      label="Cliente"
                      value={detected.cliente_nombre}
                    />
                  )}
                </div>
                {detected.monto_divisa_bs != null && (
                  <div
                    style={{
                      marginTop: 8,
                      color: 'var(--color-primary)',
                      fontSize: 12,
                    }}
                  >
                    Total Bs detectado:{' '}
                    <strong>{fmtBs(detected.monto_divisa_bs)}</strong> — ingresa
                    la tasa que cobraste y calcula el monto $.
                  </div>
                )}
              </div>
            )}

            <div className="form-grid-3" style={{ marginBottom: 12 }}>
              <div>
                <label className="input-lbl">Monto USDT</label>
                <input
                  className="input"
                  required={!editing}
                  inputMode="decimal"
                  placeholder="ej. 9.4"
                  value={montoUsdt}
                  onChange={(e) => setMontoUsdt(e.target.value)}
                />
                <span className="field-hint">Lado Binance</span>
              </div>
              <div>
                <label className="input-lbl">Tasa USDT (Bs)</label>
                <input
                  className="input"
                  inputMode="decimal"
                  placeholder="ej. 617"
                  value={tasaUsdt}
                  onChange={(e) => setTasaUsdt(e.target.value)}
                />
                <span className="field-hint">Tasa en Binance</span>
              </div>
              <div>
                <label className="input-lbl">Ref</label>
                <input
                  className="input"
                  placeholder="ej. 6048"
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                />
                <span className="field-hint">Últimos 4 dígitos</span>
              </div>
            </div>

            <div className="form-grid-3" style={{ marginBottom: 16 }}>
              <div>
                <label className="input-lbl">Monto Divisa ($)</label>
                <input
                  className="input"
                  required={!editing}
                  inputMode="decimal"
                  placeholder="ej. 10"
                  value={montoDivisa}
                  onChange={(e) => setMontoDivisa(e.target.value)}
                />
                <span className="field-hint">Lado cuenta / cliente</span>
              </div>
              <div>
                <label className="input-lbl">Tasa Divisa (Bs)</label>
                <input
                  className="input"
                  inputMode="decimal"
                  placeholder="ej. 590"
                  value={tasaDivisa}
                  onChange={(e) => setTasaDivisa(e.target.value)}
                />
                <span className="field-hint">Tasa cobrada / pagada</span>
              </div>
              <div>
                <label className="input-lbl">Ref 2</label>
                <input
                  className="input"
                  value={ref2}
                  onChange={(e) => setRef2(e.target.value)}
                />
              </div>
            </div>

            <label className="cw-check" style={{ marginBottom: 16 }}>
              <input
                type="checkbox"
                checked={aplicaPagoMovil}
                onChange={(e) => setAplicaPagoMovil(e.target.checked)}
              />
              <span className="box"></span>
              <span>Aplica comisión de pago móvil (0.3% sobre el cambio en Bs)</span>
            </label>

            {preview && (
              <div className="cw-card" style={{ padding: 16 }}>
                <div className="form-grid-2" style={{ gap: 24 }}>
                  <div>
                    <div className="cw-acct-label" style={{ marginBottom: 8 }}>
                      Lado dólar
                    </div>
                    <Line
                      label="DIF $ (bruto)"
                      value={fmtUSD(preview.difUsd)}
                      tone={preview.difUsd >= 0 ? 'up' : 'down'}
                    />
                    <Line
                      label="Comisión Binance"
                      value={`− ${fmtUSD(preview.binanceUsd)}`}
                      muted
                    />
                    {aplicaPagoMovil && (
                      <Line
                        label="Pago móvil ($)"
                        value={`− ${fmtUSD(preview.pagoMovilUsd)}`}
                        muted
                      />
                    )}
                    <Line
                      label="Neto $"
                      value={fmtUSD(preview.difUsdNeto)}
                      tone={preview.difUsdNeto >= 0 ? 'up' : 'down'}
                      bold
                    />
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: 11,
                        color: 'var(--color-muted)',
                      }}
                    >
                      Margen bruto:{' '}
                      <strong style={{ color: '#fff' }}>
                        {preview.margenPct != null
                          ? `${preview.margenPct.toFixed(2)}%`
                          : '—'}
                      </strong>
                    </div>
                  </div>
                  <div>
                    <div className="cw-acct-label" style={{ marginBottom: 8 }}>
                      Lado bolívar
                    </div>
                    <Line
                      label="Cambio USDT"
                      value={fmtBs(preview.cambioUsdtBs)}
                      muted
                    />
                    <Line
                      label="Cambio Divisa"
                      value={fmtBs(preview.cambioDivisaBs)}
                      muted
                    />
                    <Line
                      label="DIF Bs"
                      value={fmtBs(preview.difBs)}
                      tone={preview.difBs >= 0 ? 'up' : 'down'}
                    />
                    {aplicaPagoMovil && (
                      <Line
                        label="Pago móvil (Bs)"
                        value={`− ${fmtBs(preview.pagoMovilBs)}`}
                        muted
                      />
                    )}
                    <Line
                      label="Neto Bs"
                      value={fmtBs(preview.difBsNeto)}
                      tone={preview.difBsNeto >= 0 ? 'up' : 'down'}
                      bold
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* CAMBIO / PAGO / AJUSTE± */}
        {(category === 'CAMBIO' ||
          category === 'PAGO' ||
          isAjuste) && (
          <div className="form-grid-2">
            <div style={category === 'CAMBIO' ? undefined : { gridColumn: '1 / -1' }}>
              <label className="input-lbl">
                Monto ({isAjuste
                  ? category === 'AJUSTE+'
                    ? 'ingreso'
                    : 'egreso'
                  : '$'}
                )
              </label>
              <input
                className="input"
                inputMode="decimal"
                placeholder="ej. 245"
                value={montoDivisa}
                onChange={(e) => setMontoDivisa(e.target.value)}
              />
            </div>
            {category === 'CAMBIO' && (
              <div>
                <label className="input-lbl">Monto USDT (si aplica)</label>
                <input
                  className="input"
                  inputMode="decimal"
                  value={montoUsdt}
                  onChange={(e) => setMontoUsdt(e.target.value)}
                />
                <span className="field-hint">
                  Dejar vacío si no toca Binance
                </span>
              </div>
            )}
          </div>
        )}

        {error && (
          <div
            className="cw-banner"
            style={{
              marginTop: 16,
              marginBottom: 0,
              borderLeftColor: 'var(--color-trading-down)',
              color: 'var(--color-trading-down)',
            }}
          >
            {error}
          </div>
        )}
      </form>
    </Modal>
  )
}

function Detected({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span style={{ color: 'var(--color-muted)', fontSize: 11 }}>{label}:</span>{' '}
      <span style={{ color: '#fff', fontWeight: 600, fontSize: 12 }}>{value}</span>
    </div>
  )
}

function Line({
  label,
  value,
  bold = false,
  muted = false,
  tone,
}: {
  label: string
  value: ReactNode
  bold?: boolean
  muted?: boolean
  tone?: 'up' | 'down'
}) {
  const color =
    tone === 'up'
      ? 'var(--color-trading-up)'
      : tone === 'down'
        ? 'var(--color-trading-down)'
        : muted
          ? 'var(--color-muted)'
          : 'var(--color-body)'
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 12,
        padding: '4px 0',
        fontSize: 13,
      }}
    >
      <span style={{ color: 'var(--color-muted)' }}>{label}</span>
      <span
        className="cw-num"
        style={{ color, fontWeight: bold ? 700 : 500 }}
      >
        {value}
      </span>
    </div>
  )
}
