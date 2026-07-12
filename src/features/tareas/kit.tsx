// Kit compartido del sistema de colaboración (notas + tareas): hook de datos,
// avatares, texto con menciones resaltadas y editor con autocompletado de @.

import React, { useEffect, useRef, useState } from 'react'
import { KEYS, read, write, type Nota, type Tarea } from '../../lib/storage'
import { alias, avatarColor, fetchMiembros, inicial, miembrosCache, nombreCorto } from '../../lib/team'

export const SANS = "'Archivo','Helvetica Neue',Helvetica,sans-serif"
export const MONO = "'JetBrains Mono',monospace"
export const ACCENT = '#D6197E'
export const INK = '#17161A'

export const KIT_CSS = `
@keyframes tkFadeUp { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: none; } }
@keyframes tkPop { 0% { transform: scale(0.6); } 60% { transform: scale(1.15); } 100% { transform: scale(1); } }
@keyframes tkSlideIn { from { transform: translateX(100%); } to { transform: none; } }
@keyframes tkFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes tkDot { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.35); opacity: 0.7; } }
.tk-card { transition: box-shadow 0.15s ease, transform 0.15s ease, opacity 0.25s ease; }
.tk-card:hover { box-shadow: 0 8px 24px rgba(23,22,26,0.10); transform: translateY(-1px); }
.tk-check { transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease; }
.tk-check:hover { transform: scale(1.12); border-color: #D6197E !important; }
.tk-done-title { text-decoration: line-through; color: #8A867F !important; }
.tk-btn { transition: background 0.12s ease, transform 0.08s ease; }
.tk-btn:active { transform: scale(0.96); }
.tk-chip { transition: background 0.12s ease, border-color 0.12s ease; cursor: pointer; }
.tk-chip:hover { border-color: #D6197E !important; }
.tk-mention-item[data-sel="1"] { background: #FBF1F6; }
`

// ---- datos (localStorage como copia de trabajo; el motor de sync los espeja) ----
const CHANGED = 'ready-data-changed'
export function listNotas(): Nota[] { return read<{ list: Nota[] }>(KEYS.notas)?.list || [] }
export function saveNotas(next: Nota[]): void {
  write(KEYS.notas, { list: next })
  window.dispatchEvent(new Event(CHANGED))
}
export function listTareas(): Tarea[] { return read<{ list: Tarea[] }>(KEYS.tareas)?.list || [] }
export function saveTareas(next: Tarea[]): void {
  write(KEYS.tareas, { list: next })
  window.dispatchEvent(new Event(CHANGED))
}

