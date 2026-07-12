// Panel lateral de notas de un proyecto: hilo de conversación del equipo con
// menciones @, convertir cualquier nota en tarea con un clic y las tareas del
// proyecto a mano. Se abre desde la fila del proyecto o desde una tarea.

import { useEffect, useMemo, useRef, useState } from 'react'
import { type Nota, type Project, type Tarea } from '../../lib/storage'
import { menciones, myEmail, nombreCorto, timeAgo } from '../../lib/team'
import {
  ACCENT, Avatar, INK, KIT_CSS, MONO, MentionInput, MentionText, SANS,
  listNotas, listTareas, saveNotas, saveTareas, useLista, useMiembros,
} from './kit'

const uid = (p: string) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

// Último vistazo de cada hilo por usuario (para el punto de "hay algo nuevo").
const seenKey = () => 'ready-notas-seen:' + (myEmail() || 'anon')
export function getSeen(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(seenKey()) || '{}') } catch { return {} }
}
function markSeen(projectId: string) {
  const s = getSeen()
  s[projectId] = Date.now()
  try { localStorage.setItem(seenKey(), JSON.stringify(s)) } catch { /* ignore */ }
}

export default function NotasDrawer({ proyecto, onClose }: { proyecto: Project; onClose: () => void }) {
  const [notas] = useLista<Nota>(listNotas)
  const [tareas] = useLista<Tarea>(listTareas)
  const miembros = useMiembros()
  const me = myEmail()

  const [texto, setTexto] = useState('')
  const [delPend, setDelPend] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const hilo = useMemo(
    () => notas.filter((n) => n.projectId === proyecto.id).sort((a, b) => a.created - b.created),
    [notas, proyecto.id],
  )
  const tareasProj = useMemo(
    () => tareas.filter((t) => t.projectId === proyecto.id && t.estado !== 'hecha').sort((a, b) => b.created - a.created),
    [tareas, proyecto.id],
  )

  useEffect(() => { markSeen(proyecto.id) }, [proyecto.id, hilo.length])
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [hilo.length])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cerrar = () => {
    setClosing(true)
    setTimeout(onClose, 200)
  }

  const enviar = () => {
    const t = texto.trim()
    if (!t) return
    saveNotas([...listNotas(), { id: uid('n'), projectId: proyecto.id, autor: me, texto: t, created: Date.now() }])
    setTexto('')
    markSeen(proyecto.id)
  }

  const borrar = (id: string) => {
    if (delPend !== id) {
      setDelPend(id)
      setTimeout(() => setDelPend((c) => (c === id ? null : c)), 3000)
      return
    }
    setDelPend(null)
    saveNotas(listNotas().filter((n) => n.id !== id))
  }

  const aTarea = (n: Nota) => {
    const asignada = menciones(n.texto, miembros)[0] || me
    const titulo = n.texto.replace(/\s+/g, ' ').trim().slice(0, 140)
    saveTareas([
      { id: uid('t'), titulo, projectId: proyecto.id, asignada, autor: me, estado: 'pendiente', prioridad: 'normal', created: Date.now() },
      ...listTareas(),
    ])
  }

  const toggleTarea = (t: Tarea) =>
    saveTareas(listTareas().map((x) => (x.id === t.id ? { ...x, estado: x.estado === 'hecha' ? 'pendiente' : 'hecha', doneAt: x.estado === 'hecha' ? undefined : Date.now() } : x)))

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, fontFamily: SANS }}>
      <style>{KIT_CSS}</style>
      <div onClick={cerrar} style={{ position: 'absolute', inset: 0, background: 'rgba(23,22,26,0.35)', animation: closing ? 'tkFadeIn 0.2s ease reverse forwards' : 'tkFadeIn 0.2s ease' }} />
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(440px, 94vw)', background: '#F7F6F3', boxShadow: '-24px 0 60px rgba(23,22,26,0.25)', display: 'flex', flexDirection: 'column', animation: closing ? 'tkSlideIn 0.2s ease reverse forwards' : 'tkSlideIn 0.22s cubic-bezier(0.2,0.8,0.25,1)' }}>
        {/* cabecera */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #E0DED8', background: '#fff', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#FBE3F0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>💬</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{proyecto.name}</div>
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8A867F' }}>Notas del equipo · {hilo.length}</div>
          </div>
          <button onClick={cerrar} title="Cerrar (Esc)" style={{ border: 'none', background: 'none', fontSize: 20, color: '#8A867F', cursor: 'pointer', padding: '2px 6px' }}>×</button>
        </div>

        {/* tareas del proyecto */}
        {tareasProj.length > 0 && (
          <div style={{ padding: '12px 20px', borderBottom: '1px solid #E0DED8', background: '#FBFAF9', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 170, overflowY: 'auto' }}>
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8A867F' }}>Tareas abiertas de este proyecto</div>
            {tareasProj.map((t) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <button className="tk-check" onClick={() => toggleTarea(t)} title="Marcar como hecha" style={{ width: 16, height: 16, borderRadius: '50%', flex: 'none', cursor: 'pointer', border: '2px solid #C9C5BC', background: '#fff', padding: 0 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.titulo}</span>
                <Avatar email={t.asignada} size={18} />
              </div>
            ))}
          </div>
        )}

        {/* hilo */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {hilo.length === 0 && (
            <div style={{ margin: 'auto', textAlign: 'center', color: '#8A867F', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
              <div style={{ fontSize: 34 }}>📝</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#55524D' }}>Todavía no hay notas</div>
              <div style={{ fontSize: 11.5, lineHeight: 1.6, maxWidth: 240 }}>
                Escribe la primera abajo. Usa <strong>@</strong> para mencionar a un compañero: lo verá destacado y en su panel.
              </div>
            </div>
          )}
          {hilo.map((n) => {
            const mia = n.autor === me
            return (
              <div key={n.id} style={{ display: 'flex', gap: 10, animation: 'tkFadeUp 0.18s ease' }}>
                <Avatar email={n.autor} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: INK }}>{nombreCorto(n.autor)}{mia ? ' (tú)' : ''}</span>
                    <span style={{ fontFamily: MONO, fontSize: 9, color: '#B4B0A8' }}>{timeAgo(n.created)}{n.edited ? ' · editada' : ''}</span>
                  </div>
                  <div className="tk-card" style={{ marginTop: 4, background: mia ? '#FBF1F6' : '#fff', border: '1px solid ' + (mia ? '#F0CFE1' : '#E0DED8'), borderRadius: '4px 12px 12px 12px', padding: '9px 12px', fontSize: 12.5, lineHeight: 1.55, color: '#26252A' }}>
                    <MentionText texto={n.texto} miembros={miembros} />
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                    <button onClick={() => aTarea(n)} title="Crear una tarea a partir de esta nota" style={linkBtn}>＋ Crear tarea</button>
                    {mia && (
                      <button onClick={() => borrar(n.id)} style={{ ...linkBtn, color: delPend === n.id ? '#C03A2B' : '#B4B0A8', fontWeight: delPend === n.id ? 800 : 600 }}>
                        {delPend === n.id ? '¿Eliminar?' : 'Eliminar'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* redactor */}
        <div style={{ padding: '14px 20px 18px', borderTop: '1px solid #E0DED8', background: '#fff', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <MentionInput value={texto} onChange={setTexto} onSubmit={enviar} miembros={miembros} placeholder={'Escribe una nota…  @ para mencionar · Enter envía'} minHeight={46} autoFocus />
          <button className="tk-btn" onClick={enviar} disabled={!texto.trim()} title="Enviar (Enter)" style={{ border: 'none', background: texto.trim() ? ACCENT : '#E4E1DA', color: '#fff', borderRadius: 10, width: 42, height: 42, cursor: texto.trim() ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
          </button>
        </div>
      </div>
    </div>
  )
}

const linkBtn: React.CSSProperties = {
  border: 'none', background: 'none', padding: 0, fontSize: 10.5, fontWeight: 600,
  color: '#B0447E', cursor: 'pointer', fontFamily: SANS,
}
