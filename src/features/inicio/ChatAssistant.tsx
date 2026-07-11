import { useEffect, useRef, useState } from 'react'
import { complete, hasApiKey, type ChatMessage } from '../../lib/claude'
import { MdRender } from './md'

interface Props {
  feriaOptions: { v: string; label: string }[]
  // Builds the system prompt (CRM data + normativa text) for the given scope.
  buildContext: (scopeFeriaId: string) => Promise<string>
}

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

export default function ChatAssistant({ feriaOptions, buildContext }: Props) {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [feria, setFeria] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const scroll = () => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }
  useEffect(() => {
    if (open) scroll()
  }, [open, msgs, busy])

  const send = async () => {
    const q = input.trim()
    if (!q || busy) return
    if (!hasApiKey()) {
      setMsgs((m) => [
        ...m,
        { role: 'user', content: q },
        {
          role: 'assistant',
          content: 'El asistente de IA no está disponible en este entorno.',
        },
      ])
      setInput('')
      return
    }
    const next: Msg[] = [...msgs, { role: 'user', content: q }]
    setMsgs(next)
    setInput('')
    setBusy(true)
    try {
      const sys = await buildContext(feria)
      const res = await complete({
        system: sys,
        messages: next.slice(-12) as ChatMessage[],
        maxTokens: 1500,
      })
      setMsgs([...next, { role: 'assistant', content: String(res) }])
    } catch (e: any) {
      setMsgs([...next, { role: 'assistant', content: 'No he podido responder: ' + e.message }])
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Asistente con acceso a proyectos, clientes, ferias y normativa"
        style={{
          position: 'fixed',
          right: 22,
          bottom: 22,
          border: 'none',
          background: '#17161A',
          color: '#fff',
          borderRadius: 999,
          padding: '13px 19px',
          fontSize: 13,
          fontWeight: 700,
          cursor: 'pointer',
          boxShadow: '0 14px 34px rgba(23,22,26,0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          zIndex: 50,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="#D6197E" style={{ flex: 'none' }}>
          <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2z" />
        </svg>
        <span>Asistente</span>
      </button>
    )
  }

  return (
    <div
      style={{
        position: 'fixed',
        right: 22,
        bottom: 22,
        width: 410,
        maxWidth: 'calc(100vw - 44px)',
        height: 'min(600px,calc(100vh - 60px))',
        background: '#fff',
        border: '1px solid #E0DED8',
        borderRadius: 16,
        boxShadow: '0 30px 70px rgba(23,22,26,0.25)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 50,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '13px 15px',
          borderBottom: '1px solid #ECEAE5',
          background: '#17161A',
          color: '#fff',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="#D6197E" style={{ flex: 'none' }}>
          <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2z" />
        </svg>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Asistente Ready</div>
          <div
            style={{
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: 8.5,
              color: 'rgba(255,255,255,0.55)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            Proyectos · clientes · ferias · normativa
          </div>
        </div>
        <select
          value={feria}
          onChange={(e) => setFeria(e.target.value)}
          title="Ámbito de la documentación"
          style={{
            maxWidth: 130,
            padding: '5px 6px',
            border: '1px solid #3A3840',
            borderRadius: 6,
            fontSize: 10.5,
            background: '#26252A',
            color: '#fff',
            outline: 'none',
          }}
        >
          <option value="">Todas las ferias</option>
          {feriaOptions.map((fo) => (
            <option key={fo.v} value={fo.v}>
              {fo.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => setOpen(false)}
          style={{
            border: 'none',
            background: 'none',
            color: 'rgba(255,255,255,0.7)',
            fontSize: 16,
            cursor: 'pointer',
            padding: '0 3px',
          }}
        >
          ×
        </button>
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          background: '#FAF9F7',
        }}
      >
        {msgs.length === 0 && (
          <div style={{ fontSize: 12, color: '#8A867F', lineHeight: 1.7, padding: '6px 4px' }}>
            Pregúntame lo que quieras: normativa de una feria, alturas máximas, plazos de montaje,
            contactos, estado de proyectos…
            <br />
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10 }}>
              «¿Cuál es la altura máxima de construcción en Fitur?»
            </span>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div
              style={{
                maxWidth: '85%',
                padding: '9px 12px',
                borderRadius: m.role === 'user' ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                background: m.role === 'user' ? '#17161A' : '#FFFFFF',
                color: m.role === 'user' ? '#FFFFFF' : '#17161A',
                fontSize: 12.5,
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
                border: `1px solid ${m.role === 'user' ? '#17161A' : '#E0DED8'}`,
              }}
            >
              {m.role === 'assistant' ? <MdRender text={m.content} /> : m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#8A867F', fontSize: 11.5, padding: '2px 4px' }}
          >
            <span
              style={{
                width: 11,
                height: 11,
                border: '2px solid rgba(214,25,126,0.3)',
                borderTopColor: '#D6197E',
                borderRadius: '50%',
                display: 'inline-block',
                animation: 'crmspin 0.8s linear infinite',
              }}
            />
            <span>Consultando la documentación…</span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 7, padding: 11, borderTop: '1px solid #ECEAE5', background: '#fff' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="Escribe tu pregunta…"
          style={{
            flex: 1,
            minWidth: 0,
            padding: '10px 12px',
            border: '1px solid #DCD9D2',
            borderRadius: 9,
            fontSize: 12.5,
            background: '#FDFDFC',
            color: '#17161A',
            outline: 'none',
          }}
        />
        <button
          onClick={send}
          style={{
            border: 'none',
            background: '#D6197E',
            color: '#fff',
            borderRadius: 9,
            padding: '0 16px',
            fontSize: 12.5,
            fontWeight: 700,
            cursor: 'pointer',
            flex: 'none',
          }}
        >
          Enviar
        </button>
      </div>
    </div>
  )
}
