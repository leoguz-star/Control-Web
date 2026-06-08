import { FormEvent, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useIsAdmin } from '@/hooks/useIsAdmin'

interface SocioRow {
  id: string
  name: string
  commission_share: number
}
interface AccountRow {
  id: string
  name: string
  currency: string
  sort_order: number
  is_active: boolean
  owner_partner_id: string
}

export default function Configuracion() {
  const isAdmin = useIsAdmin()
  const [socios, setSocios] = useState<SocioRow[]>([])
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [loading, setLoading] = useState(true)

  // Formulario de alta
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [pct, setPct] = useState('40')
  const [saving, setSaving] = useState(false)
  const [formMsg, setFormMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function load() {
    const [s, a] = await Promise.all([
      supabase
        .from('partners')
        .select('id, name, commission_share')
        .eq('role', 'SOCIO')
        .order('name'),
      supabase
        .from('accounts')
        .select('id, name, currency, sort_order, is_active, owner_partner_id')
        .not('owner_partner_id', 'is', null)
        .order('sort_order'),
    ])
    if (s.data) setSocios(s.data as SocioRow[])
    if (a.data) setAccounts(a.data as AccountRow[])
    setLoading(false)
  }

  useEffect(() => {
    if (isAdmin === true) load()
  }, [isAdmin])

  if (isAdmin === null) {
    return (
      <div className="cw-page" style={{ color: 'var(--color-muted)' }}>
        Cargando…
      </div>
    )
  }
  if (isAdmin === false) return <Navigate to="/" replace />

  async function crearSocio(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormMsg(null)
    const commission_share = Math.max(0, Math.min(100, Number(pct) || 0)) / 100
    const { data, error } = await supabase.functions.invoke('create-socio', {
      body: { name: name.trim(), password, commission_share },
    })
    setSaving(false)
    if (error || data?.error) {
      setFormMsg({ ok: false, text: data?.error ?? error?.message ?? 'Error al crear el socio' })
      return
    }
    setFormMsg({ ok: true, text: `Socio "${name.trim()}" creado.` })
    setName('')
    setPassword('')
    setPct('40')
    load()
  }

  async function toggleCuenta(acc: AccountRow) {
    // Optimista
    setAccounts((prev) =>
      prev.map((a) => (a.id === acc.id ? { ...a, is_active: !a.is_active } : a)),
    )
    const { error } = await supabase
      .from('accounts')
      .update({ is_active: !acc.is_active })
      .eq('id', acc.id)
    if (error) load() // revertir si falló
  }

  const cuentasDe = (socioId: string) =>
    accounts.filter((a) => a.owner_partner_id === socioId)

  return (
    <div className="cw-page">
      <div className="cw-page-head">
        <div>
          <h1 className="cw-page-title">Configuración</h1>
          <div className="cw-page-sub">Socios y sus cuentas</div>
        </div>
      </div>

      {/* Crear socio */}
      <section className="cw-section">
        <div className="cw-section-head">
          <div>
            <div className="cw-section-title">Crear socio</div>
            <div className="cw-section-sub">
              El socio entra con su nombre y contraseña (sin email).
            </div>
          </div>
        </div>

        <form className="cw-card" onSubmit={crearSocio}>
          <div className="form-grid-3" style={{ gap: '14px 16px' }}>
            <div>
              <label className="input-lbl">Nombre del socio</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ej. PEDRO"
                required
              />
            </div>
            <div>
              <label className="input-lbl">Contraseña</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="mín. 6 caracteres"
                required
              />
            </div>
            <div>
              <label className="input-lbl">% comisión del socio</label>
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                value={pct}
                onChange={(e) => setPct(e.target.value)}
              />
              <span className="field-hint">Vito se lleva el resto</span>
            </div>
          </div>

          {formMsg && (
            <div
              className="cw-banner"
              style={{
                marginTop: 14,
                borderLeftColor: formMsg.ok
                  ? 'var(--color-trading-up)'
                  : 'var(--color-trading-down)',
                color: formMsg.ok
                  ? 'var(--color-trading-up)'
                  : 'var(--color-trading-down)',
              }}
            >
              {formMsg.text}
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <button className="btn btn-primary" disabled={saving}>
              {saving ? 'Creando…' : 'Crear socio'}
            </button>
          </div>
        </form>
      </section>

      {/* Socios y cuentas */}
      <section className="cw-section">
        <div className="cw-section-head">
          <div>
            <div className="cw-section-title">Cuentas de los socios</div>
            <div className="cw-section-sub">
              Activa o desactiva cuentas. Las inactivas no cuentan en los saldos.
            </div>
          </div>
        </div>

        {loading ? (
          <div className="cw-card" style={{ color: 'var(--color-muted)' }}>
            Cargando…
          </div>
        ) : socios.length === 0 ? (
          <div className="cw-empty">
            <h3>Sin socios todavía</h3>
            <div>Crea uno arriba para empezar.</div>
          </div>
        ) : (
          socios.map((s) => (
            <div key={s.id} className="cw-card" style={{ marginBottom: 12 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: 12,
                }}
              >
                <strong style={{ color: '#fff' }}>{s.name}</strong>
                <span className="cw-muted">
                  {Math.round(Number(s.commission_share) * 100)}%
                </span>
              </div>
              <div className="cw-cfg-acct-list">
                {cuentasDe(s.id).map((a) => (
                  <div
                    key={a.id}
                    className={`cw-cfg-acct${a.is_active ? '' : ' is-off'}`}
                  >
                    <span className="cw-cfg-acct-name">{a.name}</span>
                    <button
                      type="button"
                      className={`cw-toggle${a.is_active ? ' on' : ''}`}
                      onClick={() => toggleCuenta(a)}
                      title={a.is_active ? 'Desactivar' : 'Activar'}
                    >
                      {a.is_active ? 'Activa' : 'Inactiva'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  )
}
