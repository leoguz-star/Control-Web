import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import AuditList from '@/components/AuditList'
import { useIsAdmin } from '@/hooks/useIsAdmin'
import type { AuditLogEntry } from '@/types/database'

interface SocioOpt {
  id: string
  name: string
}

export default function Auditoria() {
  const isAdmin = useIsAdmin()
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [socios, setSocios] = useState<SocioOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [fSocio, setFSocio] = useState<string>('') // '', 'casa', o partner_id
  const [fAccion, setFAccion] = useState<string>('')

  useEffect(() => {
    if (isAdmin !== true) return
    supabase
      .from('partners')
      .select('id, name')
      .eq('role', 'SOCIO')
      .order('name')
      .then(({ data }) => {
        if (data) setSocios(data as SocioOpt[])
      })
  }, [isAdmin])

  useEffect(() => {
    if (isAdmin !== true) return
    let mounted = true
    async function load() {
      setLoading(true)
      let q = supabase.from('audit_log_view').select('*').limit(300)
      if (fSocio === 'casa') q = q.is('owner_partner_id', null)
      else if (fSocio) q = q.eq('owner_partner_id', fSocio)
      if (fAccion) q = q.eq('action', fAccion)
      const { data } = await q
      if (!mounted) return
      if (data) setEntries(data as AuditLogEntry[])
      setLoading(false)
    }
    load()
    return () => {
      mounted = false
    }
  }, [isAdmin, fSocio, fAccion])

  if (isAdmin === null) {
    return (
      <div className="cw-page" style={{ color: 'var(--color-muted)' }}>
        Cargando…
      </div>
    )
  }
  if (isAdmin === false) return <Navigate to="/" replace />

  return (
    <div className="cw-page">
      <div className="cw-page-head">
        <div>
          <h1 className="cw-page-title">Auditoría</h1>
          <div className="cw-page-sub">
            Quién creó, editó o eliminó qué, y cuándo
          </div>
        </div>
      </div>

      <div className="cw-filters" style={{ marginBottom: 16 }}>
        <div>
          <label className="input-lbl">Caja</label>
          <select
            className="input"
            value={fSocio}
            onChange={(e) => setFSocio(e.target.value)}
          >
            <option value="">Todas</option>
            <option value="casa">Casa (admins)</option>
            {socios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="input-lbl">Acción</label>
          <select
            className="input"
            value={fAccion}
            onChange={(e) => setFAccion(e.target.value)}
          >
            <option value="">Todas</option>
            <option value="INSERT">Creó</option>
            <option value="UPDATE">Editó</option>
            <option value="DELETE">Eliminó</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="cw-card" style={{ color: 'var(--color-muted)' }}>
          Cargando…
        </div>
      ) : entries.length === 0 ? (
        <div className="cw-empty">
          <h3>Sin actividad</h3>
          <div>No hay movimientos para estos filtros.</div>
        </div>
      ) : (
        <AuditList entries={entries} />
      )}
    </div>
  )
}
