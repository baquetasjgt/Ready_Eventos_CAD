// Barra flotante del modo Revisión (Documento de venta y Memoria y planos):
// post-it, rotulador, subrayador, flecha y goma. Nada de esto se imprime.

import { useEffect, useState } from 'react'
import { KIT_CSS, MONO, SANS } from '../tareas/kit'
import { POSTIT_COLORS, listRevs, revState, setRev, subRev, type RevTool } from './store'

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
      if (e.key === 'Escape' && revState().tool) setRev({ tool: null })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const st = revState()
  const n = listRevs().filter((r) => r.projectId === projectId && r.app === app && r.kind === 'postit').length

  const tools: { t: RevTool; icon: JSX.Element; label: string; title: string }[] = [
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
