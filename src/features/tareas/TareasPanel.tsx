// Panel de tareas del equipo (pestaña «Tareas» del Inicio): creación rápida
// con menciones, listas «Para mí» / «Delegadas» / «Sin asignar», completar con
// un clic (con deshacer), prioridad, vencimiento y filtros por proyecto.

import { useMemo, useRef, useState } from 'react'
import { type Project, type Tarea } from '../../lib/storage'
import { alias, menciones, myEmail, nombreCorto, timeAgo } from '../../lib/team'
import {
  ACCENT, Avatar, INK, KIT_CSS, MONO, MentionInput, MentionText, SANS,
  fmtVence, listTareas, saveTareas, useLista, useMiembros,
} from './kit'

const uid = (p: string) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

const PRIO: Record<string, { label: string; fg: string; bg: string }> = {
  alta: { label: 'Alta', fg: '#C03A2B', bg: '#F9ECEA' },
  normal: { label: 'Normal', fg: '#6E6B66', bg: '#F2F0EC' },
  baja: { label: 'Baja', fg: '#8A867F', bg: '#F7F6F3' },
}
const nextPrio: Record<string, Tarea['prioridad']> = { normal: 'alta', alta: 'baja', baja: 'normal' }

export default function TareasPanel({ proyectos, abrirNotas }: {
  proyectos: Project[]
  abrirNotas: (projectId: string) => void
}) {
  const [tareas] = useLista<Tarea>(listTareas)
  const miembros = useMiembros()
  const me = myEmail()

  const [nueva, setNueva] = useState('')
  const [nuevaProj, setNuevaProj] = useState('')
  const [nuevaVence, setNuevaVence] = useState('')
  const [filtroProj, setFiltroProj] = useState('')
  const [filtroQuien, setFiltroQuien] = useState<'todas' | 'mias' | 'delegadas'>('todas')
  const [verHechas, setVerHechas] = useState(false)
  const [expand, setExpand] = useState<string | null>(null)
  const [undoT, setUndoT] = useState<Tarea | null>(null)
  const undoTimer = useRef<any>(null)

  const projName = (id?: string) => proyectos.find((p) => p.id === id)?.name || ''

  const upd = (id: string, patch: Partial<Tarea>) =>
    saveTareas(listTareas().map((t) => (t.id === id ? { ...t, ...patch } : t)))

  const crear = () => {
    const texto = nueva.trim()
    if (!texto) return
    const asignada = menciones(texto, miembros)[0] || me
    const titulo = texto.replace(/@[\w.+-]+/g, (m) => {
      const em = miembros.find((x) => alias(x) === m.slice(1).toLowerCase())
      return em ? '' : m
    }).replace(/\s{2,}/g, ' ').trim() || texto
    const t: Tarea = {
      id: uid('t'), titulo, projectId: nuevaProj || undefined, asignada, autor: me,
      estado: 'pendiente', prioridad: 'normal', vence: nuevaVence || undefined, created: Date.now(),
    }
    saveTareas([t, ...listTareas()])
    setNueva(''); setNuevaVence('')
  }

  const completar = (t: Tarea) => {
    upd(t.id, { estado: 'hecha', doneAt: Date.now() })
    setUndoT(t)
    clearTimeout(undoTimer.current)
    undoTimer.current = setTimeout(() => setUndoT(null), 6000)
  }
  const deshacer = () => {
    if (undoT) upd(undoT.id, { estado: undoT.estado, doneAt: undefined })
    setUndoT(null)
  }

  const visibles = useMemo(() => {
    let l = tareas.filter((t) => t.estado !== 'hecha')
    if (filtroProj) l = l.filter((t) => t.projectId === filtroProj)
    if (filtroQuien === 'mias') l = l.filter((t) => t.asignada === me)
    if (filtroQuien === 'delegadas') l = l.filter((t) => t.autor === me && t.asignada && t.asignada !== me)
    const peso = (t: Tarea) => (t.prioridad === 'alta' ? 0 : t.prioridad === 'normal' ? 1 : 2)
    return l.sort((a, b) => (a.vence || '9999') < (b.vence || '9999') ? -1 : (a.vence || '9999') > (b.vence || '9999') ? 1 : peso(a) - peso(b) || b.created - a.created)
  }, [tareas, filtroProj, filtroQuien, me])

  const paraMi = visibles.filter((t) => t.asignada === me)
  const paraOtros = visibles.filter((t) => t.asignada && t.asignada !== me)
  const sinAsignar = visibles.filter((t) => !t.asignada)
  const hechas = useMemo(
    () => tareas.filter((t) => t.estado === 'hecha').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 30),
    [tareas],
  )

  const chip = (on: boolean): React.CSSProperties => ({
    padding: '6px 12px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer',
    border: '1px solid ' + (on ? INK : '#D8D5CE'), background: on ? INK : 'transparent', color: on ? '#fff' : '#6E6B66',
  })

  const Card = ({ t, done }: { t: Tarea; done?: boolean }) => {
    const v = fmtVence(t.vence)
    const open = expand === t.id
    return (
      <div className="tk-card" style={{ background: '#fff', border: '1px solid #E0DED8', borderRadius: 12, padding: '11px 14px', display: 'flex', flexDirection: 'column', gap: 8, animation: 'tkFadeUp 0.18s ease', opacity: done ? 0.72 : 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className="tk-check"
            title={done ? 'Reabrir tarea' : 'Marcar como hecha'}
            onClick={() => (done ? upd(t.id, { estado: 'pendiente', doneAt: undefined }) : completar(t))}
            style={{ width: 20, height: 20, borderRadius: '50%', flex: 'none', cursor: 'pointer', border: '2px solid ' + (done ? ACCENT : '#C9C5BC'), background: done ? ACCENT : '#fff', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
          >
            {done && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'tkPop 0.25s ease' }}><path d="M20 6 9 17l-5-5" /></svg>}
          </button>
          <div onClick={() => setExpand(open ? null : t.id)} className={done ? 'tk-done-title' : ''} style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: INK, cursor: 'pointer', lineHeight: 1.4 }}>
            <MentionText texto={t.titulo} miembros={miembros} />
          </div>
          {!done && (
            <span className="tk-chip" title="Cambiar prioridad" onClick={() => upd(t.id, { prioridad: nextPrio[t.prioridad] || 'normal' })} style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', padding: '3px 8px', borderRadius: 999, border: '1px solid transparent', color: PRIO[t.prioridad].fg, background: PRIO[t.prioridad].bg, flex: 'none' }}>
              {PRIO[t.prioridad].label}
            </span>
          )}
          {v && !done && <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 700, color: v.overdue ? '#C03A2B' : '#6E6B66', background: v.overdue ? '#F9ECEA' : '#F2F0EC', borderRadius: 999, padding: '3px 8px', flex: 'none' }}>{v.overdue ? '⚠ ' : ''}{v.label}</span>}
          <Avatar email={t.asignada} size={24} />
        </div>
        {open && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px dashed #ECEAE5', paddingTop: 10, animation: 'tkFadeUp 0.15s ease' }}>
            <textarea
              value={t.detalle || ''}
              placeholder="Detalle de la tarea…"
              onChange={(e) => upd(t.id, { detalle: e.target.value })}
              style={{ minHeight: 52, resize: 'vertical', padding: '8px 10px', border: '1px solid #DCD9D2', borderRadius: 8, fontSize: 12, fontFamily: SANS, lineHeight: 1.5, background: '#FDFDFC', outline: 'none' }}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={t.asignada} onChange={(e) => upd(t.id, { asignada: e.target.value })} title="Asignar a" style={sel}>
                <option value="">Sin asignar</option>
                {miembros.map((em) => <option key={em} value={em}>{nombreCorto(em)}</option>)}
              </select>
              <select value={t.projectId || ''} onChange={(e) => upd(t.id, { projectId: e.target.value || undefined })} title="Proyecto" style={sel}>
                <option value="">Sin proyecto</option>
                {proyectos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input type="date" value={t.vence || ''} onChange={(e) => upd(t.id, { vence: e.target.value || undefined })} title="Fecha límite" style={sel} />
              {!done && t.estado !== 'encurso' && <button className="tk-btn" onClick={() => upd(t.id, { estado: 'encurso' })} style={miniBtn}>▶ Empezar</button>}
              {!done && t.estado === 'encurso' && <button className="tk-btn" onClick={() => upd(t.id, { estado: 'pendiente' })} style={{ ...miniBtn, color: '#B07A1F' }}>⏸ Pausar</button>}
              <div style={{ flex: 1 }} />
              <button className="tk-btn" onClick={() => { saveTareas(listTareas().filter((x) => x.id !== t.id)); setExpand(null) }} style={{ ...miniBtn, color: '#C03A2B' }}>Eliminar</button>
            </div>
            <div style={{ fontFamily: MONO, fontSize: 9, color: '#B4B0A8' }}>
              creada por {nombreCorto(t.autor)} · {timeAgo(t.created)}{t.doneAt ? ' · completada ' + timeAgo(t.doneAt) : ''}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {t.estado === 'encurso' && !done && <span style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: '#0E7490', background: '#E8F4F6', borderRadius: 999, padding: '2px 8px' }}>EN CURSO</span>}
          {t.projectId && projName(t.projectId) && (
            <button className="tk-chip" title="Abrir las notas del proyecto" onClick={() => abrirNotas(t.projectId!)} style={{ border: '1px solid #E0DED8', background: '#F7F6F3', borderRadius: 999, padding: '2px 9px', fontFamily: MONO, fontSize: 9, color: '#55524D', cursor: 'pointer', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              ◳ {projName(t.projectId)}
            </button>
          )}
        </div>
      </div>
    )
  }

  const Grupo = ({ titulo, lista, vacio }: { titulo: string; lista: Tarea[]; vacio?: string }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#8A867F' }}>{titulo}</span>
        <span style={{ fontFamily: MONO, fontSize: 9.5, color: '#B4B0A8' }}>{lista.length}</span>
        <div style={{ flex: 1, height: 1, background: '#E0DED8' }} />
      </div>
      {lista.map((t) => <Card key={t.id} t={t} />)}
      {!lista.length && vacio && <div style={{ fontSize: 12, color: '#B4B0A8', padding: '4px 2px' }}>{vacio}</div>}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, fontFamily: SANS }}>
      <style>{KIT_CSS}</style>

      {/* creación rápida */}
      <div style={{ background: '#fff', border: '1px solid #E0DED8', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 10px 30px rgba(23,22,26,0.05)' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <MentionInput value={nueva} onChange={setNueva} onSubmit={crear} miembros={miembros} placeholder="Nueva tarea…  escribe @ para asignarla a alguien y pulsa Enter" />
          <button className="tk-btn" onClick={crear} disabled={!nueva.trim()} style={{ border: 'none', background: nueva.trim() ? ACCENT : '#E4E1DA', color: '#fff', borderRadius: 10, padding: '11px 18px', fontSize: 13, fontWeight: 800, cursor: nueva.trim() ? 'pointer' : 'default', flex: 'none' }}>
            Crear
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={nuevaProj} onChange={(e) => setNuevaProj(e.target.value)} style={sel}>
            <option value="">Sin proyecto</option>
            {proyectos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input type="date" value={nuevaVence} onChange={(e) => setNuevaVence(e.target.value)} title="Fecha límite (opcional)" style={sel} />
          <span style={{ fontFamily: MONO, fontSize: 9.5, color: '#B4B0A8' }}>Si no mencionas a nadie, la tarea es para ti.</span>
        </div>
      </div>

      {/* filtros */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setFiltroQuien('todas')} style={chip(filtroQuien === 'todas')}>Todas</button>
        <button onClick={() => setFiltroQuien('mias')} style={chip(filtroQuien === 'mias')}>Para mí</button>
        <button onClick={() => setFiltroQuien('delegadas')} style={chip(filtroQuien === 'delegadas')}>Delegadas</button>
        <div style={{ flex: 1 }} />
        <select value={filtroProj} onChange={(e) => setFiltroProj(e.target.value)} style={sel}>
          <option value="">Todos los proyectos</option>
          {proyectos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <Grupo titulo="Para mí" lista={paraMi} vacio="Nada pendiente para ti. 🎉" />
      <Grupo titulo="Para el equipo" lista={paraOtros} vacio="No has delegado ninguna tarea." />
      {sinAsignar.length > 0 && <Grupo titulo="Sin asignar" lista={sinAsignar} />}

      {/* hechas */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button onClick={() => setVerHechas(!verHechas)} style={{ alignSelf: 'flex-start', border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: 0 }}>
          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#8A867F' }}>
            {verHechas ? '▾' : '▸'} Completadas
          </span>
          <span style={{ fontFamily: MONO, fontSize: 9.5, color: '#B4B0A8' }}>{tareas.filter((t) => t.estado === 'hecha').length}</span>
        </button>
        {verHechas && hechas.map((t) => <Card key={t.id} t={t} done />)}
      </div>

      {/* deshacer */}
      {undoT && (
        <div style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 24, zIndex: 90, background: INK, color: '#fff', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 14px 44px rgba(23,22,26,0.4)', animation: 'tkFadeUp 0.2s ease' }}>
          <span style={{ fontSize: 12.5 }}>Tarea completada ✓</span>
          <button onClick={deshacer} style={{ border: '1px solid #3A3840', background: '#26252A', color: '#F5A6CF', borderRadius: 7, padding: '6px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>Deshacer</button>
        </div>
      )}
    </div>
  )
}

const sel: React.CSSProperties = {
  padding: '7px 10px', border: '1px solid #DCD9D2', borderRadius: 8, fontSize: 11.5,
  background: '#fff', color: '#55524D', outline: 'none', fontFamily: SANS,
}
const miniBtn: React.CSSProperties = {
  border: '1px solid #DCD9D2', background: '#fff', borderRadius: 8, padding: '6px 11px',
  fontSize: 11, fontWeight: 700, cursor: 'pointer', color: '#17161A', fontFamily: SANS,
}
