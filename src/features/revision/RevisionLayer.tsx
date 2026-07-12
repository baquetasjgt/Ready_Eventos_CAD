// Capa de Revisión de una lámina: pinta los post-its y trazos (nunca se
// imprimen: data-ui + data-noprint) y captura el puntero cuando hay una
// herramienta activa. Se monta dentro del div de cada lámina.

import React, { useEffect, useRef, useState } from 'react'
import type { Revision } from '../../lib/storage'
import { nombreCorto } from '../../lib/team'
import { Avatar, MONO, SANS, useMiembros } from '../tareas/kit'
import {
  addStroke, completarPostit, crearPostit, delMark, listTareasR, marcasDe, revState,
  setPostitAsignada, setPostitTexto, setRev, subRev, updMark,
} from './store'

const CHANGED = 'ready-data-changed'

function useRev() {
  const [, force] = useState(0)
  useEffect(() => {
    const f = () => force((n) => n + 1)
    const un = subRev(f)
    window.addEventListener(CHANGED, f)
    window.addEventListener('ready-sync-pulled', f)
    return () => {
      un()
      window.removeEventListener(CHANGED, f)
      window.removeEventListener('ready-sync-pulled', f)
    }
  }, [])
}

export default function RevisionLayer({ app, projectId, pageId, pageLabel }: {
  app: 'venta' | 'planos'
  projectId: string
  pageId: string
  pageLabel: string
}) {
  useRev()
  const miembros = useMiembros()
  const st = revState()
  const ref = useRef<HTMLDivElement>(null)
  const [live, setLive] = useState<number[][] | null>(null)
  const drawing = useRef<{ tool: 'draw' | 'hi' | 'arrow'; pts: number[][] } | null>(null)

  if (!st.visible) return null
  const marks = marcasDe(app, projectId, pageId)
  const active = !!st.tool

  const pct = (ev: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect()
    return [((ev.clientX - r.left) / r.width) * 100, ((ev.clientY - r.top) / r.height) * 100]
  }

  const down = (ev: React.PointerEvent) => {
    if (!st.tool || st.tool === 'erase') return
    ev.preventDefault()
    ev.stopPropagation()
    const [x, y] = pct(ev)
    if (st.tool === 'postit') {
      crearPostit(app, projectId, pageId, Math.min(x, 82), Math.min(y, 74), pageLabel)
      return
    }
    drawing.current = { tool: st.tool, pts: [[x, y]] }
    setLive([[x, y]])
    ;(ev.target as Element).setPointerCapture?.(ev.pointerId)
  }
  const move = (ev: React.PointerEvent) => {
    if (!drawing.current) return
    const [x, y] = pct(ev)
    const d = drawing.current
    if (d.tool === 'arrow') d.pts = [d.pts[0], [x, y]]
    else {
      const last = d.pts[d.pts.length - 1]
      if (Math.hypot(x - last[0], y - last[1]) > 0.35) d.pts.push([x, y])
    }
    setLive([...d.pts])
  }
  const up = () => {
    const d = drawing.current
    drawing.current = null
    setLive(null)
    if (d && d.pts.length > 1) addStroke(app, projectId, pageId, d.tool, d.pts, d.tool === 'hi' ? '#FFD43B' : '#E4405F')
  }

  const strokeEl = (r: Revision | { tool: string; pts: number[][]; color?: string; id?: string }, ghost?: boolean) => {
    const pts = r.pts || []
    if (pts.length < 2) return null
    const color = (r as any).color || ((r as any).tool === 'hi' ? '#FFD43B' : '#E4405F')
    const d = 'M ' + pts.map((p) => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' L ')
    const common: any = {
      fill: 'none', vectorEffect: 'non-scaling-stroke',
      strokeLinecap: 'round', strokeLinejoin: 'round',
      style: {
        cursor: st.tool === 'erase' ? 'pointer' : undefined,
        pointerEvents: st.tool === 'erase' ? 'stroke' : 'none',
        opacity: ghost ? 0.7 : 1,
      },
      onPointerDown: st.tool === 'erase' && (r as any).id
        ? (e: React.PointerEvent) => { e.stopPropagation(); delMark((r as any).id) }
        : undefined,
    }
    if ((r as any).tool === 'arrow') {
      const [a, b] = [pts[0], pts[pts.length - 1]]
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
      const L = 2.2
      const w1 = [b[0] - L * Math.cos(ang - 0.45), b[1] - L * Math.sin(ang - 0.45)]
      const w2 = [b[0] - L * Math.cos(ang + 0.45), b[1] - L * Math.sin(ang + 0.45)]
      return (
        <g key={(r as any).id || 'ghost'}>
          <path d={`M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`} stroke={color} strokeWidth={2.5} {...common} />
          <path d={`M ${w1[0]} ${w1[1]} L ${b[0]} ${b[1]} L ${w2[0]} ${w2[1]}`} stroke={color} strokeWidth={2.5} {...common} />
        </g>
      )
    }
    const hi = (r as any).tool === 'hi'
    return (
      <path key={(r as any).id || 'ghost'} d={d} stroke={color} strokeWidth={hi ? 14 : 2.5} {...common}
        style={{ ...common.style, mixBlendMode: hi ? 'multiply' : undefined, opacity: (ghost ? 0.7 : 1) * (hi ? 0.45 : 1) }} />
    )
  }

  const cursor =
    st.tool === 'postit' ? 'copy' : st.tool === 'erase' ? 'not-allowed' : st.tool ? 'crosshair' : 'default'

  return (
    <div
      ref={ref}
      data-ui="1"
      data-noprint="1"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerLeave={() => { if (drawing.current) up() }}
      style={{ position: 'absolute', inset: 0, zIndex: 45, pointerEvents: active ? 'auto' : 'none', cursor, fontFamily: SANS, touchAction: active ? 'none' : undefined }}
    >
      {/* trazos */}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
        <g style={{ pointerEvents: st.tool === 'erase' ? 'auto' : 'none' }}>
          {marks.filter((m) => m.kind === 'stroke').map((m) => strokeEl(m))}
          {live && drawing.current && strokeEl({ tool: drawing.current.tool, pts: live }, true)}
        </g>
      </svg>

      {/* post-its */}
      {marks.filter((m) => m.kind === 'postit').map((m, i) => (
        <Postit key={m.id} m={m} idx={i} miembros={miembros} pageLabel={pageLabel} erase={st.tool === 'erase'} sel={st.sel === m.id} />
      ))}
    </div>
  )
}

