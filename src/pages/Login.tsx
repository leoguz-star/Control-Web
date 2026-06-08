import { FormEvent, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { loginIdToEmail } from '@/lib/socio'

export default function Login() {
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    // Socios entran por nombre; admins por email. loginIdToEmail resuelve ambos.
    const email = loginIdToEmail(userId)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) setError('Usuario o contraseña incorrectos')
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'var(--color-canvas-dark)',
      }}
    >
      <form
        onSubmit={onSubmit}
        className="cw-card"
        style={{ width: '100%', maxWidth: 380 }}
      >
        <div
          className="cw-brand"
          style={{ marginBottom: 18, fontSize: 18, color: '#fff' }}
        >
          <div className="cw-brand-mark">C</div>
          <span>Control</span>
        </div>
        <p
          className="cw-page-sub"
          style={{ marginBottom: 22, marginTop: -10 }}
        >
          Ingresa con tu cuenta.
        </p>

        <div style={{ marginBottom: 14 }}>
          <label className="input-lbl">Usuario</label>
          <input
            type="text"
            required
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="Tu nombre"
            className="input"
          />
        </div>

        <div style={{ marginBottom: 18 }}>
          <label className="input-lbl">Contraseña</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
          />
        </div>

        {error && (
          <div className="cw-banner" style={{ borderLeftColor: 'var(--color-trading-down)', color: 'var(--color-trading-down)' }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn btn-primary"
          style={{ width: '100%', height: 40 }}
        >
          {loading ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </div>
  )
}
