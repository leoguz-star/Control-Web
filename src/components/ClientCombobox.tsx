import { useEffect, useRef, useState } from 'react'
import type { Client } from '@/types/database'

interface Props {
  value: string
  onChange: (v: string) => void
  clients: Client[]
  required?: boolean
  placeholder?: string
  onCreate?: (name: string) => void
}

export default function ClientCombobox({
  value,
  onChange,
  clients,
  required,
  placeholder = 'Escribe o elige',
  onCreate,
}: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open])

  const term = value.trim().toLowerCase()
  const filtered = term
    ? clients.filter((c) => c.name.toLowerCase().includes(term))
    : clients
  const exact = clients.some((c) => c.name.toLowerCase() === term)

  return (
    <div className="cw-combo" ref={wrapRef}>
      <input
        className="input"
        required={required}
        value={value}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
        autoComplete="off"
      />
      {open && (
        <div className="cw-combo-list">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="cw-combo-item"
              onMouseDown={(e) => {
                e.preventDefault()
                onChange(c.name)
                setOpen(false)
              }}
            >
              {c.name}
            </div>
          ))}
          {value.trim() && !exact && onCreate && (
            <div
              className="cw-combo-item create"
              onMouseDown={(e) => {
                e.preventDefault()
                onCreate(value.trim())
                setOpen(false)
              }}
            >
              + Crear "{value.trim()}"
            </div>
          )}
          {filtered.length === 0 && (!value.trim() || exact) && (
            <div className="cw-combo-item cw-muted" style={{ cursor: 'default' }}>
              {value.trim() ? 'Coincidencia exacta' : 'Sin clientes guardados'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