/** Lista viva: se refresca cuando escribe este dispositivo o llega un cambio del compañero. */
export function useLista<T>(reader: () => T[]): [T[], () => void] {
  const [list, setList] = useState<T[]>(reader)
  const bump = () => setList(reader())
  useEffect(() => {
    const f = () => setList(reader())
    window.addEventListener(CHANGED, f)
    window.addEventListener('ready-sync-pulled', f)
    return () => {
      window.removeEventListener(CHANGED, f)
      window.removeEventListener('ready-sync-pulled', f)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return [list, bump]
}

/** Miembros del equipo (con caché para el primer render). */
export function useMiembros(): string[] {
  const [m, setM] = useState<string[]>(miembrosCache)
  useEffect(() => {
    let on = true
    fetchMiembros().then((list) => { if (on && list.length) setM(list) })
    return () => { on = false }
  }, [])
  return m
}

export function Avatar({ email, size = 24 }: { email: string; size?: number }) {
  return (
    <span
      title={email ? nombreCorto(email) + ' · ' + email : 'Sin asignar'}
      style={{
        width: size, height: size, borderRadius: '50%', flex: 'none',
        background: email ? avatarColor(email) : '#DCD9D2',
        color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.46, fontWeight: 800, fontFamily: SANS,
      }}
    >
      {email ? inicial(email) : '?'}
    </span>
  )
}

/** Texto con las menciones @alias resaltadas como chips. */
export function MentionText({ texto, miembros }: { texto: string; miembros: string[] }) {
  const parts = String(texto || '').split(/(@[\w.+-]+)/g)
  return (
    <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {parts.map((p, i) => {
        if (p.startsWith('@')) {
          const em = miembros.find((x) => alias(x) === p.slice(1).toLowerCase())
          if (em)
            return (
              <span key={i} title={em} style={{ background: '#FBE3F0', color: '#A81463', borderRadius: 5, padding: '0 4px', fontWeight: 700 }}>
                @{nombreCorto(em)}
              </span>
            )
        }
        return <React.Fragment key={i}>{p}</React.Fragment>
      })}
    </span>
  )
}

/** Editor con autocompletado de menciones: escribe @ y elige con ↑ ↓ Enter. */
export function MentionInput(props: {
  value: string
  onChange: (v: string) => void
  onSubmit?: () => void
  placeholder?: string
  miembros: string[]
  minHeight?: number
  autoFocus?: boolean
}) {
  const { value, onChange, onSubmit, placeholder, miembros, minHeight = 44, autoFocus } = props
  const ta = useRef<HTMLTextAreaElement>(null)
  const [sug, setSug] = useState<string[]>([])
  const [sel, setSel] = useState(0)
  const [tokenAt, setTokenAt] = useState(-1)

  const refresh = () => {
    const el = ta.current
    if (!el) return
    const upto = el.value.slice(0, el.selectionStart ?? el.value.length)
    const m = upto.match(/(^|[\s(])@([\w.+-]*)$/)
    if (!m) { setSug([]); setTokenAt(-1); return }
    const q = m[2].toLowerCase()
    const opts = miembros.filter((em) => alias(em).includes(q) || nombreCorto(em).toLowerCase().includes(q))
    setSug(opts.slice(0, 6))
    setSel(0)
    setTokenAt(upto.length - m[2].length - 1)
  }

  const pick = (em: string) => {
    const el = ta.current
    if (!el || tokenAt < 0) return
    const caret = el.selectionStart ?? value.length
    const next = value.slice(0, tokenAt) + '@' + alias(em) + ' ' + value.slice(caret)
    onChange(next)
    setSug([])
    setTokenAt(-1)
    requestAnimationFrame(() => {
      el.focus()
      const pos = tokenAt + alias(em).length + 2
      el.setSelectionRange(pos, pos)
    })
  }

  return (
    <div style={{ position: 'relative', flex: 1 }}>
      <textarea
        ref={ta}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); requestAnimationFrame(refresh) }}
        onKeyUp={(e) => { if (!/Arrow|Enter|Escape/.test(e.key)) refresh() }}
        onClick={refresh}
        onKeyDown={(e) => {
          if (sug.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % sug.length); return }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + sug.length) % sug.length); return }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(sug[sel]); return }
            if (e.key === 'Escape') { setSug([]); return }
          }
          if (e.key === 'Enter' && !e.shiftKey && onSubmit) { e.preventDefault(); onSubmit() }
        }}
        onBlur={() => setTimeout(() => setSug([]), 150)}
        style={{
          width: '100%', minHeight, resize: 'vertical', padding: '10px 12px',
          border: '1px solid #DCD9D2', borderRadius: 10, fontSize: 12.5, lineHeight: 1.55,
          fontFamily: SANS, background: '#fff', outline: 'none', color: INK,
        }}
      />
      {sug.length > 0 && (
        <div style={{ position: 'absolute', left: 8, bottom: 'calc(100% + 6px)', zIndex: 30, background: '#fff', border: '1px solid #E0DED8', borderRadius: 10, boxShadow: '0 14px 40px rgba(23,22,26,0.18)', padding: 4, minWidth: 220, animation: 'tkFadeUp 0.12s ease' }}>
          <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#B4B0A8', padding: '4px 8px' }}>Mencionar a…</div>
          {sug.map((em, i) => (
            <div
              key={em}
              className="tk-mention-item"
              data-sel={i === sel ? '1' : '0'}
              onMouseDown={(e) => { e.preventDefault(); pick(em) }}
              onMouseEnter={() => setSel(i)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 7, cursor: 'pointer' }}
            >
              <Avatar email={em} size={22} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: INK }}>{nombreCorto(em)}</div>
                <div style={{ fontFamily: MONO, fontSize: 9, color: '#8A867F', overflow: 'hidden', textOverflow: 'ellipsis' }}>@{alias(em)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function fmtVence(v?: string): { label: string; overdue: boolean } | null {
  if (!v) return null
  const d = new Date(v + 'T00:00:00')
  if (isNaN(+d)) return null
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const diff = Math.round((+d - +hoy) / 86400000)
  const label = diff === 0 ? 'hoy' : diff === 1 ? 'mañana' : diff === -1 ? 'ayer' : d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
  return { label, overdue: diff < 0 }
}
