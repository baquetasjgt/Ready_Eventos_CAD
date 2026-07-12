// Buscador global (Ctrl+K / ⌘K): salta a cualquier proyecto, cliente, feria,
// proveedor o tarea desde cualquier pantalla. Flechas + Enter, Esc cierra.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KEYS, read, type Cliente, type Feria, type Project, type Proveedor, type Tarea } from '../../lib/storage'
import { Avatar, KIT_CSS, MONO, SANS } from '../tareas/kit'

const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

interface Item {
  id: string
  grupo: string
  icon: string
  titulo: string
  sub?: string
  email?: string
  go: () => void
}

export default function Paleta() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setOpen((o) => !o)
        setQ('')
        setSel(0)
      } else if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30)
  }, [open])

  const irInicio = (tab: string, busca?: string) => {
    navigate('/')
    // Inicio escucha este evento para cambiar de pestaña y prefiltrar
    setTimeout(() => window.dispatchEvent(new CustomEvent('ready-goto', { detail: { tab, busca } })), 40)
  }

  const items = useMemo<Item[]>(() => {
    if (!open) return []
    const out: Item[] = []
    const proyectos = (read<{ list: Project[] }>(KEYS.projects)?.list || []).filter((p) => !p.deleted)
    for (const p of proyectos) {
      out.push({ id: 'pv' + p.id, grupo: 'Proyectos', icon: '◳', titulo: p.name, sub: p.estado + ' · abrir Documento de venta', go: () => navigate('/venta/' + p.id) })
      out.push({ id: 'pp' + p.id, grupo: 'Proyectos', icon: '⬒', titulo: p.name, sub: 'abrir Memoria y planos', go: () => navigate('/planos/' + p.id) })
    }
    for (const c of read<{ list: Cliente[] }>(KEYS.clientes)?.list || [])
      out.push({ id: 'c' + c.id, grupo: 'Clientes', icon: '👤', titulo: c.nombre || '(sin nombre)', go: () => irInicio('clientes', c.nombre) })
    for (const f of read<{ list: Feria[] }>(KEYS.ferias)?.list || [])
      out.push({ id: 'f' + f.id, grupo: 'Ferias', icon: '🎪', titulo: f.nombre || '(sin nombre)', sub: f.recinto, go: () => irInicio('ferias', f.nombre) })
    for (const v of read<{ list: Proveedor[] }>(KEYS.proveedores)?.list || [])
      out.push({ id: 'v' + v.id, grupo: 'Proveedores', icon: '🔧', titulo: v.nombre || '(sin nombre)', sub: v.especialidad, go: () => irInicio('proveedores', v.nombre) })
    for (const t of (read<{ list: Tarea[] }>(KEYS.tareas)?.list || []).filter((t) => t.estado !== 'hecha'))
      out.push({ id: 't' + t.id, grupo: 'Tareas pendientes', icon: '☐', titulo: t.titulo, email: t.asignada, go: () => irInicio('tareas') })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const res = useMemo(() => {
    const nq = norm(q)
    if (!nq) return items.slice(0, 12)
    const starts = items.filter((i) => norm(i.titulo).startsWith(nq))
    const has = items.filter((i) => !norm(i.titulo).startsWith(nq) && (norm(i.titulo).includes(nq) || norm(i.sub || '').includes(nq)))
    return [...starts, ...has].slice(0, 12)
  }, [items, q])

  useEffect(() => setSel(0), [q])

  if (!open) return null

  const ejecutar = (i: Item) => {
    setOpen(false)
    i.go()
  }

  return (
    <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(23,22,26,0.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '14vh', fontFamily: SANS }}>
      <style>{KIT_CSS}</style>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, background: '#fff', borderRadius: 16, boxShadow: '0 30px 80px rgba(23,22,26,0.4)', overflow: 'hidden', animation: 'tkFadeUp 0.15s ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid #ECEAE5' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8A867F" strokeWidth="2.4" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.5-4.5" /></svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, res.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
              else if (e.key === 'Enter' && res[sel]) ejecutar(res[sel])
            }}
            placeholder="Buscar proyectos, clientes, ferias, tareas…"
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, color: '#17161A', background: 'none' }}
          />
          <span style={{ fontFamily: MONO, fontSize: 9, color: '#B4B0A8', border: '1px solid #ECEAE5', borderRadius: 5, padding: '2px 6px' }}>ESC</span>
        </div>
        <div style={{ maxHeight: '52vh', overflowY: 'auto', padding: 8 }}>
          {res.map((i, ix) => {
            const showGroup = ix === 0 || res[ix - 1].grupo !== i.grupo
            return (
              <div key={i.id}>
                {showGroup && <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#B4B0A8', padding: '8px 10px 4px' }}>{i.grupo}</div>}
                <div
                  onClick={() => ejecutar(i)}
                  onMouseEnter={() => setSel(ix)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 9, cursor: 'pointer', background: ix === sel ? '#FBF1F6' : 'transparent' }}
                >
                  <span style={{ fontSize: 14, width: 20, textAlign: 'center', flex: 'none' }}>{i.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#17161A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.titulo}</div>
                    {i.sub && <div style={{ fontSize: 10.5, color: '#8A867F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.sub}</div>}
                  </div>
                  {i.email && <Avatar email={i.email} size={20} />}
                  {ix === sel && <span style={{ fontFamily: MONO, fontSize: 9, color: '#D6197E', flex: 'none' }}>↵</span>}
                </div>
              </div>
            )
          })}
          {!res.length && <div style={{ padding: 20, textAlign: 'center', fontSize: 12.5, color: '#B4B0A8' }}>Sin resultados para «{q}»</div>}
        </div>
      </div>
    </div>
  )
}