function Postit({ m, idx, miembros, pageLabel, erase, sel }: {
  m: Revision
  idx: number
  miembros: string[]
  pageLabel: string
  erase: boolean
  sel: boolean
}) {
  const [texto, setTexto] = useState(m.texto || '')
  const [drag, setDrag] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const start = useRef<{ px: number; py: number; x: number; y: number } | null>(null)
  const nuevo = !m.texto && Date.now() - (m.created || 0) < 4000

  useEffect(() => { setTexto(m.texto || '') }, [m.texto])

  // la tarea vinculada lleva la asignación (pocas tareas: búsqueda directa)
  const asignada = (m.tareaId && listTareasR().find((t) => t.id === m.tareaId)?.asignada) || ''

  const headDown = (ev: React.PointerEvent) => {
    if (erase) { ev.stopPropagation(); delMark(m.id); return }
    ev.preventDefault()
    ev.stopPropagation()
    setRev({ sel: m.id })
    const page = ref.current!.parentElement!.getBoundingClientRect()
    start.current = { px: ev.clientX, py: ev.clientY, x: m.x || 0, y: m.y || 0 }
    setDrag(true)
    const mv = (e: PointerEvent) => {
      if (!start.current) return
      const nx = Math.max(0, Math.min(88, start.current.x + ((e.clientX - start.current.px) / page.width) * 100))
      const ny = Math.max(0, Math.min(82, start.current.y + ((e.clientY - start.current.py) / page.height) * 100))
      updMark(m.id, { x: nx, y: ny })
    }
    const upH = () => {
      start.current = null
      setDrag(false)
      window.removeEventListener('pointermove', mv)
      window.removeEventListener('pointerup', upH)
    }
    window.addEventListener('pointermove', mv)
    window.addEventListener('pointerup', upH)
  }

  return (
    <div
      ref={ref}
      onPointerDown={(e) => { e.stopPropagation(); if (erase) { delMark(m.id) } else setRev({ sel: m.id }) }}
      style={{
        position: 'absolute', left: (m.x || 0) + '%', top: (m.y || 0) + '%',
        width: '54mm', minHeight: '42mm', pointerEvents: 'auto',
        // Papel con luz: degradado sobre el color base (que queda de respaldo)
        backgroundColor: m.color || '#FFE58A',
        backgroundImage: `linear-gradient(148deg, color-mix(in srgb, ${m.color || '#FFE58A'} 55%, white) 0%, ${m.color || '#FFE58A'} 52%, color-mix(in srgb, ${m.color || '#FFE58A'} 88%, #6b5500) 100%)`,
        borderRadius: '1px 1px 2px 8px',
        boxShadow: drag
          ? '0 26px 46px rgba(23,22,26,0.38), 0 6px 14px rgba(23,22,26,0.22)'
          : '0 14px 26px rgba(23,22,26,0.26), 0 3px 7px rgba(23,22,26,0.16)',
        transform: `rotate(${idx % 2 ? 1.3 : -1.6}deg) scale(${drag ? 1.05 : 1})`,
        transition: drag ? 'none' : 'box-shadow 0.15s ease, transform 0.15s ease',
        display: 'flex', flexDirection: 'column',
        outline: sel ? '2.5px solid #D6197E' : 'none', outlineOffset: 4,
        animation: 'tkPop 0.22s ease',
        cursor: erase ? 'not-allowed' : 'default',
      }}
    >
      {/* chincheta roja */}
      <svg
        width="30" height="36" viewBox="0 0 30 36"
        style={{ position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%) rotate(3deg)', zIndex: 3, pointerEvents: 'none', filter: 'drop-shadow(0 4px 3px rgba(23,22,26,0.35))' }}
      >
        <defs>
          <radialGradient id="rvPinBall" cx="0.35" cy="0.3" r="0.85">
            <stop offset="0%" stopColor="#FF8E8E" />
            <stop offset="45%" stopColor="#E4353F" />
            <stop offset="100%" stopColor="#9E1220" />
          </radialGradient>
          <linearGradient id="rvPinNeedle" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#8F949C" />
            <stop offset="50%" stopColor="#E9EDF2" />
            <stop offset="100%" stopColor="#767B84" />
          </linearGradient>
        </defs>
        <rect x="13.9" y="18" width="2.2" height="15" rx="1.1" fill="url(#rvPinNeedle)" />
        <ellipse cx="15" cy="19.5" rx="6.5" ry="3" fill="#B01722" />
        <circle cx="15" cy="11" r="9.5" fill="url(#rvPinBall)" />
        <ellipse cx="11.5" cy="7.5" rx="3" ry="2" fill="rgba(255,255,255,0.55)" transform="rotate(-24 11.5 7.5)" />
      </svg>
      {/* esquina inferior doblada */}
      <div
        style={{
          position: 'absolute', bottom: 0, left: 0, width: 26, height: 26, pointerEvents: 'none', zIndex: 2,
          clipPath: 'polygon(0 0, 100% 100%, 0 100%)',
          backgroundImage: `linear-gradient(45deg, color-mix(in srgb, ${m.color || '#FFE58A'} 70%, #5a4a00) 0%, color-mix(in srgb, ${m.color || '#FFE58A'} 55%, white) 55%, #fff 100%)`,
          borderRadius: '0 0 0 8px',
          boxShadow: 'inset -3px 3px 5px rgba(23,22,26,0.18)',
        }}
      />

      <div onPointerDown={headDown} title="Arrastra para mover" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 9px 2px', cursor: erase ? 'not-allowed' : 'grab' }}>
        <span style={{ fontFamily: MONO, fontSize: '6.5pt', letterSpacing: '0.1em', color: 'rgba(23,22,26,0.5)', textTransform: 'uppercase', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {nombreCorto(m.autor)}
        </span>
        <Avatar email={asignada} size={17} />
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); completarPostit(m.id) }}
          title="Hecho: completa la tarea y quita el post-it"
          style={{ border: 'none', background: 'rgba(255,255,255,0.55)', color: '#1F8A5B', borderRadius: 5, width: 17, height: 17, fontSize: 11, fontWeight: 800, cursor: 'pointer', padding: 0, lineHeight: 1, boxShadow: '0 1px 2px rgba(23,22,26,0.15)' }}
        >✓</button>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); delMark(m.id) }}
          title="Eliminar post-it (y su tarea)"
          style={{ border: 'none', background: 'none', color: 'rgba(23,22,26,0.45)', fontSize: 13, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
        >×</button>
      </div>
      <textarea
        value={texto}
        autoFocus={nuevo}
        placeholder="Escribe la corrección…"
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={() => setPostitTexto(m.id, texto, pageLabel)}
        style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', resize: 'none', padding: '4px 11px 6px', fontSize: '13.5pt', lineHeight: 1.25, fontFamily: "'Caveat','Segoe Print',cursive", fontWeight: 500, color: '#33301f', minHeight: '20mm' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0 9px 7px 30px' }}>
        <select
          value={asignada}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setPostitAsignada(m.id, e.target.value)}
          title="Asignar la tarea a…"
          style={{ flex: 1, minWidth: 0, border: '1px solid rgba(23,22,26,0.14)', background: 'rgba(255,255,255,0.5)', borderRadius: 6, padding: '3px 5px', fontSize: '7.5pt', fontFamily: SANS, color: '#26252A', outline: 'none' }}
        >
          <option value="">Sin asignar</option>
          {miembros.map((em) => <option key={em} value={em}>{nombreCorto(em)}</option>)}
        </select>
        <span style={{ fontFamily: MONO, fontSize: '6pt', color: 'rgba(23,22,26,0.4)' }}>→ tarea</span>
      </div>
    </div>
  )
}
