// Barra flotante del modo Revisión (Documento de venta y Memoria y planos):
// post-it, rotulador, subrayador, flecha y goma. Nada de esto se imprime.

import { useEffect, useState } from 'react'
import { KIT_CSS, MONO, SANS } from '../tareas/kit'
import { POSTIT_COLORS, delMarks, listRevs, revState, setRev, subRev, type RevTool } from './store'

const CHANGED = 'ready-data-changed'

export default function RevisionBar({ projectId, app }: { projectId: string; app: 'venta' | 'planos' }) {
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
  // al desmontar el editor, apagar la herramienta activa
  useEffect(() => () => setRev({ tool: null, sel: null }), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = ((e.target as any)?.tagName as string) || ''
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || (e.target as any)?.isContentEditable) return
      const st = revState()
      if (e.key === 'Escape') {
        // primero deselecciona; con otra pulsación suelta la herramienta
        if (st.multi.length) setRev({ multi: [] })
        else if (st.tool) setRev({ tool: null })
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && st.multi.length) {
        e.preventDefault()
        delMarks(st.multi)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const st = revState()
  const n = listRevs().filter((r) => r.projectId === projectId && r.app === app && r.kind === 'postit').length

  const tools: { t: RevTool; icon: JSX.Element; label: string; title: string }[] = [
    { t: 'select', icon: ic('M5 3a2 2 0 0 0-2 2 M19 3a2 2 0 0 1 2 2 M5 21a2 2 0 0 1-2-2 M9 3h2 M9 21h2 M15 3h2 M3 9v2 M21 9v2 M3 15v2 M21 15v1 M14 14l6 6 M14 20v-6h6'), label: 'Seleccionar', title: 'Selección por recuadro: arrastra y lo que caiga dentro queda seleccionado · Supr borra · Esc deselecciona' },
    { t: 'postit', icon: ic('M4 4h16v12l-4 4H4z M16 20v-4h4'), label: 'Post-it', title: 'Post-it: clic en la lámina para pegarlo (crea una tarea)' },
    { t: 'draw', icon: ic('M12 19l7-7 3 3-7 7-3-3z M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z'), label: 'Dibujar', title: 'Rotulador: dibuja a mano alzada' },
    { t: 'hi', icon: ic('M9 11l6 6 M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z'), label: 'Subrayar', title: 'Subrayador fosforito' },
    { t: 'arrow', icon: ic('M5 19 19 5 M11 5h8v8'), label: 'Flecha', title: 'Flecha para señalar' },
    { t: 'erase', icon: ic('M20 20H8 M6 14l8-8a2 2 0 0 1 3 0l4 4a2 2 0 0 1 0 3l-7 7H9z'), label: 'Borrar', title: 'Goma: pulsa sobre una marca o post-it para borrarlo' },
  ]

  return (
    <div data-ui="1" data-noprint="1" style={{ position: 'fixed', right: 20, bottom: 18, zIndex: 70, fontFamily: SANS }}>
      <style>{KIT_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#17161A', borderRadius: 14, padding: '7px 9px', boxShadow: '0 16px 44px rgba(23,22,26,0.45)', animation: 'tkFadeUp 0.25s ease' }}>
        <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#8A867F', padding: '0 7px' }}>
          Revisión
        </span>
        {tools.map((x) => {
          const on = st.tool === x.t
          return (
            <button
              key={x.t}
              className="tk-btn"
              title={x.title + ' (Esc para salir)'}
              onClick={() => setRev({ tool: on ? null : x.t })}
              style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: on ? '#D6197E' : 'transparent', color: on ? '#fff' : '#C9C5CE', borderRadius: 9, padding: '7px 11px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
            >
              {x.icon}
              <span>{x.label}</span>
            </button>
          )
        })}
        {st.tool === 'postit' && (
          <div style={{ display: 'flex', gap: 5, padding: '0 5px', animation: 'tkFadeUp 0.15s ease' }}>
            {POSTIT_COLORS.map((c) => (
              <button key={c} onClick={() => setRev({ color: c })} title="Color del post-it" style={{ width: 17, height: 17, borderRadius: 5, background: c, border: st.color === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer', padding: 0 }} />
            ))}
          </div>
        )}
        {st.multi.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 6px', animation: 'tkFadeUp 0.15s ease' }}>
            <span style={{ fontFamily: MONO, fontSize: 10, color: '#F5A6CF', fontWeight: 700 }}>{st.multi.length} sel.</span>
            <button
              className="tk-btn"
              onClick={() => delMarks(revState().multi)}
              title="Borrar lo seleccionado (Supr)"
              style={{ border: '1px solid #D6197E', background: '#D6197E', color: '#fff', borderRadius: 7, padding: '4px 10px', fontSize: 10.5, fontWeight: 800, cursor: 'pointer' }}
            >
              Borrar (Supr)
            </button>
            <button
              className="tk-btn"
              onClick={() => setRev({ multi: [] })}
              title="Deseleccionar (Esc)"
              style={{ border: '1px solid #3A3840', background: 'transparent', color: '#C9C5CE', borderRadius: 7, padding: '4px 9px', fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
            >
              Esc
            </button>
          </div>
        )}
        <span style={{ width: 1, height: 20, background: '#3A3840', margin: '0 3px' }} />
        <button
          className="tk-btn"
          title={st.visible ? 'Ocultar todas las revisiones' : 'Mostrar las revisiones'}
          onClick={() => setRev({ visible: !st.visible, tool: null })}
          style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', color: st.visible ? '#C9C5CE' : '#D6197E', borderRadius: 9, padding: '7px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
        >
          {st.visible
            ? ic('M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0')
            : ic('M3 3l18 18 M10.6 10.6a3 3 0 0 0 4.2 4.2 M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68 M6.61 6.61A13.526 13.526 0 0 0 2 11s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61')}
          <span style={{ fontFamily: MONO, fontSize: 10 }}>{n}</span>
        </button>
      </div>
    </div>
  )
}

function ic(d: string) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
      {d.split(' M').map((p, i) => <path key={i} d={(i ? 'M' : '') + p} />)}
    </svg>
  )
}
