import { useState, useRef, useEffect, FormEvent } from 'react'
import { supabase } from '@/lib/supabase'

interface Message {
  role: 'user' | 'assistant'
  text: string
}

const SUGGESTIONS = [
  '¿Qué puedo consultar?',
  '¿Quiénes me deben dinero?',
  '¿Cómo están los saldos?',
  'Resumen de este mes',
]

export default function Chatbot() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: 'Hola! Puedo consultarte información sobre clientes, saldos, ventas, comisiones y más. ¿Qué necesitas saber?',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function send(pregunta: string) {
    pregunta = pregunta.trim()
    if (!pregunta || loading) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: pregunta }])
    setLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('chat-query', {
        body: { pregunta },
      })
      if (error) {
        const detail = (error as { message?: string }).message ?? JSON.stringify(error)
        throw new Error(detail)
      }
      setMessages((m) => [...m, { role: 'assistant', text: data.respuesta }])
    } catch (err) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err)
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: `Error: ${msg}` },
      ])
    } finally {
      setLoading(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    send(input)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 64px)',
        maxWidth: 720,
        margin: '0 auto',
        padding: '24px 16px 16px',
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-body)' }}>Asistente</div>
        <div style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 2 }}>
          Consulta información de la base de datos en lenguaje natural
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          paddingBottom: 8,
        }}
      >
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                maxWidth: '78%',
                padding: '10px 14px',
                borderRadius:
                  m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                background:
                  m.role === 'user' ? 'var(--color-primary)' : 'var(--color-surface-card-dark)',
                color:
                  m.role === 'user' ? 'var(--color-body-on-light)' : 'var(--color-body)',
                fontSize: 14,
                lineHeight: 1.65,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {m.text}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '16px 16px 16px 4px',
                background: 'var(--color-surface-card-dark)',
                color: 'var(--color-muted)',
                fontSize: 14,
              }}
            >
              Consultando…
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {messages.length === 1 && !loading && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              style={{
                padding: '6px 12px',
                borderRadius: 20,
                border: '1px solid var(--color-hairline-on-dark)',
                background: 'transparent',
                color: 'var(--color-muted-strong)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8, paddingTop: 8 }}>
        <input
          type="text"
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribe tu consulta..."
          disabled={loading}
          style={{ flex: 1 }}
          autoFocus
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading || !input.trim()}
        >
          Enviar
        </button>
      </form>
    </div>
  )
}
