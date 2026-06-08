import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useIsAdmin } from '@/hooks/useIsAdmin'
import { useCurrentPartner } from '@/hooks/useCurrentPartner'
import Icon from './Icon'

export default function Layout() {
  const { user } = useAuth()
  const isAdmin = useIsAdmin()
  const partner = useCurrentPartner()
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  // Nombre del socio/admin; cae al email si aún no está vinculado.
  const displayName = partner?.name ?? user?.email ?? ''

  // "Cajas de socios" y "Configuración" solo para admins.
  const tabs = [
    { to: '/', label: 'Dashboard', end: true },
    { to: '/transacciones', label: 'Transacciones' },
    ...(isAdmin
      ? [
          { to: '/cajas', label: 'Cajas de socios' },
          { to: '/auditoria', label: 'Auditoría' },
          { to: '/configuracion', label: 'Configuración' },
        ]
      : []),
    { to: '/chatbot', label: 'Asistente' },
  ]

  // Cierra el drawer al navegar (cuando el path cambia)
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  // Esc cierra
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  // Bloquea scroll del body cuando el drawer está abierto
  useEffect(() => {
    if (!menuOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [menuOpen])

  return (
    <>
      <nav className="cw-nav">
        <button
          className="cw-hamburger"
          onClick={() => setMenuOpen(true)}
          aria-label="Abrir menú"
        >
          <span></span>
          <span></span>
          <span></span>
        </button>

        <Link to="/" className="cw-brand" aria-label="Ir al dashboard">
          <div className="cw-brand-mark">C</div>
          <span>Control</span>
        </Link>

        <div className="cw-nav-tabs">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `cw-nav-tab${isActive ? ' is-active' : ''}`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </div>

        <div className="cw-nav-right">
          <Icon name="bell" size={18} style={{ cursor: 'pointer' }} />
          {displayName && <span className="user">{displayName}</span>}
          <span className="logout" onClick={() => supabase.auth.signOut()}>
            Salir
          </span>
        </div>
      </nav>

      {menuOpen && (
        <div className="cw-drawer-scrim" onClick={() => setMenuOpen(false)}>
          <aside
            className="cw-drawer"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Menú"
          >
            <div className="cw-drawer-head">
              <Link to="/" className="cw-brand" aria-label="Ir al dashboard">
                <div className="cw-brand-mark">C</div>
                <span>Control</span>
              </Link>
              <button
                className="cw-modal-close"
                onClick={() => setMenuOpen(false)}
                aria-label="Cerrar menú"
              >
                <Icon name="x" size={16} />
              </button>
            </div>

            <div className="cw-drawer-tabs">
              {tabs.map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  end={t.end}
                  className={({ isActive }) =>
                    `cw-drawer-tab${isActive ? ' is-active' : ''}`
                  }
                >
                  {t.label}
                </NavLink>
              ))}
            </div>

            <div className="cw-drawer-foot">
              {displayName && (
                <div className="cw-drawer-user">{displayName}</div>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                style={{ width: '100%' }}
                onClick={() => {
                  setMenuOpen(false)
                  supabase.auth.signOut()
                }}
              >
                Salir
              </button>
            </div>
          </aside>
        </div>
      )}

      <main>
        <Outlet />
      </main>
    </>
  )
}
