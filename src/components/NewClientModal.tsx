import { FormEvent, useState } from 'react'
import Modal from './Modal'
import { useClients } from '@/hooks/useClients'

interface Props {
  open: boolean
  onClose: () => void
  onSaved?: () => void
}

export default function NewClientModal({ open, onClose, onSaved }: Props) {
  const { upsertByName } = useClients()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Escribe un nombre')
      return
    }
    setSaving(true)
    setError(null)
    const c = await upsertByName(trimmed)
    setSaving(false)
    if (!c) {
      setError('No se pudo guardar el cliente')
      return
    }
    setName('')
    onSaved?.()
    onClose()
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    submit()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nuevo cliente"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!name.trim() || saving}
            onClick={submit}
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      <form onSubmit={onSubmit}>
        <label className="input-lbl">Nombre</label>
        <input
          autoFocus
          className="input"
          placeholder="ej. Juan Pérez"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <span className="field-hint">
          Se añadirá al autocompletar al crear ventas.
        </span>

        {error && (
          <div
            className="cw-banner"
            style={{
              marginTop: 12,
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
