import { ReactNode, useEffect } from 'react'
import Icon from './Icon'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg'
}

export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="cw-scrim" onClick={onClose}>
      <div
        className={`cw-modal ${size === 'lg' ? 'lg' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="cw-modal-head">
          <h3 className="cw-modal-title">{title}</h3>
          <button
            className="cw-modal-close"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="cw-modal-body">{children}</div>
        {footer && <div className="cw-modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
