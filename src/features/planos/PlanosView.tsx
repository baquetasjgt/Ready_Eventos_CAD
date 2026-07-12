import React from 'react'
import { Link } from 'react-router-dom'
import { buildSVG, detectFrames } from './cad-lib'
import { renderOverlay } from './overlay'
import { GLYPH, glyphEl, SIM_OPTIONS } from './glyphs'
import { read, KEYS } from '../../lib/storage'
import type { Sheet } from './types'
import {
  ACCENT,
  CAJ_POS,
  ESCALAS,
  ESTILO_CAPAS,
  GROSOR,
  MONO,
  PLEGADO,
  SANS,
  addFav,
  cajTheme,
  delFav,
  eyeDrop,
  fmtNum,
  getLeyLib,
  getNoteLib,
  pad2,
  saveLeyLib,
  saveNoteLib,
} from './helpers'

const TABS = [
  { id: 'proyecto', label: 'Proyecto' },
  { id: 'planos', label: 'Planos' },
  { id: 'leyendas', label: 'Leyendas' },
  { id: 'memoria', label: 'Memoria' },
  { id: 'tablas', label: 'Tablas' },
  { id: 'anexos', label: 'Anexos' },
]

// UI styling constants
const border = '#E0DED8'
const fieldBd = '#DCD9D2'
const muted = '#8A867F'

function crmInfo(projectId: string) {
  try {
    const sh = read<any>(KEYS.projects)
    const rec = sh && sh.list && sh.list.find((p: any) => p.id === projectId)
    if (!rec) return {}
    const cl = read<any>(KEYS.clientes)?.list || []
    const fe = read<any>(KEYS.ferias)?.list || []
    return { cliente: cl.find((c: any) => c.id === rec.clienteId) || null, feria: fe.find((f: any) => f.id === rec.feriaId) || null }
  } catch (e) {
    return {}
  }
}

export default function PlanosView(p: any) {
  const doc = p.doc
  const accent = ACCENT
  const caj = cajTheme(doc.cajStyle)
  const crm: any = crmInfo(p.projectId)

  let fechaLarga = '',
    fechaCorta = ''
  try {
    const d = new Date(doc.project.fecha + 'T12:00:00')
    fechaLarga = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
    fechaCorta = d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch (e) {
    fechaLarga = doc.project.fecha
    fechaCorta = doc.project.fecha
  }

  const fld = (v: any, onChange: any, extra?: React.CSSProperties, props?: any) => (
    <input value={v} onChange={onChange} style={{ padding: '9px 11px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 13, background: '#fff', color: '#17161A', outline: 'none', width: '100%', ...extra }} {...props} />
  )

  // ================= SHEET PAGES =================
  const inclSheets: Sheet[] = doc.sheets.filter((sh: Sheet) => sh.incluir !== false)

  function buildSheetPage(sh: Sheet) {
    const d = doc.drawings.find((x: any) => x.id === sh.drawingId)
    const m = d && p.models.current[d.id]
    const { W, H } = p.viewport(sh.size, sh.orient)
    let plan: React.ReactNode = null
    let sbSegs: any[] = [],
      sbSegMM = 8,
      sbTotal = ''
    if (m) {
      const unitMM = 1000 * (d.unit === 'cm' ? 0.01 : d.unit === 'mm' ? 0.001 : 1)
      const UM = d.unit === 'm' ? 1000 : d.unit === 'cm' ? 10 : 1
      const strokeDU = (GROSOR * sh.escala) / UM
      const regKey = sh.region ? [sh.region.minX, sh.region.minY, sh.region.maxX, sh.region.maxY].map((v: number) => +v.toFixed(3)).join(',') : 'full'
      const ocultas = sh.capasOcultas || []
      const key = d.id + '|' + strokeDU.toFixed(6) + '|' + regKey + '|' + (ESTILO_CAPAS ? 'c' : 'm') + '|' + ocultas.join(',') + '|' + (doc.capasCfg.rotulos || '')
      if (!p.svgCache.current[key]) {
        const entsVis = m.ents.filter((e: any) => !p.isRotulLayer(e.layer || '') && !(ocultas.length && ocultas.includes(e.layer)))
        p.svgCache.current[key] = buildSVG(entsVis, m.bounds, { stroke: strokeDU, region: sh.region || null, useLayers: ESTILO_CAPAS, layerStyles: m.layerStyles || {}, mmToDU: sh.escala / UM })
        const keys = Object.keys(p.svgCache.current)
        if (keys.length > 24) delete p.svgCache.current[keys[0]]
      }
      const { pw, ph } = p.planSizeMM(m, d.unit, sh.escala, sh.region)
      const vb = p.vbFor(m, sh.region || null, strokeDU)
      const mm2du = sh.escala / UM
      const anyActive = !!p.tool && (p.toolSh === sh.id || p.toolSh === '*') && p.zoneEdit !== sh.id
      const H2 = {
        planClick: (ev: any) => p.overlayHandlers.planClick(sh, d, vb, ev),
        planDown: (ev: any) => p.overlayHandlers.planDown(sh, d, vb, ev),
        planUp: () => p.overlayHandlers.planUp(),
        planMove: (ev: any) => p.overlayHandlers.planMove(sh, d, vb, ev),
        zoneClick: (ev: any) => p.overlayHandlers.zoneClick(sh, d, vb, ev),
        zoneDown: (ev: any) => p.overlayHandlers.zoneDown(sh, d, vb, ev),
        zoneUp: () => p.overlayHandlers.zoneUp(sh),
        zoneMove: (ev: any) => p.overlayHandlers.zoneMove(sh, d, vb, ev),
      }
      const overlay = renderOverlay(
        sh,
        d,
        m,
        vb,
        mm2du,
        anyActive,
        {
          sketchSel: p.sketchSel,
          sketchGhost: p.sketchGhost,
          zoneEdit: p.zoneEdit,
          zoneSel: p.zoneSel,
          zoneGhost: p.zoneGhost,
          noteSel: p.noteSel,
          noteAdding: p.noteAdding,
          notePend: p.notePend,
          hoverPt: p.hoverPt,
          marquee: p.marquee,
          selEnt: null,
          tool: p.tool,
        },
        H2,
      )
      plan = (
        <div style={{ width: pw.toFixed(2) + 'mm', height: ph.toFixed(2) + 'mm', flex: 'none', maxWidth: '100%', maxHeight: '100%', position: 'relative' }}>
          <div key="svg" style={{ position: 'absolute', inset: 0 }} dangerouslySetInnerHTML={{ __html: p.svgCache.current[key] }} />
          {overlay}
        </div>
      )
      const mmPerUnit = UM / sh.escala
      const steps = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200]
      const step = steps.find((st) => st * mmPerUnit >= 3.2 && st * mmPerUnit <= 7) || steps[steps.length - 1]
      sbSegMM = +(step * mmPerUnit).toFixed(2)
      sbSegs = [0, 1, 2, 3, 4].map((i) => ({ bg: i % 2 === 0 ? caj.fg : 'transparent' }))
      sbTotal = fmtNum(step * 5) + ' ' + d.unit
      void unitMM
    }

    const cajFields = doc.cajetin.map((f: any) => ({
      label: f.label,
      isEscala: f.src === 'escala',
      value:
        f.src === 'proyecto'
          ? doc.project.proyecto
          : f.src === 'arquitecto'
            ? doc.project.arquitecto || '—'
            : f.src === 'tipo'
              ? sh.tipo
              : f.src === 'fecha'
                ? fechaCorta
                : f.src === 'escala'
                  ? '1:' + sh.escala
                  : f.src === 'cliente'
                    ? (crm.cliente || {}).nombre || '—'
                    : f.src === 'feria'
                      ? crm.feria
                        ? [crm.feria.nombre, crm.feria.fechas].filter(Boolean).join(' · ')
                        : '—'
                      : f.value || '',
    }))
    const wEsc = plan ? Math.min(46, Math.max(22, sbSegMM * 5 + 11)) : 26
    const cajCols = '31mm ' + doc.cajetin.map((f: any) => (f.src === 'escala' ? wEsc.toFixed(1) + 'mm' : '1fr')).join(' ') + ' 23mm'

    const ley = sh.leyenda || { show: false, items: [] }
    const leyItems = (ley.items || []).map((it: any) => {
      const svgEl = glyphEl(it.sym)
      return { label: it.etiqueta || '', cant: it.cant != null && String(it.cant).trim() !== '' ? String(it.cant) : '', isSvg: !!svgEl, glEl: svgEl, ...(GLYPH[it.sym] || GLYPH.linea) }
    })
    const leyTitulo = String(ley.titulo || 'LEYENDA').toUpperCase()
    const balloonLegend: any[] = []
    let bn = 0
    ;(sh.notas || []).forEach((n: any) => {
      if ((n.style || 'dot') === 'balloon') {
        bn++
        balloonLegend.push({ n: String(bn).padStart(2, '0'), text: String(n.text || '—').toUpperCase() })
      }
    })
    const foldMarks: any[] = [],
      foldMarksH: any[] = []
    if (PLEGADO) {
      for (let fx = W - 210; fx > 15; fx -= 210) foldMarks.push({ x: fx.toFixed(1) })
      if (H > 300) for (let fy = H - 297; fy > 15; fy -= 297) foldMarksH.push({ y: fy.toFixed(1) })
    }

    return { sh, W, H, plan, sbSegs, sbSegMM, sbTotal, cajFields, cajCols, leyItems, leyTitulo, leyShow: !!(ley.show && leyItems.length), leyZoom: +(ley.tam || 1), balloonLegend, foldMarks, foldMarksH }
  }

  const pageName = (sh: Sheet) => (sh.size || 'A3').toLowerCase() + (sh.orient === 'p' ? 'p' : 'l')

  // Foliación
  const hasMemoria = doc.memoria.sections.length > 0
  const hasTables = doc.tables.some((t: any) => t.rows.length > 0)
  const hasAnexos = doc.anexos.length > 0
  const showPortada = doc.secciones.portada !== false
  const showIndice = doc.secciones.indice !== false
  const showMemoria = hasMemoria && doc.secciones.memoria !== false
  const showTablas = hasTables && doc.secciones.tablas !== false
  const showAnexos = hasAnexos && doc.secciones.anexos !== false
  let fol = showPortada ? 1 : 0
  const folInd = showIndice ? pad2(++fol) : ''
  const folMem = showMemoria ? pad2(++fol) : ''
  const folTab = showTablas ? pad2(++fol) : ''
  fol += inclSheets.length
  const folAnex = showAnexos ? pad2(++fol) : ''

  const indiceItems: any[] = []
  let ni = 1
  if (showMemoria) indiceItems.push({ num: pad2(ni++), label: 'Memoria descriptiva', meta: doc.memoria.sections.length + ' apartados', weight: 700, indent: '0mm' })
  if (showTablas) indiceItems.push({ num: pad2(ni++), label: 'Cuadros y tablas', meta: doc.tables.length + (doc.tables.length === 1 ? ' cuadro' : ' cuadros'), weight: 700, indent: '0mm' })
  if (inclSheets.length) {
    indiceItems.push({ num: pad2(ni++), label: 'Documentación gráfica', meta: inclSheets.length + (inclSheets.length === 1 ? ' plano' : ' planos'), weight: 700, indent: '0mm' })
    for (const sh of inclSheets) indiceItems.push({ num: '', label: sh.num + ' — ' + sh.tipo, meta: '1:' + sh.escala + ' · ' + sh.size, weight: 400, indent: '7mm' })
  }
  if (showAnexos) indiceItems.push({ num: pad2(ni++), label: 'Anexos fotográficos', meta: doc.anexos.length + ' figuras', weight: 700, indent: '0mm' })

  const hayPlanos = inclSheets.length > 0 && p.vista !== 'grid'

  // ---- grid reorder (HTML5 DnD) ----
  const renumberAll = (arr: Sheet[]) => {
    let n = 0
    return arr.map((sh) => {
      n++
      const mm = /^(.*?)(\d+)\s*$/.exec(String(sh.num || '').trim())
      const prefix = mm ? mm[1] : 'A-'
      const digits = Math.max(2, mm ? mm[2].length : 2)
      return { ...sh, num: prefix + String(n).padStart(digits, '0') }
    })
  }
  const dragId = React.useRef<string | null>(null)
  const gridReorder = (dstId: string) => {
    const from = dragId.current
    dragId.current = null
    if (!from || from === dstId) return
    const arr = [...doc.sheets]
    const i = arr.findIndex((x: Sheet) => x.id === from)
    const j = arr.findIndex((x: Sheet) => x.id === dstId)
    if (i < 0 || j < 0) return
    const [mv] = arr.splice(i, 1)
    arr.splice(j, 0, mv)
    p.up({ sheets: renumberAll(arr) })
  }

  return (
    <div id="approot" data-vista={p.vista} style={{ display: 'flex', flexDirection: 'row', height: '100vh', overflow: 'hidden', background: '#E8E6E1', color: '#17161A', fontFamily: SANS }}>
      <style>{`
        @keyframes gcspin { to { transform: rotate(360deg); } }
        @page { margin: 0; }
        @page docpg { size: 210mm 297mm; margin: 14mm 0; }
        #approot[data-vista="grid"] #zoomwrap { zoom: 0.16 !important; width: 100% !important; }
        #approot[data-vista="grid"] #pages { flex-direction: row !important; flex-wrap: wrap; gap: 150px; justify-content: center; align-items: flex-start; }
        #approot[data-vista="grid"] [data-page] { margin-bottom: 0 !important; }
        [data-sheet-id][data-sel="1"] { box-shadow: 0 0 0 4px #D6197E, 0 24px 60px rgba(23,22,26,0.2) !important; }
        #approot[data-vista="grid"] [data-sheet-id][data-sel="1"] { box-shadow: 0 0 0 16px #D6197E !important; }
        @media print {
          html, body { background: #fff !important; }
          [data-ui] { display: none !important; }
          #stage { overflow: visible !important; height: auto !important; padding: 0 !important; }
          #zoomwrap { zoom: 1 !important; }
          [data-page] { box-shadow: none !important; margin: 0 !important; }
          [data-noprint] { display: none !important; }
        }
      `}</style>

      {/* ========== SIDEBAR ========== */}
      <aside data-ui="1" style={{ width: 356, flex: 'none', display: 'flex', flexDirection: 'column', background: '#F7F6F3', borderRight: '1px solid ' + border }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 18px 12px' }}>
          <img src="/assets/logo.png" alt="Logo" style={{ width: 36, height: 'auto' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em' }}>Presentaciones CAD</div>
            <div style={{ fontFamily: MONO, fontSize: 9, color: muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>DXF → láminas · memoria · PDF</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '0 16px 10px', alignItems: 'center' }}>
          <Link to="/" title="Volver al listado de proyectos" style={{ flex: 'none', padding: '6px 10px', border: '1px solid ' + fieldBd, borderRadius: 7, fontSize: 11, fontWeight: 600, color: '#6E6B66', textDecoration: 'none', background: '#fff' }}>
            ← Inicio
          </Link>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: '#17161A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.projName}>
            {p.projName}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, padding: '0 16px 12px', flexWrap: 'wrap' }}>
          {TABS.map((tb) => {
            const on = p.tab === tb.id
            return (
              <button key={tb.id} onClick={() => p.setTab(tb.id)} style={{ padding: '6px 11px', borderRadius: 999, fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: MONO, border: '1px solid ' + (on ? '#17161A' : '#D8D5CE'), background: on ? '#17161A' : 'transparent', color: on ? '#fff' : '#6E6B66' }}>
                {tb.label}
              </button>
            )
          })}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 18px 34px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {p.tab === 'proyecto' && <ProyectoPanel p={p} caj={caj} />}
          {p.tab === 'planos' && <PlanosPanel p={p} />}
          {p.tab === 'leyendas' && <LeyendasPanel p={p} />}
          {p.tab === 'memoria' && <MemoriaPanel p={p} />}
          {p.tab === 'tablas' && <TablasPanel p={p} />}
          {p.tab === 'anexos' && <AnexosPanel p={p} />}
        </div>
      </aside>

      {/* ========== MAIN ========== */}
      <main id="maincol" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* top bar */}
        <div data-ui="1" style={{ minHeight: 58, flex: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', padding: '8px 60px 8px 22px', background: '#F7F6F3', borderBottom: '1px solid ' + border }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 'none' }}>
            <Link to="/" style={{ fontFamily: MONO, fontSize: 10, color: muted, textDecoration: 'none' }}>Proyectos</Link>
            <span style={{ color: '#C9C5BC', fontSize: 11 }}>›</span>
            <span title={p.projName} style={{ fontSize: 11.5, fontWeight: 700, color: '#17161A', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.projName}</span>
          </div>
          <div style={{ display: 'flex', gap: 2, background: '#ECEAE5', borderRadius: 8, padding: 3 }}>
            <Link to={'/venta/' + p.projectId} style={{ padding: '6px 12px', borderRadius: 6, color: '#6E6B66', fontSize: 11, fontWeight: 600, textDecoration: 'none' }}>Documento de venta</Link>
            <span style={{ padding: '6px 12px', borderRadius: 6, background: '#17161A', color: '#fff', fontSize: 11, fontWeight: 700 }}>Memoria y planos</span>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 9.5, color: muted, letterSpacing: '0.05em' }}>EXPORTACIÓN DIRECTA A PDF · 300 PPP</div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 2, background: '#ECEAE5', borderRadius: 8, padding: 3 }}>
            <button onClick={p.undoDo} title="Deshacer (Ctrl+Z)" style={{ border: 'none', borderRadius: 6, padding: '6px 10px', fontSize: 13, cursor: 'pointer', background: 'transparent', color: p.canUndo ? '#17161A' : '#C9C5BC', lineHeight: 1 }}>↶</button>
            <button onClick={p.redoDo} title="Rehacer (Ctrl+Y)" style={{ border: 'none', borderRadius: 6, padding: '6px 10px', fontSize: 13, cursor: 'pointer', background: 'transparent', color: p.canRedo ? '#17161A' : '#C9C5BC', lineHeight: 1 }}>↷</button>
          </div>
          <div style={{ display: 'flex', gap: 2, background: '#ECEAE5', borderRadius: 8, padding: 3 }}>
            <button onClick={() => p.setVista('doc')} style={{ border: 'none', borderRadius: 6, padding: '6px 11px', fontSize: 11, fontWeight: 600, cursor: 'pointer', background: p.vista === 'doc' ? '#17161A' : 'transparent', color: p.vista === 'doc' ? '#fff' : '#6E6B66' }}>Documento</button>
            <button onClick={() => p.setVista('grid')} style={{ border: 'none', borderRadius: 6, padding: '6px 11px', fontSize: 11, fontWeight: 600, cursor: 'pointer', background: p.vista === 'grid' ? '#17161A' : 'transparent', color: p.vista === 'grid' ? '#fff' : '#6E6B66' }}>Cuadrícula</button>
          </div>
          <span style={{ fontFamily: MONO, fontSize: 9.5, color: p.saving ? '#B07A1F' : '#1F8A5B', flex: 'none' }}>{p.saving ? 'Guardando…' : 'Guardado ✓'}</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: p.vista === 'grid' ? 0.35 : 1 }}>
            <span style={{ fontFamily: MONO, fontSize: 9.5, color: muted }}>ZOOM</span>
            <input type="range" min={0.25} max={1.4} step={0.05} value={p.zoom} onChange={(e) => p.setZoom(+e.target.value)} style={{ width: 110, accentColor: '#17161A' }} />
            <span style={{ fontFamily: MONO, fontSize: 10, color: '#17161A', width: 36 }}>{Math.round(p.zoom * 100) + '%'}</span>
          </label>
          <button onClick={p.doExportPdf} style={{ background: accent, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer', minWidth: 132 }}>{p.exporting || 'Exportar PDF'}</button>
        </div>

        {/* draw toolbar */}
        {hayPlanos && <DrawToolbar p={p} />}

        {/* notice toast */}
        {p.notice && (
          <div data-ui="1" style={{ position: 'fixed', left: 22, bottom: 22, zIndex: 96, background: '#17161A', color: '#fff', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 14px 44px rgba(23,22,26,0.4)', maxWidth: 460 }}>
            <span style={{ fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{p.notice}</span>
            {p.noticeUndo && (
              <button onClick={() => { p.clearNotice(); p.undoDo() }} style={{ border: '1px solid #3A3840', background: '#26252A', color: '#F5A6CF', borderRadius: 7, padding: '6px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', flex: 'none' }}>Deshacer</button>
            )}
            <button onClick={p.clearNotice} style={{ border: 'none', background: 'none', color: muted, fontSize: 15, cursor: 'pointer', padding: '2px 4px', flex: 'none' }}>×</button>
          </div>
        )}

        {/* context menu */}
        {p.ctxMenu && (
          <>
            <div data-ui="1" onClick={() => p.setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); p.setCtxMenu(null) }} style={{ position: 'fixed', inset: 0, zIndex: 97 }} />
            <div data-ui="1" style={{ position: 'fixed', left: Math.min(p.ctxMenu.x, (window.innerWidth || 1200) - 220), top: Math.min(p.ctxMenu.y, (window.innerHeight || 800) - 190), zIndex: 98, background: '#fff', border: '1px solid ' + border, borderRadius: 10, boxShadow: '0 18px 50px rgba(23,22,26,0.22)', padding: 6, display: 'flex', flexDirection: 'column', minWidth: 200 }}>
              <button onClick={() => { const cm = p.ctxMenu; p.setCtxMenu(null); if (cm) { p.dupSheet(cm.shId); p.toast('Plano duplicado.', true) } }} style={ctxBtn}>⧉&nbsp;&nbsp;Duplicar plano</button>
              <button onClick={() => { const cm = p.ctxMenu; p.setCtxMenu(null); if (cm) p.selectSheet(cm.shId, { goDoc: true }) }} style={ctxBtn}>👁&nbsp;&nbsp;Ver en documento</button>
              <div style={{ height: 1, background: '#EDEBE6', margin: '4px 8px' }} />
              <button onClick={() => { const cm = p.ctxMenu; p.setCtxMenu(null); if (cm) { p.up({ sheets: doc.sheets.filter((x: Sheet) => x.id !== cm.shId) }); p.toast('Plano eliminado.', true) } }} style={{ ...ctxBtn, color: '#C03A2B' }}>×&nbsp;&nbsp;Eliminar (con Deshacer)</button>
            </div>
          </>
        )}

        {/* stage */}
        <div id="stage" style={{ flex: 1, overflow: 'auto', padding: 36, background: '#E8E6E1' }}>
          <div id="zoomwrap" style={{ zoom: p.vista === 'grid' ? undefined : p.zoom, width: 'max-content', minWidth: '100%', margin: '0 auto' } as any}>
            <div id="pages" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {/* PORTADA */}
              {showPortada && p.vista !== 'grid' && <Portada doc={doc} accent={accent} fechaLarga={fechaLarga} />}
              {/* INDICE */}
              {showIndice && p.vista !== 'grid' && <Indice accent={accent} folInd={folInd} indiceItems={indiceItems} />}
              {/* MEMORIA */}
              {showMemoria && p.vista !== 'grid' && <MemoriaPage doc={doc} accent={accent} folMem={folMem} />}
              {/* TABLAS */}
              {showTablas && p.vista !== 'grid' && <TablasPage doc={doc} accent={accent} folTab={folTab} />}

              {/* SHEET PAGES */}
              {inclSheets.map((sh: Sheet) => {
                const sp = buildSheetPage(sh)
                const grid = p.vista === 'grid'
                return (
                  <div
                    key={sh.id}
                    data-page="1"
                    data-sheet-id={sh.id}
                    data-sel={p.selSheet === sh.id ? '1' : '0'}
                    draggable={grid}
                    onDragStart={grid ? () => (dragId.current = sh.id) : undefined}
                    onDragOver={grid ? (e) => e.preventDefault() : undefined}
                    onDrop={grid ? () => gridReorder(sh.id) : undefined}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); p.setCtxMenu({ x: e.clientX, y: e.clientY, shId: sh.id }) }}
                    onClick={(e) => {
                      const t = (e.target as any).tagName
                      if (t === 'INPUT' || t === 'BUTTON' || t === 'SELECT') return
                      if (grid) { p.selectSheet(sh.id); return }
                      if (p.tool || p.zoneEdit) return
                      if (p.selSheet !== sh.id) p.selectSheet(sh.id)
                    }}
                    onDoubleClick={(e) => {
                      const t = (e.target as any).tagName
                      if (t === 'INPUT' || t === 'BUTTON' || t === 'SELECT') return
                      if (grid) p.selectSheet(sh.id, { goDoc: true })
                    }}
                    style={{ width: sp.W + 'mm', height: sp.H + 'mm', flex: 'none', background: '#fff', boxShadow: '0 24px 60px rgba(23,22,26,0.16)', marginBottom: 36, position: 'relative', cursor: grid ? 'grab' : 'default' }}
                  >
                    {sp.foldMarks.map((fm: any, i: number) => (
                      <React.Fragment key={'fm' + i}>
                        <div style={{ position: 'absolute', top: 0, left: fm.x + 'mm', width: '0.15mm', height: '5mm', background: '#17161A' }} />
                        <div style={{ position: 'absolute', bottom: 0, left: fm.x + 'mm', width: '0.15mm', height: '5mm', background: '#17161A' }} />
                      </React.Fragment>
                    ))}
                    <div style={{ position: 'absolute', inset: '7mm', border: '0.35mm solid #17161A', display: 'flex', flexDirection: CAJ_POS === 'lateral' ? 'row' : 'column' }}>
                      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0, minHeight: 0, position: 'relative', marginBottom: CAJ_POS === 'lateral' ? '0mm' : '26mm' }}>
                        {sp.plan || (
                          <div style={{ border: '1px dashed #C9C5BC', borderRadius: '3mm', padding: '12mm 16mm', textAlign: 'center', fontFamily: MONO, fontSize: '9pt', lineHeight: 1.7, color: muted }}>
                            Sube un archivo DXF
                            <br />
                            para montar aquí el plano
                          </div>
                        )}
                        {sp.balloonLegend.length > 0 && (
                          <div style={{ position: 'absolute', bottom: '4mm', left: '4mm', background: '#fff', border: '0.25mm solid #17161A', padding: '2.5mm 3mm', display: 'flex', flexDirection: 'column', gap: '1.5mm', zIndex: 6, minWidth: '32mm' }}>
                            <div style={{ fontFamily: MONO, fontSize: '5.5pt', letterSpacing: '0.18em', color: '#17161A', fontWeight: 600, borderBottom: '0.2mm solid #17161A', paddingBottom: '1.2mm' }}>ETIQUETAS</div>
                            {sp.balloonLegend.map((bl: any, i: number) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '2.2mm' }}>
                                <div style={{ width: '4.4mm', height: '4.4mm', border: '0.25mm solid #17161A', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: '5pt', fontWeight: 600, flex: 'none' }}>{bl.n}</div>
                                <div style={{ fontSize: '6.5pt', color: '#17161A', lineHeight: 1.3 }}>{bl.text}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        {sp.leyShow && (
                          <div style={{ position: 'absolute', top: '4mm', right: '4mm', background: '#fff', border: '0.25mm solid #17161A', padding: '2.5mm 3mm', display: 'flex', flexDirection: 'column', gap: '1.6mm', zIndex: 6, minWidth: '26mm', zoom: sp.leyZoom } as any}>
                            <div style={{ fontFamily: MONO, fontSize: '5.5pt', letterSpacing: '0.18em', color: '#17161A', fontWeight: 600, borderBottom: '0.2mm solid #17161A', paddingBottom: '1.2mm' }}>{sp.leyTitulo}</div>
                            {sp.leyItems.map((ly: any, i: number) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '2.2mm' }}>
                                <div style={{ width: '6.6mm', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                                  {ly.isSvg ? ly.glEl : <div style={{ width: ly.gw, height: ly.gh, background: ly.gbg, backgroundImage: ly.gbgi, border: ly.gbd, borderRadius: ly.gbr, clipPath: ly.gclip }} />}
                                </div>
                                <div style={{ fontSize: '6.5pt', color: '#17161A', lineHeight: 1.3, flex: 1 }}>{ly.label}</div>
                                {ly.cant && <div style={{ fontFamily: MONO, fontSize: '6pt', color: '#17161A', fontWeight: 600, flex: 'none' }}>{ly.cant}</div>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* cajetín inferior */}
                      {CAJ_POS === 'inferior' && (
                        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 7, height: caj.h + 'mm', background: caj.bg, borderTop: '0.35mm solid ' + caj.bd, display: 'grid', gridTemplateColumns: sp.cajCols }}>
                          <div style={{ padding: '2mm 3mm', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '1.4mm', minWidth: 0, overflow: 'hidden' }}>
                            <img src="/assets/logo.png" alt="Logo" style={{ height: (caj.h * 0.58).toFixed(1) + 'mm', width: 'auto', maxWidth: '100%', objectFit: 'contain' }} />
                            <div style={{ fontFamily: MONO, fontSize: '5pt', letterSpacing: '0.12em', textTransform: 'uppercase', color: caj.fg2, textAlign: 'center' }}>{doc.project.empresa}</div>
                          </div>
                          {sp.cajFields.map((cf: any, i: number) => (
                            <div key={i} style={{ padding: '2.6mm 3mm', borderLeft: '0.2mm solid ' + caj.bd, display: 'flex', flexDirection: 'column', gap: '1.4mm', minWidth: 0, overflow: 'hidden' }}>
                              <span style={{ fontFamily: MONO, fontSize: '5pt', letterSpacing: '0.14em', color: caj.fg2, textTransform: 'uppercase' }}>{cf.label}</span>
                              <span style={{ fontSize: caj.fs + 'pt', color: caj.fg, fontWeight: 600, lineHeight: 1.35 }}>{cf.value}</span>
                              {cf.isEscala && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5mm' }}>
                                  <div style={{ display: 'flex', border: '0.2mm solid ' + caj.bd, height: '1.5mm' }}>
                                    {sp.sbSegs.map((sg: any, k: number) => (
                                      <div key={k} style={{ width: sp.sbSegMM + 'mm', background: sg.bg }} />
                                    ))}
                                  </div>
                                  <span style={{ fontFamily: MONO, fontSize: '5pt', color: caj.fg2, whiteSpace: 'nowrap' }}>{sp.sbTotal}</span>
                                </div>
                              )}
                            </div>
                          ))}
                          <div style={{ padding: '2.6mm 3mm', borderLeft: '0.35mm solid ' + caj.bd, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                            <span style={{ fontFamily: MONO, fontSize: '5pt', letterSpacing: '0.14em', color: caj.fg2 }}>Nº PLANO</span>
                            <span style={{ fontSize: '15pt', fontWeight: 800, letterSpacing: '-0.02em', color: accent }}>{sh.num}</span>
                          </div>
                        </div>
                      )}
                    </div>
                    {/* grid bar (rename/dup/del) */}
                    {grid && (
                      <div data-noprint="1" style={{ position: 'absolute', top: 0, left: 0, width: '100%', display: 'flex', alignItems: 'center', gap: 45, padding: '55px 60px', background: 'rgba(255,255,255,0.94)', borderBottom: '6px solid ' + border, zIndex: 20 }}>
                        <span style={{ color: '#B4B0A8', fontSize: 80, cursor: 'grab', flex: 'none', lineHeight: 1 }}>⠿</span>
                        <input value={sh.num} onChange={(e) => p.upSheet(sh.id, { num: e.target.value })} onMouseDown={(e) => e.stopPropagation()} style={{ width: 400, flex: 'none', padding: '36px 42px', border: '6px solid ' + fieldBd, borderRadius: 36, fontSize: 72, fontFamily: MONO, fontWeight: 600, background: '#fff' }} />
                        <input value={sh.tipo} onChange={(e) => p.upSheet(sh.id, { tipo: e.target.value })} onMouseDown={(e) => e.stopPropagation()} style={{ flex: 1, minWidth: 0, padding: '36px 48px', border: '6px solid ' + fieldBd, borderRadius: 36, fontSize: 72, background: '#fff' }} />
                        <button onClick={() => p.dupSheet(sh.id)} style={{ border: '6px solid ' + fieldBd, background: '#fff', borderRadius: 36, width: 160, height: 160, fontSize: 66, cursor: 'pointer', color: '#17161A', flex: 'none' }}>⧉</button>
                        <button onClick={() => p.delSheetConfirm(sh.id)} style={{ border: 'none', background: p.shDelPend === sh.id ? '#C03A2B' : 'transparent', color: p.shDelPend === sh.id ? '#fff' : '#B4B0A8', fontSize: p.shDelPend === sh.id ? 52 : 96, fontWeight: 700, borderRadius: 24, cursor: 'pointer', padding: '12px 24px', flex: 'none', lineHeight: 1 }}>{p.shDelPend === sh.id ? '¿Eliminar?' : '×'}</button>
                      </div>
                    )}
                  </div>
                )
              })}

              {/* add sheet card in grid */}
              {p.vista === 'grid' && (
                <div data-noprint="1" onClick={p.addSheet} title="Añadir un plano nuevo" style={{ width: '420mm', height: '297mm', flex: 'none', border: '10px dashed #C9C5BC', borderRadius: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#B4B0A8', fontSize: 520, fontWeight: 300, background: 'rgba(255,255,255,0.45)' }}>+</div>
              )}

              {/* ANEXOS */}
              {showAnexos && p.vista !== 'grid' && <AnexosPage p={p} doc={doc} accent={accent} folAnex={folAnex} />}
            </div>
          </div>
        </div>

        {/* plan bar (bottom) */}
        <PlanBar p={p} />
      </main>
    </div>
  )
}

const ctxBtn: React.CSSProperties = { border: 'none', background: 'none', textAlign: 'left', padding: '9px 12px', fontSize: 12.5, color: '#17161A', borderRadius: 7, cursor: 'pointer' }

// ---- static document pages ----
function Portada({ doc, accent, fechaLarga }: any) {
  return (
    <div data-page="1" style={{ width: '210mm', height: '297mm', flex: 'none', background: '#fff', boxShadow: '0 24px 60px rgba(23,22,26,0.16)', marginBottom: 36, display: 'flex', flexDirection: 'column', padding: '22mm' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <img src="/assets/logo.png" alt="Logo" style={{ height: '15mm', width: 'auto' }} />
        <div style={{ fontFamily: MONO, fontSize: '8pt', letterSpacing: '0.22em', color: muted }}>MEMORIA · PLANOS · ANEXOS</div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '8mm' }}>
        <div style={{ width: '26mm', height: '2.6mm', background: accent }} />
        <div style={{ fontSize: '33pt', fontWeight: 800, lineHeight: 1.06, letterSpacing: '-0.02em', maxWidth: '155mm' }}>{doc.project.proyecto}</div>
        <div style={{ fontFamily: MONO, fontSize: '10pt', textTransform: 'uppercase', letterSpacing: '0.18em', color: '#6E6B66' }}>{doc.project.subtitulo}</div>
      </div>
      <div style={{ borderTop: '0.4mm solid #17161A', paddingTop: '6mm', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6mm' }}>
        {[['ARQUITECTO', doc.project.arquitecto || '—'], ['EMPRESA', doc.project.empresa], ['FECHA', fechaLarga]].map((r, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '1.6mm' }}>
            <span style={{ fontFamily: MONO, fontSize: '6.5pt', letterSpacing: '0.16em', color: muted }}>{r[0]}</span>
            <span style={{ fontSize: '10.5pt', fontWeight: 600 }}>{r[1]}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: '6mm', fontFamily: MONO, fontSize: '6.5pt', letterSpacing: '0.06em', color: muted }}>{doc.project.contacto}</div>
    </div>
  )
}
function Indice({ accent, folInd, indiceItems }: any) {
  return (
    <div data-page="1" data-docpage="1" style={{ width: '210mm', minHeight: '297mm', flex: 'none', background: '#fff', boxShadow: '0 24px 60px rgba(23,22,26,0.16)', marginBottom: 36, padding: '20mm 22mm', position: 'relative' }}>
      <div style={{ position: 'absolute', bottom: '8mm', right: '10mm', fontFamily: MONO, fontSize: '7pt', letterSpacing: '0.14em', color: muted }}>PÁG. {folInd}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4mm' }}>
        <div style={{ width: '3mm', height: '3mm', background: accent }} />
        <div style={{ fontFamily: MONO, fontSize: '8pt', letterSpacing: '0.2em', color: muted }}>CONTENIDO DEL DOCUMENTO</div>
      </div>
      <div style={{ fontSize: '22pt', fontWeight: 800, margin: '5mm 0 10mm', letterSpacing: '-0.01em' }}>Índice</div>
      {indiceItems.map((ii: any, i: number) => (
        <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: '5mm', padding: '3.2mm 0', borderBottom: '0.2mm solid #E4E1DA' }}>
          <div style={{ fontFamily: MONO, fontSize: '9pt', color: '#17161A', width: '10mm', flex: 'none', fontWeight: 600 }}>{ii.num}</div>
          <div style={{ fontSize: '11pt', flex: 1, fontWeight: ii.weight, paddingLeft: ii.indent }}>{ii.label}</div>
          <div style={{ fontFamily: MONO, fontSize: '7.5pt', color: muted }}>{ii.meta}</div>
        </div>
      ))}
    </div>
  )
}
function MemoriaPage({ doc, accent, folMem }: any) {
  return (
    <div data-page="1" data-docpage="1" style={{ width: '210mm', minHeight: '297mm', flex: 'none', background: '#fff', boxShadow: '0 24px 60px rgba(23,22,26,0.16)', marginBottom: 36, padding: '20mm 22mm', position: 'relative' }}>
      <div style={{ position: 'absolute', bottom: '8mm', right: '10mm', fontFamily: MONO, fontSize: '7pt', letterSpacing: '0.14em', color: muted }}>PÁG. {folMem}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4mm' }}>
        <div style={{ width: '3mm', height: '3mm', background: accent }} />
        <div style={{ fontFamily: MONO, fontSize: '8pt', letterSpacing: '0.2em', color: muted }}>01 · MEMORIA</div>
      </div>
      <div style={{ fontSize: '22pt', fontWeight: 800, margin: '5mm 0 4mm', letterSpacing: '-0.01em' }}>Memoria descriptiva</div>
      {doc.memoria.sections.map((ms: any, i: number) => (
        <div key={i} style={{ marginTop: '8mm' }}>
          <div style={{ display: 'flex', gap: '4mm', alignItems: 'baseline' }}>
            <span style={{ fontFamily: MONO, fontSize: '9pt', fontWeight: 600, color: accent }}>{pad2(i + 1)}</span>
            <span style={{ fontSize: '13pt', fontWeight: 700 }}>{ms.titulo}</span>
          </div>
          <div style={{ fontSize: '10.5pt', lineHeight: 1.72, marginTop: '3mm', whiteSpace: 'pre-wrap', color: '#26252A', textAlign: 'justify' }}>{ms.contenido}</div>
        </div>
      ))}
    </div>
  )
}
function TablasPage({ doc, accent, folTab }: any) {
  return (
    <div data-page="1" data-docpage="1" style={{ width: '210mm', minHeight: '297mm', flex: 'none', background: '#fff', boxShadow: '0 24px 60px rgba(23,22,26,0.16)', marginBottom: 36, padding: '20mm 22mm', position: 'relative' }}>
      <div style={{ position: 'absolute', bottom: '8mm', right: '10mm', fontFamily: MONO, fontSize: '7pt', letterSpacing: '0.14em', color: muted }}>PÁG. {folTab}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4mm' }}>
        <div style={{ width: '3mm', height: '3mm', background: accent }} />
        <div style={{ fontFamily: MONO, fontSize: '8pt', letterSpacing: '0.2em', color: muted }}>02 · CUADROS</div>
      </div>
      <div style={{ fontSize: '22pt', fontWeight: 800, margin: '5mm 0 2mm', letterSpacing: '-0.01em' }}>Cuadros y tablas</div>
      {doc.tables.map((tg: any) => (
        <div key={tg.id} style={{ marginTop: '10mm' }}>
          <div style={{ fontSize: '12.5pt', fontWeight: 700, marginBottom: '4mm' }}>{tg.titulo}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {tg.cols.map((c: string, i: number) => (
                  <th key={i} style={{ textAlign: 'left', fontFamily: MONO, fontSize: '7.5pt', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#6E6B66', borderBottom: '0.5mm solid #17161A', padding: '2.6mm 2mm', fontWeight: 600 }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tg.rows.map((r: string[], ri: number) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} style={{ borderBottom: '0.2mm solid #E4E1DA', padding: '2.6mm 2mm', fontSize: '10pt' }}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
function AnexosPage({ p, doc, accent, folAnex }: any) {
  const onSlot = async (a: any, ev: any) => {
    const file = (ev.target.files || ev.dataTransfer?.files || [])[0]
    if (ev.target) ev.target.value = ''
    if (!file) return
    const { fileToDataURL } = await import('./helpers')
    const src = await fileToDataURL(file, 1600)
    p.up({ anexos: doc.anexos.map((x: any) => (x.id === a.id ? { ...x, src } : x)) })
  }
  return (
    <div data-page="1" data-docpage="1" style={{ width: '210mm', minHeight: '297mm', flex: 'none', background: '#fff', boxShadow: '0 24px 60px rgba(23,22,26,0.16)', marginBottom: 36, padding: '20mm 22mm', position: 'relative' }}>
      <div style={{ position: 'absolute', bottom: '8mm', right: '10mm', fontFamily: MONO, fontSize: '7pt', letterSpacing: '0.14em', color: muted }}>PÁG. {folAnex}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4mm' }}>
        <div style={{ width: '3mm', height: '3mm', background: accent }} />
        <div style={{ fontFamily: MONO, fontSize: '8pt', letterSpacing: '0.2em', color: muted }}>ANEXOS</div>
      </div>
      <div style={{ fontSize: '22pt', fontWeight: 800, margin: '5mm 0 8mm', letterSpacing: '-0.01em' }}>Anexos fotográficos</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8mm' }}>
        {doc.anexos.map((a: any, ix: number) => (
          <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: '2.5mm' }}>
            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onSlot(a, e) }}
              style={{ width: '100%', height: '68mm', display: 'block', background: '#F4F2EE', borderRadius: '2mm', overflow: 'hidden', cursor: 'pointer', position: 'relative' }}
            >
              {a.src ? (
                <img src={a.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: '7.5pt', color: muted, textAlign: 'center', padding: '4mm' }}>{'Fig. ' + pad2(ix + 1) + ' — arrastra una imagen aquí'}</span>
              )}
              <input type="file" accept="image/*" onChange={(e) => onSlot(a, e)} style={{ display: 'none' }} />
            </label>
            <div style={{ fontFamily: MONO, fontSize: '7.5pt', color: '#55524D', lineHeight: 1.5 }}>{'Fig. ' + pad2(ix + 1) + '. ' + (a.caption || 'Sin título')}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ================= SIDEBAR PANELS =================
function labelCol(text: string) {
  return <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: muted }}>{text}</span>
}
const card: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, padding: 12, border: '1px solid ' + border, borderRadius: 10, background: '#fff' }
const inp: React.CSSProperties = { padding: '9px 11px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 13, background: '#fff', color: '#17161A', outline: 'none', width: '100%' }
const btnDark: React.CSSProperties = { border: '1px solid #17161A', background: '#17161A', color: '#fff', borderRadius: 6, padding: '5px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }
const IA_STAR = <svg width={10} height={10} viewBox="0 0 24 24" fill="currentColor" style={{ flex: 'none' }}><path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2z" /></svg>

function ProyectoPanel({ p, caj }: any) {
  const doc = p.doc
  const pf = (key: string, label: string, type?: string) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {labelCol(label)}
      <input type={type || 'text'} value={doc.project[key] || ''} onChange={(e) => p.up({ project: { ...doc.project, [key]: e.target.value } })} style={inp} />
    </label>
  )
  const SEC_LABELS: any = { portada: 'Portada', indice: 'Índice', memoria: 'Memoria', tablas: 'Cuadros y tablas', anexos: 'Anexos fotográficos' }
  const srcOptions = [
    { v: 'proyecto', label: 'Proyecto' }, { v: 'arquitecto', label: 'Arquitecto / diseño' }, { v: 'tipo', label: 'Tipo de plano' }, { v: 'fecha', label: 'Fecha' }, { v: 'cliente', label: 'Cliente (del CRM)' }, { v: 'feria', label: 'Feria (del CRM)' }, { v: 'escala', label: 'Escala (con escala gráfica)' }, { v: 'custom', label: 'Texto fijo' },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {pf('proyecto', 'Proyecto')}
      {pf('subtitulo', 'Subtítulo / tipo de documento')}
      {pf('arquitecto', 'Arquitecto')}
      {pf('empresa', 'Empresa')}
      {pf('contacto', 'Contacto (portada)')}
      {pf('fecha', 'Fecha', 'date')}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, border: '1px solid ' + border, borderRadius: 10, background: '#fff' }}>
        <img src="/assets/logo.png" alt="Logo empresa" style={{ width: 44, height: 'auto', flex: 'none' }} />
        <div style={{ fontSize: 12, lineHeight: 1.5, color: '#6E6B66' }}>Logo cargado. Se usa en la portada y en el cajetín de cada lámina.</div>
      </div>

      <div style={{ borderTop: '1px solid ' + border, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 9 }}>
        {labelCol('Contenido al imprimir')}
        {Object.keys(SEC_LABELS).map((k) => (
          <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5, cursor: 'pointer', color: '#17161A' }}>
            <input type="checkbox" checked={doc.secciones[k] !== false} onChange={(e) => p.up({ secciones: { ...doc.secciones, [k]: e.target.checked } })} style={{ accentColor: '#D6197E', width: 15, height: 15, cursor: 'pointer' }} />
            <span>{SEC_LABELS[k]}</span>
          </label>
        ))}
        <div style={{ fontSize: 10.5, color: muted, lineHeight: 1.5 }}>Los planos se activan lámina a lámina en la pestaña Planos.</div>
      </div>

      <div style={{ borderTop: '1px solid ' + border, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 9 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {labelCol('Campos del cajetín')}
          <button onClick={() => p.up({ seq: doc.seq + 1, cajetin: [...doc.cajetin, { id: 'cf' + doc.seq, label: 'CAMPO', src: 'custom', value: '' }] })} style={btnDark}>+ Campo</button>
        </div>
        {doc.cajetin.map((f: any) => (
          <div key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, border: '1px solid ' + border, borderRadius: 8, background: '#fff' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input value={f.label} onChange={(e) => p.up({ cajetin: doc.cajetin.map((x: any) => (x.id === f.id ? { ...x, label: e.target.value } : x)) })} style={{ flex: 1, minWidth: 0, padding: '7px 8px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 10.5, fontFamily: MONO, textTransform: 'uppercase', letterSpacing: '0.06em', background: '#fff' }} />
              <select value={f.src} onChange={(e) => p.up({ cajetin: doc.cajetin.map((x: any) => (x.id === f.id ? { ...x, src: e.target.value } : x)) })} style={{ padding: '7px 8px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 12, background: '#fff', flex: 'none' }}>
                {srcOptions.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
              <button onClick={() => p.up({ cajetin: doc.cajetin.filter((x: any) => x.id !== f.id) })} style={{ border: 'none', background: 'none', color: '#B4B0A8', fontSize: 17, cursor: 'pointer', padding: '6px 10px' }}>×</button>
            </div>
            {f.src === 'custom' && <input value={f.value || ''} onChange={(e) => p.up({ cajetin: doc.cajetin.map((x: any) => (x.id === f.id ? { ...x, value: e.target.value } : x)) })} placeholder="Texto fijo del campo" style={{ padding: '7px 8px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 12, background: '#fff', width: '100%' }} />}
          </div>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: 10, border: '1px solid ' + border, borderRadius: 8, background: '#fff' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {labelCol('Tamaño de letra')}
            <select value={caj.fs} onChange={(e) => p.up({ cajStyle: { ...doc.cajStyle, fs: parseFloat(e.target.value) } })} style={{ padding: '7px 8px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 12, background: '#fff' }}>
              {[6, 6.5, 7, 7.5, 8, 9, 10, 11].map((v) => <option key={v} value={v}>{String(v).replace('.', ',') + ' pt'}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {labelCol('Color de fondo')}
            <input type="color" value={caj.bg} onChange={(e) => p.up({ cajStyle: { ...doc.cajStyle, bg: e.target.value } })} style={{ width: '100%', height: 32, padding: 2, border: '1px solid ' + fieldBd, borderRadius: 6, background: '#fff', cursor: 'pointer' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
            {labelCol('Altura del cajetín · ' + caj.h + ' mm')}
            <input type="range" min={18} max={40} step={1} value={caj.h} onChange={(e) => p.up({ cajStyle: { ...doc.cajStyle, h: parseInt(e.target.value, 10) } })} style={{ width: '100%', accentColor: '#D6197E' }} />
          </label>
        </div>
        <div style={{ fontSize: 10.5, color: muted, lineHeight: 1.5 }}>El logo y el nº de plano son fijos; el resto de campos se pueden añadir, quitar y renombrar.</div>
      </div>
    </div>
  )
}

function PlanosPanel({ p }: any) {
  const doc = p.doc
  const unitOptions = [{ v: 'm', label: 'metros' }, { v: 'cm', label: 'cm' }, { v: 'mm', label: 'mm' }]
  const escalaOptions = ESCALAS.map((n) => ({ v: n, label: '1:' + n }))
  const sizeOptions = ['A4', 'A3', 'A2', 'A1']
  const orientOptions = [{ v: 'l', label: 'Horizontal' }, { v: 'p', label: 'Vertical' }]
  const drawingOptions = [{ v: '', label: '— sin plano —' }, ...doc.drawings.map((d: any) => ({ v: d.id, label: d.name }))]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: '22px 14px', border: '1.5px dashed #C9C5BC', borderRadius: 10, background: '#fff', cursor: 'pointer', textAlign: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Añadir archivo CAD</span>
        <span style={{ fontFamily: MONO, fontSize: 9.5, color: muted, letterSpacing: '0.06em' }}>.DXF (recomendado) · .DWG</span>
        <input type="file" accept=".dxf,.DXF,.dwg,.DWG" multiple onChange={p.onFile} style={{ display: 'none' }} />
      </label>
      <div style={{ border: '1px solid ' + border, background: '#fff', borderRadius: 8, padding: '11px 13px', fontSize: 11.5, lineHeight: 1.65, color: '#6E6B66' }}>
        <strong style={{ color: '#17161A' }}>Detección automática de láminas.</strong> Dibuja un rectángulo cerrado (RECTANG) alrededor de cada plano con las medidas del papel a escala: p. ej. <span style={{ fontFamily: MONO, fontSize: 10, color: '#17161A' }}>42 × 29,7 m → A3 horizontal · 1:100</span>. Mejor si va en una capa <span style={{ fontFamily: MONO, fontSize: 10, color: '#17161A' }}>*NO-PLOT*</span>: nunca se imprime.
      </div>
      <details style={{ border: '1px solid ' + border, background: '#fff', borderRadius: 8, padding: '10px 13px' }}>
        <summary style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: muted, cursor: 'pointer' }}>Capas de detección automática</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {labelCol('Capas de marcos de lámina')}
            <input value={doc.capasCfg.marcos || ''} onChange={(e) => p.up({ capasCfg: { ...doc.capasCfg, marcos: e.target.value } })} style={{ ...inp, fontFamily: MONO, fontSize: 11.5 }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {labelCol('Capas de rotulación')}
            <input value={doc.capasCfg.rotulos || ''} onChange={(e) => p.up({ capasCfg: { ...doc.capasCfg, rotulos: e.target.value } })} style={{ ...inp, fontFamily: MONO, fontSize: 11.5 }} />
          </label>
          <div style={{ fontSize: 10.5, color: muted, lineHeight: 1.5 }}>El nombre de la capa debe coincidir EXACTAMENTE; varios separados por comas.</div>
        </div>
      </details>

      {labelCol('Dibujos cargados')}
      {doc.drawings.map((d: any) => {
        const m = p.models.current[d.id]
        return (
          <div key={d.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', border: '1px solid ' + border, borderRadius: 10, background: '#fff' }}>
            <DrawingThumb p={p} d={d} m={m} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
                <div style={{ fontFamily: MONO, fontSize: 9.5, color: muted }}>{m ? m.n + ' entidades · ' + fmtNum(m.bounds.w) + ' × ' + fmtNum(m.bounds.h) + ' ' + d.unit : '…'}</div>
              </div>
              <button onClick={() => p.detectar(d.id)} title="Buscar marcos de lámina dibujados" style={{ border: '1px solid ' + fieldBd, background: '#fff', borderRadius: 6, padding: '5px 8px', fontSize: 10.5, fontWeight: 600, cursor: 'pointer', color: '#17161A', flex: 'none' }}>Detectar láminas</button>
              <select value={d.unit} onChange={(e) => p.up({ drawings: doc.drawings.map((x: any) => (x.id === d.id ? { ...x, unit: e.target.value } : x)) })} style={{ padding: '6px 8px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 12, background: '#fff' }}>
                {unitOptions.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
              <button onClick={() => { delete p.models.current[d.id]; p.up({ drawings: doc.drawings.filter((x: any) => x.id !== d.id), sheets: doc.sheets.filter((sh: any) => !(sh.auto && sh.drawingId === d.id)).map((sh: any) => (sh.drawingId === d.id ? { ...sh, drawingId: '' } : sh)) }) }} title="Eliminar dibujo" style={{ border: 'none', background: 'none', color: '#B4B0A8', fontSize: 17, cursor: 'pointer', padding: '6px 10px' }}>×</button>
            </div>
          </div>
        )
      })}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
        {labelCol('Láminas')}
        <button onClick={p.addSheet} style={btnDark}>+ Lámina</button>
      </div>

      {doc.sheets.map((sh: any) => {
        const d = doc.drawings.find((x: any) => x.id === sh.drawingId)
        const m = d && p.models.current[d.id]
        let warn = false, warnMsg = ''
        if (m) {
          const { vw, vh } = p.viewport(sh.size, sh.orient)
          const { pw, ph } = p.planSizeMM(m, d.unit, sh.escala, sh.region)
          if (pw > vw - 2 || ph > vh - 2) { warn = true; warnMsg = 'No cabe a 1:' + sh.escala + ' en ' + sh.size }
        }
        const sel = p.selSheet === sh.id
        return (
          <div key={sh.id} onClick={(e) => { const t = (e.target as any).tagName; if (['INPUT', 'BUTTON', 'SELECT', 'SUMMARY', 'TEXTAREA'].includes(t)) return; p.selectSheet(sh.id) }} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, border: '1.5px solid ' + (sel ? '#D6197E' : border), borderRadius: 10, background: sel ? '#FDF4F9' : '#fff', cursor: 'pointer' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 'none', justifyContent: 'center' }}>
                <button onClick={() => p.moveSheet(sh.id, -1)} style={arrowBtn}>▲</button>
                <button onClick={() => p.moveSheet(sh.id, 1)} style={arrowBtn}>▼</button>
              </div>
              <input value={sh.num} onChange={(e) => p.upSheet(sh.id, { num: e.target.value })} style={{ width: 74, flex: 'none', padding: '8px 9px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 12, fontFamily: MONO, fontWeight: 600, background: '#fff' }} />
              <input value={sh.tipo} onChange={(e) => p.upSheet(sh.id, { tipo: e.target.value })} style={{ flex: 1, minWidth: 0, padding: '8px 9px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 12, background: '#fff' }} />
              <button onClick={() => p.delSheetConfirm(sh.id)} style={{ border: 'none', background: p.shDelPend === sh.id ? '#C03A2B' : 'transparent', color: p.shDelPend === sh.id ? '#fff' : '#B4B0A8', fontSize: p.shDelPend === sh.id ? 10.5 : 16, fontWeight: 700, borderRadius: 6, cursor: 'pointer', padding: p.shDelPend === sh.id ? '4px 8px' : '2px 4px', flex: 'none', alignSelf: 'flex-start' }}>{p.shDelPend === sh.id ? '¿Eliminar?' : '×'}</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <select value={sh.drawingId || ''} onChange={(e) => p.upSheet(sh.id, { drawingId: e.target.value })} style={selSt}>
                {drawingOptions.map((o: any) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
              <select value={sh.escala} onChange={(e) => p.upSheet(sh.id, { escala: +e.target.value })} style={selSt}>
                {escalaOptions.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
              <select value={sh.size} onChange={(e) => p.upSheet(sh.id, { size: e.target.value })} style={selSt}>
                {sizeOptions.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              <select value={sh.orient} onChange={(e) => p.upSheet(sh.id, { orient: e.target.value })} style={selSt}>
                {orientOptions.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#6E6B66', cursor: 'pointer', flex: 'none' }}>
                <input type="checkbox" checked={sh.incluir !== false} onChange={(e) => p.upSheet(sh.id, { incluir: e.target.checked })} style={{ accentColor: '#D6197E', width: 14, height: 14, cursor: 'pointer' }} />
                <span>Imprimir</span>
              </label>
              {sh.auto && <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '0.08em', color: '#fff', background: '#17161A', borderRadius: 4, padding: '2px 6px', flex: 'none' }}>AUTO</span>}
              <span style={{ flex: 1, minWidth: 0 }} />
              <button onClick={() => p.setZoneEdit(p.zoneEdit === sh.id ? null : sh.id)} title="Rotulación: incrusta imágenes en zonas del plano" style={{ border: '1px solid ' + (p.zoneEdit === sh.id ? '#D6197E' : fieldBd), background: p.zoneEdit === sh.id ? '#D6197E' : '#fff', color: p.zoneEdit === sh.id ? '#fff' : '#17161A', borderRadius: 6, padding: '5px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flex: 'none' }}>{p.zoneEdit === sh.id ? 'Terminar rotulación' : 'Rotular'}</button>
              <button onClick={() => { if (m && d) p.upSheet(sh.id, { escala: p.suggestScale(m, d.unit, sh.size, sh.orient, sh.region) }) }} title="Mayor escala normalizada que cabe" style={{ border: '1px solid ' + fieldBd, background: '#fff', borderRadius: 6, padding: '5px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#17161A', whiteSpace: 'nowrap', flex: 'none' }}>Ajustar escala</button>
              <button onClick={() => p.dupSheet(sh.id)} title="Duplicar lámina" style={{ border: '1px solid ' + fieldBd, background: '#fff', borderRadius: 6, width: 26, height: 26, fontSize: 11, cursor: 'pointer', color: '#17161A', flex: 'none' }}>⧉</button>
            </div>
            {warn && <div style={{ fontFamily: MONO, fontSize: 9.5, color: '#B0447E', fontWeight: 600, lineHeight: 1.5, background: '#FBF1F6', border: '1px solid #E7C6D8', borderRadius: 6, padding: '6px 9px' }}>⚠ {warnMsg} — usa «Ajustar escala»</div>}
            {(sh.zonas || []).length > 0 && (
              <details style={{ borderTop: '1px dashed ' + border, paddingTop: 7 }}>
                <summary style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: muted, cursor: 'pointer' }}>Zonas de rotulación</summary>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8 }}>
                  {(sh.zonas || []).map((z: any, zi: number) => (
                    <div key={zi} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: z.src ? '#1F8A5B' : '#C9C5BC', flex: 'none' }} title={z.src ? 'con gráfico' : 'sin gráfico'} />
                      <input value={z.name || 'Zona ' + (zi + 1)} onChange={(e) => p.updZona(sh.id, zi, { name: e.target.value }, true)} style={{ flex: 1, minWidth: 0, padding: '6px 8px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 11.5, background: '#fff' }} />
                      <button onClick={() => { p.setZoneEdit(sh.id); p.setZoneSel({ shId: sh.id, idx: zi }) }} style={{ border: '1px solid ' + fieldBd, background: '#fff', borderRadius: 5, width: 24, height: 24, fontSize: 11, cursor: 'pointer', color: '#17161A', flex: 'none' }}>→</button>
                      <button onClick={() => p.updZona(sh.id, zi, null, true)} style={{ border: 'none', background: 'none', color: '#B4B0A8', fontSize: 14, cursor: 'pointer', padding: 0, flex: 'none' }}>×</button>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {m && m.layers.length > 1 && (
              <details style={{ borderTop: '1px dashed ' + border, paddingTop: 7 }}>
                <summary style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: muted, cursor: 'pointer' }}>Capas del plano</summary>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 8 }}>
                  {m.layers.filter((ly: string) => !/NO.?PLOT|DEFPOINTS/i.test(ly) && !p.isRotulLayer(ly)).map((ly: string) => (
                    <label key={ly} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, cursor: 'pointer', fontFamily: MONO }}>
                      <input type="checkbox" checked={!(sh.capasOcultas || []).includes(ly)} onChange={(e) => { const cur = new Set(sh.capasOcultas || []); if (e.target.checked) cur.delete(ly); else cur.add(ly); p.upSheet(sh.id, { capasOcultas: [...cur] }) }} style={{ accentColor: '#D6197E', width: 13, height: 13, cursor: 'pointer' }} />
                      <span>{ly}</span>
                    </label>
                  ))}
                </div>
              </details>
            )}
          </div>
        )
      })}
    </div>
  )
}
const arrowBtn: React.CSSProperties = { border: '1px solid ' + fieldBd, background: '#fff', borderRadius: 5, width: 20, height: 16, fontSize: 7, cursor: 'pointer', color: '#6E6B66', padding: 0, lineHeight: 1 }
const selSt: React.CSSProperties = { padding: '7px 8px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 12, background: '#fff', minWidth: 0 }

function DrawingThumb({ p, d, m }: any) {
  if (!m) return null
  if (!p.thumbCache.current[d.id]) p.thumbCache.current[d.id] = buildSVG(m.ents, m.bounds, { stroke: Math.max(m.bounds.w, m.bounds.h) / 350, color: '#55524D' })
  const fk = d.id + '|' + d.unit + '|' + (p.doc.capasCfg.marcos || '') + '|' + (p.doc.capasCfg.rotulos || '')
  if (!p.framesCache.current[fk]) p.framesCache.current[fk] = detectFrames(m, d.unit, (ly: string) => p.isMarcoLayer(ly)) || []
  const frames = p.framesCache.current[fk]
  const b = m.bounds
  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: String(Math.max(0.4, Math.min(3.4, b.w / b.h))), maxHeight: 150, background: '#FAF9F7', borderRadius: 6, overflow: 'hidden', border: '1px solid #EAE8E2' }}>
      <div style={{ position: 'absolute', inset: 0 }} dangerouslySetInnerHTML={{ __html: p.thumbCache.current[d.id] }} />
      {frames.map((f: any, i: number) => (
        <div key={i} style={{ position: 'absolute', left: ((f.minX - b.minX) / b.w) * 100 + '%', top: ((b.maxY - f.maxY) / b.h) * 100 + '%', width: (f.w / b.w) * 100 + '%', height: (f.h / b.h) * 100 + '%', border: '1.5px solid #D6197E', background: 'rgba(214,25,126,0.05)' }}>
          <span style={{ position: 'absolute', top: 0, left: 0, fontSize: 8, fontFamily: MONO, background: '#D6197E', color: '#fff', padding: '0 3px', whiteSpace: 'nowrap' }}>{f.size + ' · 1:' + f.escala}</span>
        </div>
      ))}
    </div>
  )
}

function LeyendasPanel({ p }: any) {
  const doc = p.doc
  const leyLib = getLeyLib()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 11.5, lineHeight: 1.55, color: '#6E6B66' }}>Cada lámina puede llevar su leyenda (esquina superior derecha del plano). La IA la propone leyendo capas y rótulos; guárdala en la biblioteca para reutilizarla.</div>
      {doc.sheets.map((sh: any) => {
        const ley = sh.leyenda || { show: false, items: [] }
        const nm = p.leyNames[sh.id] || ''
        return (
          <div key={sh.id} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sh.num + ' — ' + sh.tipo}</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#6E6B66', cursor: 'pointer', flex: 'none' }}>
                <input type="checkbox" checked={!!ley.show} onChange={(e) => p.updLeyenda(sh.id, { show: e.target.checked })} style={{ accentColor: '#D6197E', width: 14, height: 14, cursor: 'pointer' }} />
                <span>Mostrar</span>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={ley.titulo || ''} onChange={(e) => p.updLeyenda(sh.id, { titulo: e.target.value })} placeholder="Título de la leyenda" style={{ flex: 1, minWidth: 0, padding: '7px 9px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', background: '#fff' }} />
              <select value={String(ley.tam || 1)} onChange={(e) => p.updLeyenda(sh.id, { tam: parseFloat(e.target.value) || 1 })} title="Tamaño de la leyenda" style={{ padding: '6px 7px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 11.5, background: '#fff', flex: 'none' }}>
                {[['0.75', '75%'], ['1', '100%'], ['1.3', '130%'], ['1.6', '160%'], ['2', '200%'], ['2.5', '250%']].map((o) => <option key={o[0]} value={o[0]}>{o[1]}</option>)}
              </select>
            </div>
            {(ley.items || []).map((it: any, ix: number) => (
              <div key={ix} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select value={it.sym} onChange={(e) => p.updLeyenda(sh.id, { items: ley.items.map((x: any, j: number) => (j === ix ? { ...x, sym: e.target.value } : x)) })} style={{ padding: '6px 7px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 11.5, background: '#fff', flex: 'none', maxWidth: 118 }}>
                  {SIM_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
                <input value={it.etiqueta} onChange={(e) => p.updLeyenda(sh.id, { items: ley.items.map((x: any, j: number) => (j === ix ? { ...x, etiqueta: e.target.value } : x)) })} placeholder="Etiqueta" style={{ flex: 1, minWidth: 0, padding: '7px 8px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 12, background: '#fff' }} />
                <input value={it.cant || ''} onChange={(e) => p.updLeyenda(sh.id, { items: ley.items.map((x: any, j: number) => (j === ix ? { ...x, cant: e.target.value } : x)) })} placeholder="Cant." style={{ width: 46, flex: 'none', padding: '7px 6px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 11, fontFamily: MONO, textAlign: 'center', background: '#fff' }} />
                <button onClick={() => p.updLeyenda(sh.id, { items: ley.items.filter((_x: any, j: number) => j !== ix) })} style={{ border: 'none', background: 'none', color: '#B4B0A8', fontSize: 15, cursor: 'pointer', padding: 0 }}>×</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => p.updLeyenda(sh.id, { show: true, items: [...(ley.items || []), { sym: 'linea', etiqueta: '' }] })} style={{ border: '1px solid ' + fieldBd, background: '#fff', borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>+ Elemento</button>
              <button onClick={() => p.generarLeyenda(sh.id)} style={{ border: 'none', background: '#17161A', color: '#fff', borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                {p.leyGen === sh.id ? <><Spinner /> <span>Generando…</span></> : <>{IA_STAR}<span>Generar con IA</span></>}
              </button>
              <label style={{ border: '1px solid ' + fieldBd, background: '#fff', borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, color: '#17161A' }}>
                {p.leyImg === sh.id ? <><Spinner /> <span>Interpretando…</span></> : <><span style={{ color: '#B0447E' }}>{IA_STAR}</span><span>Desde imagen</span></>}
                <input type="file" accept="image/*" onChange={(e) => p.interpretarLeyenda(sh.id, e)} style={{ display: 'none' }} />
              </label>
              <select onChange={(e) => { const l = getLeyLib().find((x: any) => x.id === e.target.value); if (l) p.updLeyenda(sh.id, { show: true, items: l.items.map((x: any) => ({ ...x })) }); e.target.value = '' }} style={{ padding: '6px 8px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 11.5, background: '#fff' }}>
                <option value="">Aplicar de biblioteca…</option>
                {leyLib.map((l: any) => <option key={l.id} value={l.id}>{l.name + ' (' + l.items.length + ')'}</option>)}
              </select>
            </div>
            {(ley.items || []).length > 0 && (
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={nm} onChange={(e) => p.setLeyNames({ ...p.leyNames, [sh.id]: e.target.value })} placeholder="Nombre para la biblioteca" style={{ flex: 1, minWidth: 0, padding: '7px 8px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 11.5, background: '#fff' }} />
                <button onClick={() => { const name = (nm || '').trim() || sh.tipo; saveLeyLib([...getLeyLib(), { id: 'L' + Date.now(), name, items: ley.items.map((x: any) => ({ ...x })) }]); p.setLeyNames({ ...p.leyNames, [sh.id]: '' }); p.toast('Leyenda guardada en la biblioteca.'); p.bump() }} style={{ border: '1px solid ' + fieldBd, background: '#fff', borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', flex: 'none' }}>Guardar</button>
              </div>
            )}
          </div>
        )
      })}
      {leyLib.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, border: '1px solid ' + border, borderRadius: 10, background: '#FAF9F7' }}>
          {labelCol('Biblioteca de leyendas')}
          {leyLib.map((l: any) => (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600 }}>{l.name}</div>
              <div style={{ fontFamily: MONO, fontSize: 9.5, color: muted }}>{l.items.length + (l.items.length === 1 ? ' elemento' : ' elementos')}</div>
              <button onClick={() => { saveLeyLib(getLeyLib().filter((x: any) => x.id !== l.id)); p.bump() }} style={{ border: 'none', background: 'none', color: '#B4B0A8', fontSize: 15, cursor: 'pointer', padding: 0 }}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
function Spinner() {
  return <span style={{ width: 10, height: 10, border: '2px solid rgba(255,255,255,0.35)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'gcspin 0.8s linear infinite' }} />
}

function MemoriaPanel({ p }: any) {
  const doc = p.doc
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {labelCol('Directrices para la IA')}
        <textarea value={doc.memoria.directrices} onChange={(e) => p.up({ memoria: { ...doc.memoria, directrices: e.target.value } })} placeholder="Ej.: stand de 6×3 con almacén; tono técnico; menciona materiales, instalaciones y montaje; 5 secciones." style={{ minHeight: 120, resize: 'vertical', padding: '10px 11px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 12.5, lineHeight: 1.55, background: '#fff', color: '#17161A', outline: 'none', width: '100%' }} />
      </label>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ border: '1px solid ' + fieldBd, background: '#fff', borderRadius: 6, padding: '5px 9px', fontSize: 10.5, fontWeight: 600, color: '#B0447E', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span>Adjuntar</span>
          <input type="file" accept="image/*,.pdf,.txt,.md,.csv,.xlsx" multiple onChange={p.adjAdd} style={{ display: 'none' }} />
        </label>
        {p.iaAdj.map((a: any) => (
          <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fff', border: '1px solid ' + border, borderRadius: 999, padding: '3px 8px', fontSize: 10, color: '#55524D', maxWidth: 160 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(a.kind === 'img' ? '🖼 ' : '📄 ') + a.name}</span>
            <button onClick={() => p.setIaAdj(p.iaAdj.filter((x: any) => x.id !== a.id))} style={{ border: 'none', background: 'none', color: '#B4B0A8', fontSize: 11, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
          </span>
        ))}
      </div>
      <button onClick={p.generarMemoria} disabled={doc.memoria.generating} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, border: 'none', background: '#17161A', color: '#fff', borderRadius: 8, padding: '12px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
        {doc.memoria.generating ? <><Spinner /> <span>Redactando memoria…</span></> : <>{IA_STAR}<span>Redactar memoria con IA</span></>}
      </button>
      <div style={{ fontSize: 11, lineHeight: 1.5, color: muted }}>La IA lee rótulos, capas y dimensiones de tus planos, las láminas y los cuadros, y redacta la memoria siguiendo tus directrices.</div>
      {doc.memoria.error && <div style={{ border: '1px solid #E7C6D8', background: '#FBF1F6', borderRadius: 8, padding: '11px 13px', fontSize: 12, color: '#5A3A4C' }}>{doc.memoria.error}</div>}
      {doc.memoria.sections.map((sec: any, ix: number) => (
        <div key={ix} style={{ ...card, gap: 7 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input value={sec.titulo} onChange={(e) => p.up({ memoria: { ...doc.memoria, sections: doc.memoria.sections.map((x: any, j: number) => (j === ix ? { ...x, titulo: e.target.value } : x)) } })} style={{ flex: 1, minWidth: 0, padding: '8px 9px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 12.5, fontWeight: 700, background: '#fff' }} />
            <button onClick={() => p.up({ memoria: { ...doc.memoria, sections: doc.memoria.sections.filter((_x: any, j: number) => j !== ix) } })} style={{ border: 'none', background: 'none', color: '#B4B0A8', fontSize: 17, cursor: 'pointer', padding: '6px 10px' }}>×</button>
          </div>
          <textarea value={sec.contenido} onChange={(e) => p.up({ memoria: { ...doc.memoria, sections: doc.memoria.sections.map((x: any, j: number) => (j === ix ? { ...x, contenido: e.target.value } : x)) } })} style={{ minHeight: 110, resize: 'vertical', padding: '9px 10px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 12, lineHeight: 1.55, background: '#fff', color: '#17161A', outline: 'none', width: '100%' }} />
        </div>
      ))}
      <button onClick={() => p.up({ memoria: { ...doc.memoria, sections: [...doc.memoria.sections, { titulo: 'Nueva sección', contenido: '' }] } })} style={{ border: '1.5px dashed #C9C5BC', background: 'none', borderRadius: 8, padding: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#6E6B66' }}>+ Añadir sección manual</button>
    </div>
  )
}

function TablasPanel({ p }: any) {
  const doc = p.doc
  const canImport = doc.drawings.some((d: any) => { const m = p.models.current[d.id]; return m && m.texts.some((t: any) => /m²|m2/i.test(t.t)) })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, border: '1px solid ' + border, borderRadius: 10, background: '#FAF9F7' }}>
        {labelCol('Importar desde Excel')}
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 10, border: '1.5px dashed #C9C5BC', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          Subir .xlsx o .csv
          <input type="file" accept=".xlsx,.csv,.txt" onChange={p.onTablaFile} style={{ display: 'none' }} />
        </label>
        <textarea value={p.tablaPaste} onChange={(e) => p.setTablaPaste(e.target.value)} placeholder="…o copia celdas en Excel y pégalas aquí" style={{ minHeight: 64, resize: 'vertical', padding: '8px 9px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 11.5, fontFamily: MONO, background: '#fff', outline: 'none', width: '100%' }} />
        <button onClick={p.crearTablaDesdePaste} style={btnDark}>Crear tabla con lo pegado</button>
      </div>
      {doc.tables.map((t: any) => (
        <div key={t.id} style={card}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input value={t.titulo} onChange={(e) => p.up({ tables: doc.tables.map((x: any) => (x.id === t.id ? { ...x, titulo: e.target.value } : x)) })} style={{ flex: 1, minWidth: 0, padding: '8px 9px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 12.5, fontWeight: 700, background: '#fff' }} />
            <button onClick={() => p.up({ tables: doc.tables.filter((x: any) => x.id !== t.id) })} style={{ border: 'none', background: 'none', color: '#B4B0A8', fontSize: 17, cursor: 'pointer', padding: '6px 10px' }}>×</button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {t.cols.map((c: string, ci: number) => (
              <input key={ci} value={c} onChange={(e) => p.up({ tables: doc.tables.map((x: any) => (x.id === t.id ? { ...x, cols: x.cols.map((cc: string, j: number) => (j === ci ? e.target.value : cc)) } : x)) })} style={{ flex: 1, minWidth: 0, padding: '7px 8px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 10.5, fontFamily: MONO, textTransform: 'uppercase', background: '#FAF9F7', color: '#6E6B66' }} />
            ))}
            <span style={{ width: 22, flex: 'none' }} />
          </div>
          {t.rows.map((r: string[], ri: number) => (
            <div key={ri} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {r.map((c, ci) => (
                <input key={ci} value={c} onChange={(e) => p.up({ tables: doc.tables.map((x: any) => (x.id === t.id ? { ...x, rows: x.rows.map((rr: string[], j: number) => (j === ri ? rr.map((cc: string, k: number) => (k === ci ? e.target.value : cc)) : rr)) } : x)) })} style={{ flex: 1, minWidth: 0, padding: '7px 8px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 12, background: '#fff' }} />
              ))}
              <button onClick={() => p.up({ tables: doc.tables.map((x: any) => (x.id === t.id ? { ...x, rows: x.rows.filter((_rr: any, j: number) => j !== ri) } : x)) })} style={{ border: 'none', background: 'none', color: '#B4B0A8', fontSize: 15, cursor: 'pointer', padding: 0, width: 22, flex: 'none' }}>×</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => p.up({ tables: doc.tables.map((x: any) => (x.id === t.id ? { ...x, rows: [...x.rows, x.cols.map(() => '')] } : x)) })} style={{ border: '1px solid ' + fieldBd, background: '#fff', borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>+ Fila</button>
            {canImport && <button onClick={() => p.importarSuperficies(t.id)} style={{ border: '1px solid ' + fieldBd, background: '#fff', borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Importar superficies del plano</button>}
            <button onClick={() => p.adaptarTablaIA(t.id)} style={{ border: 'none', background: '#17161A', color: '#fff', borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>{IA_STAR}<span>{p.tablaIA === t.id ? 'Adaptando…' : 'Adaptar con IA'}</span></button>
          </div>
        </div>
      ))}
      <button onClick={() => p.up({ seq: doc.seq + 1, tables: [...doc.tables, { id: 't' + doc.seq, titulo: 'Nueva tabla', cols: ['Concepto', 'Valor'], rows: [['', '']] }] })} style={{ border: '1.5px dashed #C9C5BC', background: 'none', borderRadius: 8, padding: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#6E6B66' }}>+ Añadir tabla</button>
    </div>
  )
}

function AnexosPanel({ p }: any) {
  const doc = p.doc
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 11.5, lineHeight: 1.55, color: '#6E6B66' }}>Las figuras aparecen en la página de anexos. <strong>Arrastra tus imágenes sobre los recuadros de la vista previa</strong> (o haz clic en ellos).</div>
      {doc.anexos.map((a: any, ix: number) => (
        <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 12px', border: '1px solid ' + border, borderRadius: 10, background: '#fff' }}>
          <span style={{ fontFamily: MONO, fontSize: 10, color: muted, flex: 'none' }}>{'FIG ' + pad2(ix + 1)}</span>
          <input value={a.caption} onChange={(e) => p.up({ anexos: doc.anexos.map((x: any) => (x.id === a.id ? { ...x, caption: e.target.value } : x)) })} placeholder="Pie de figura" style={{ flex: 1, minWidth: 0, padding: '8px 9px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 12, background: '#fff' }} />
          <button onClick={() => p.up({ anexos: doc.anexos.filter((x: any) => x.id !== a.id) })} style={{ border: 'none', background: 'none', color: '#B4B0A8', fontSize: 17, cursor: 'pointer', padding: '6px 10px' }}>×</button>
        </div>
      ))}
      <button onClick={() => p.up({ seq: doc.seq + 1, anexos: [...doc.anexos, { id: 'ax' + doc.seq, caption: '' }] })} style={{ border: '1.5px dashed #C9C5BC', background: 'none', borderRadius: 8, padding: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#6E6B66' }}>+ Añadir figura</button>
    </div>
  )
}

// ================= DRAW TOOLBAR =================
function DrawToolbar({ p }: any) {
  const dd = p.dd
  const icon = (paths: string[]) => (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
      {paths.map((d: string, i: number) => <path key={i} d={d} />)}
    </svg>
  )
  const gTools = [
    { t: 'note', label: 'Etiquetar', title: 'Etiquetas con flecha, globos numerados, norte y cortes', ic: ['M2 2h9l11 11-9 9L2 11z', 'M7.5 7.5h.01'] },
    { t: 'draw-t', label: 'Texto', title: 'Clic = texto libre · arrastra = cuadro de texto', ic: ['M5 6V4h14v2', 'M12 4v16', 'M9 20h6'] },
    { t: 'draw-l', label: 'Línea', title: 'Línea (Mayús = H/V, imanta a puntos)', ic: ['M4 20 20 4'] },
    { t: 'draw-a', label: 'Flecha', title: 'Flecha indicadora', ic: ['M4 20 18 6', 'M18 13V6h-7'] },
    { t: 'draw-r', label: 'Rect.', title: 'Rectángulo', ic: ['M3 5h18v14H3z'] },
    { t: 'draw-c', label: 'Círculo', title: 'Círculo', ic: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z'] },
    { t: 'draw-d', label: 'Cota', title: 'Cota lineal', ic: ['M3 4v16', 'M21 4v16', 'M6 12h12', 'M9 9l-3 3 3 3', 'M15 9l3 3-3 3'] },
  ]
  const kind = String(p.tool || '').indexOf('draw-') === 0 ? p.tool.slice(5) : null
  const gStyleOn = !!kind && p.toolSh === '*'
  const gStrokeOn = ['l', 'a', 'r', 'c'].includes(kind || '')
  const gFillOn = ['r', 'c'].includes(kind || '')
  const gTextOn = kind === 't'
  const favs = p.favs
  return (
    <div data-ui="1" style={{ minHeight: 42, flex: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, padding: '6px 22px', background: '#FBFAF9', borderBottom: '1px solid ' + border }}>
      <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: muted, marginRight: 6 }}>Dibujo</span>
      {gTools.map((x) => {
        const on = p.tool === x.t && p.toolSh === '*'
        return (
          <button key={x.t} onClick={() => { const same = p.tool === x.t && p.toolSh === '*'; p.setTool(same ? null : x.t); p.setToolSh(same ? null : '*'); p.setNoteSel(null); p.setSketchSel(null) }} title={x.title} style={{ display: 'flex', alignItems: 'center', gap: 5, border: '1px solid ' + (on ? '#D6197E' : fieldBd), background: on ? '#D6197E' : '#fff', color: on ? '#fff' : '#55524D', borderRadius: 6, padding: '5px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>{icon(x.ic)}<span>{x.label}</span></button>
        )
      })}
      {gStyleOn && (
        <>
          <span style={{ width: 1, height: 22, background: border, margin: '0 6px', flex: 'none' }} />
          <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(dd.color) ? dd.color : '#17161A'} onChange={(e) => p.setStyle({ color: e.target.value })} title="Color del trazo/texto" style={{ width: 30, height: 24, border: '1px solid ' + fieldBd, borderRadius: 6, background: '#fff', padding: 1, cursor: 'pointer', flex: 'none' }} />
          {favs.map((c: string) => (
            <button key={c} onClick={() => p.setStyle({ color: c })} onDoubleClick={() => { delFav(c); p.bump() }} title="Favorito — clic aplica, doble clic quita" style={{ width: 17, height: 17, borderRadius: '50%', border: '2px solid ' + (dd.color === c ? '#17161A' : '#E0DED8'), background: c, cursor: 'pointer', padding: 0, flex: 'none' }} />
          ))}
          <button onClick={() => { if (/^#[0-9a-fA-F]{6}$/.test(dd.color)) { addFav(dd.color); p.bump() } }} title="Guardar favorito" style={{ border: '1px solid ' + fieldBd, background: '#fff', color: '#B07A1F', borderRadius: 6, width: 24, height: 24, fontSize: 12, cursor: 'pointer', flex: 'none', lineHeight: 1 }}>★</button>
          {gStrokeOn && (
            <>
              <select value={String(dd.grosor)} onChange={(e) => p.setStyle({ grosor: parseFloat(e.target.value) })} title="Grosor" style={selSm}>
                {[0.18, 0.25, 0.35, 0.5, 0.7, 1].map((v) => <option key={v} value={v}>{String(v).replace('.', ',') + ' mm'}</option>)}
              </select>
              <select value={dd.dash} onChange={(e) => p.setStyle({ dash: e.target.value })} title="Tipo de línea" style={selSm}>
                <option value="solid">Continua ———</option>
                <option value="dash">Discontinua – – –</option>
                <option value="dot">Punteada · · · ·</option>
              </select>
            </>
          )}
          {(gFillOn || gTextOn) && (
            <>
              <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#B4B0A8', marginLeft: 4 }}>{gTextOn ? 'Fondo' : 'Relleno'}</span>
              <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(gTextOn ? dd.tFill : dd.fill) ? (gTextOn ? dd.tFill : dd.fill) : '#FBE9B7'} onChange={(e) => (gTextOn ? p.setStyle({ tFill: e.target.value }) : p.setStyle({ fill: e.target.value }))} title="Relleno" style={{ width: 30, height: 24, border: '1px solid ' + fieldBd, borderRadius: 6, background: '#fff', padding: 1, cursor: 'pointer', flex: 'none' }} />
              <button onClick={() => (gTextOn ? p.setStyle({ tFill: '' }) : p.setStyle({ fill: '' }))} title="Sin relleno" style={{ border: '1px solid ' + fieldBd, background: (gTextOn ? dd.tFill : dd.fill) ? '#fff' : '#17161A', color: (gTextOn ? dd.tFill : dd.fill) ? '#55524D' : '#fff', borderRadius: 6, width: 24, height: 24, fontSize: 11, cursor: 'pointer', flex: 'none', lineHeight: 1 }}>∅</button>
              {gFillOn && <button onClick={() => p.setStyle({ noBorder: !dd.noBorder })} title="Borde" style={{ border: '1px solid ' + fieldBd, background: !dd.noBorder ? '#17161A' : '#fff', color: !dd.noBorder ? '#fff' : '#55524D', borderRadius: 6, padding: '4px 9px', fontSize: 10.5, fontWeight: 600, cursor: 'pointer', flex: 'none' }}>Borde</button>}
            </>
          )}
          {gTextOn && (
            <>
              <select value={String(dd.fs)} onChange={(e) => p.setStyle({ fs: parseFloat(e.target.value) })} title="Tamaño del texto" style={selSm}>
                {[2.5, 3.5, 5, 7, 10].map((v) => <option key={v} value={v}>{String(v).replace('.', ',') + ' mm'}</option>)}
              </select>
              <button onClick={() => p.setStyle({ bold: !dd.bold })} title="Negrita" style={{ border: '1px solid ' + fieldBd, background: dd.bold ? '#17161A' : '#fff', color: dd.bold ? '#fff' : '#55524D', borderRadius: 6, width: 24, height: 24, fontSize: 11, fontWeight: 800, cursor: 'pointer', flex: 'none' }}>B</button>
              <select value={dd.align} onChange={(e) => p.setStyle({ align: e.target.value })} title="Alineación" style={selSm}>
                <option value="left">Izquierda</option>
                <option value="center">Centrado</option>
                <option value="right">Derecha</option>
              </select>
            </>
          )}
        </>
      )}
      <span style={{ flex: 1, minWidth: 0 }} />
      <span style={{ fontFamily: MONO, fontSize: 9.5, color: '#B4B0A8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Actúan sobre cualquier plano · Esc sale</span>
    </div>
  )
}
const selSm: React.CSSProperties = { padding: '4px 6px', border: '1px solid ' + fieldBd, borderRadius: 6, fontSize: 10.5, background: '#fff' }

// ================= PLAN BAR (bottom) =================
function PlanBar({ p }: any) {
  const visible = !!(p.tool || p.noteSel || p.zoneEdit)
  if (!visible) return null
  const dark = { padding: '6px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid #3A3840', background: 'none', color: '#C9C5CE', borderRadius: 6 } as React.CSSProperties
  const inpD = { padding: '7px 9px', border: '1px solid #3A3840', borderRadius: 6, fontSize: 12, background: '#26252A', color: '#fff', outline: 'none' } as React.CSSProperties
  const selD = { padding: '6px 8px', border: '1px solid #3A3840', borderRadius: 6, fontSize: 11, background: '#26252A', color: '#fff' } as React.CSSProperties
  const n0 = p.selNote0()
  const barIsZone = !!p.zoneEdit
  const barIsNote = !!p.noteSel
  const barIsTool = p.tool === 'note' && !p.noteSel
  const barIsDraw = String(p.tool || '').indexOf('draw-') === 0 && !p.noteSel
  const z = p.selZona()
  const sh = p.sheetById(p.toolSh)
  const msg = (() => {
    if (p.zoneEdit) return p.zoneSel ? 'ZONA — arrastra: mover · esquina inf. dcha: redimensionar · Supr: eliminar' : 'Dibuja un recuadro, o clic sobre un elemento del plano para anclar la zona · Esc: salir'
    if (p.noteSel) return p.noteSel.idxs.length > 1 ? p.noteSel.idxs.length + ' etiquetas — los cambios se aplican a todas' : 'ETIQUETA'
    if (barIsDraw) return p.sketchSel ? 'FORMA — arrastra: mover · Supr: eliminar · Esc: salir' : 'Arrastra para dibujar · Mayús: H/V · clic: seleccionar · Esc: salir'
    if (p.tool === 'note') return p.notePend ? 'Haz clic donde irá el texto de la etiqueta' : p.noteAdding ? 'Haz clic en el punto del plano que quieres señalar' : 'Clic o recuadro: seleccionar · Mayús+clic: añadir · arrastrar: mover · Supr: borrar · Esc: salir'
    return ''
  })()
  return (
    <div data-ui="1" style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: '#17161A', color: '#fff', borderRadius: 12, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 14, zIndex: 60, boxShadow: '0 14px 34px rgba(0,0,0,0.35)', maxWidth: '82%', flexWrap: 'wrap' }}>
      <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.05em', color: '#C9C5CE', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 420 }}>{msg}</span>

      {barIsZone && (
        <>
          {p.zoneSel && (
            <>
              <input value={(z || {}).name || ''} onChange={(e) => { if (p.zoneSel) p.updZona(p.zoneSel.shId, p.zoneSel.idx, { name: e.target.value }, true) }} placeholder="Nombre de la zona" style={{ ...inpD, width: 140 }} />
              <label style={{ ...dark, whiteSpace: 'nowrap' }}>Imagen…<input type="file" accept="image/*" onChange={p.onZoneFile} style={{ display: 'none' }} /></label>
              <select value={(z || {}).fit || 'cover'} onChange={(e) => { if (p.zoneSel) p.updZona(p.zoneSel.shId, p.zoneSel.idx, { fit: e.target.value }, true) }} style={selD}>
                <option value="cover">Recortar (llenar)</option>
                <option value="contain">Encajar entera</option>
                <option value="stretch">Estirar</option>
              </select>
              <button onClick={() => { const zz = p.selZona(); if (p.zoneSel && zz) p.updZona(p.zoneSel.shId, p.zoneSel.idx, { rot: ((+zz.rot || 0) + 90) % 360 }, true) }} style={dark}>⟳ {(z || {}).rot || 0}°</button>
              {(z || {}).src && <button onClick={() => { if (p.zoneSel) p.updZona(p.zoneSel.shId, p.zoneSel.idx, { src: '' }, true) }} style={dark}>Quitar imagen</button>}
              <button onClick={() => { if (p.zoneSel) { const zs = p.zoneSel; p.setZoneSel(null); p.updZona(zs.shId, zs.idx, null, true) } }} style={dark}>Eliminar zona</button>
            </>
          )}
          <button onClick={() => { if (p.zoneEdit) p.detectarZonas(p.zoneEdit, false) }} title="Detectar rectángulos y polilíneas de la capa ROTULACION" style={{ border: 'none', background: '#D6197E', color: '#fff', borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Zonas del CAD</button>
        </>
      )}

      {barIsNote && (
        <>
          {p.noteSel.idxs.length === 1 && <input value={(n0 || {}).text || ''} onChange={(e) => p.updNoteSel({ text: e.target.value })} placeholder="Texto de la etiqueta" style={{ ...inpD, width: 220 }} />}
          <select value={(n0 || {}).style || 'dot'} onChange={(e) => p.updNoteSel({ style: e.target.value })} style={selD}>
            <option value="dot">Punto</option>
            <option value="arrow">Flecha</option>
            <option value="curve">Guía curva</option>
            <option value="none">Solo texto</option>
            <option value="balloon">Globo numerado</option>
            <option value="norte">Símbolo: Norte</option>
            <option value="corte">Símbolo: Sección</option>
          </select>
          <input type="color" value={/^#[0-9a-fA-F]{6}$/.test((n0 || {}).color || '') ? (n0 || {}).color : '#17161A'} onChange={(e) => p.updNoteSel({ color: e.target.value })} title="Color de la etiqueta" style={{ width: 28, height: 22, border: '1px solid #3A3840', borderRadius: 6, background: '#26252A', padding: 1, cursor: 'pointer', flex: 'none' }} />
          <select value={String((n0 || {}).fs || (sh && sh.notaFs) || 2.4)} onChange={(e) => p.updNoteSel({ fs: parseFloat(e.target.value) })} title="Tamaño del texto" style={selD}>
            {[1.8, 2, 2.4, 3, 3.6, 4.5].map((v) => <option key={v} value={v}>{String(v).replace('.', ',') + ' mm'}</option>)}
          </select>
          <select value={(n0 || {}).font || 'archivo'} onChange={(e) => p.updNoteSel({ font: e.target.value })} title="Fuente" style={selD}>
            <option value="archivo">Archivo</option>
            <option value="mono">Mono</option>
            <option value="serif">Serif</option>
          </select>
          <button onClick={() => { if (n0) p.updNoteSel({ bold: !n0.bold }) }} title="Negrita" style={{ border: '1px solid ' + ((n0 || {}).bold ? '#D6197E' : '#3A3840'), background: (n0 || {}).bold ? '#D6197E' : 'transparent', color: (n0 || {}).bold ? '#fff' : '#C9C5CE', borderRadius: 6, width: 28, height: 28, fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>B</button>
          <button onClick={() => { if (n0) p.updNoteSel({ italic: !n0.italic }) }} title="Cursiva" style={{ border: '1px solid ' + ((n0 || {}).italic ? '#D6197E' : '#3A3840'), background: (n0 || {}).italic ? '#D6197E' : 'transparent', color: (n0 || {}).italic ? '#fff' : '#C9C5CE', borderRadius: 6, width: 28, height: 28, fontSize: 12, fontStyle: 'italic', fontWeight: 600, cursor: 'pointer' }}>I</button>
          {p.noteSel.idxs.length === 1 && <button onClick={() => { const txt = n0 && String(n0.text || '').trim(); if (!txt) { p.toast('Escribe primero el texto de la etiqueta.'); return } const lib = getNoteLib(); if (!lib.includes(txt)) { saveNoteLib([...lib, txt]); p.bump() } }} style={dark}>Guardar predefinida</button>}
          <button onClick={() => { const ns = p.noteSel; if (!ns) return; const s = p.sheetById(ns.shId); if (!s) return; const set = new Set(ns.idxs); p.setNoteSel(null); p.upSheet(ns.shId, { notas: (s.notas || []).filter((_n: any, j: number) => !set.has(j)) }) }} style={dark}>{p.noteSel.idxs.length > 1 ? 'Eliminar (' + p.noteSel.idxs.length + ')' : 'Eliminar'}</button>
        </>
      )}

      {barIsDraw && p.sketchSel && (
        <button onClick={() => { const ss = p.sketchSel; if (!ss) return; const s = p.sheetById(ss.shId); p.setSketchSel(null); if (s) p.upSheet(ss.shId, { croquis: (s.croquis || []).filter((_e: any, j: number) => j !== ss.idx) }) }} style={dark}>Eliminar forma</button>
      )}

      {barIsTool && (
        <>
          <button onClick={() => { p.setNoteAdding(!p.noteAdding); p.setNotePreset(null) }} style={{ border: '1.5px solid #D6197E', background: p.noteAdding ? '#fff' : '#D6197E', color: p.noteAdding ? '#D6197E' : '#fff', borderRadius: 6, padding: '6px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>{p.noteAdding ? 'Colocando… (Esc cancela)' : '+ Añadir etiqueta'}</button>
          {getNoteLib().length > 0 && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', maxWidth: 400, alignItems: 'center' }}>
              {getNoteLib().map((txt: string) => (
                <span key={txt} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: p.notePreset === txt ? '#D6197E' : '#26252A', border: '1px solid ' + (p.notePreset === txt ? '#D6197E' : '#3A3840'), borderRadius: 999, padding: '4px 9px' }}>
                  <button onClick={() => { const off = p.notePreset === txt; p.setNotePreset(off ? null : txt); p.setNoteAdding(!off) }} style={{ border: 'none', background: 'none', color: p.notePreset === txt ? '#fff' : '#C9C5CE', fontSize: 10.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}>{txt}</button>
                  <button onClick={() => { saveNoteLib(getNoteLib().filter((x: string) => x !== txt)); p.bump() }} style={{ border: 'none', background: 'none', color: muted, fontSize: 11, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
                </span>
              ))}
            </div>
          )}
          <select value={String((sh || {}).notaFs || 2.4)} onChange={(e) => { if (p.toolSh) p.upSheet(p.toolSh, { notaFs: parseFloat(e.target.value) }) }} title="Tamaño del texto de las etiquetas" style={selD}>
            {[['2', 'Texto 2,0 mm'], ['2.4', 'Texto 2,4 mm'], ['3', 'Texto 3,0 mm']].map((o) => <option key={o[0]} value={o[0]}>{o[1]}</option>)}
          </select>
          {sh && (sh.notas || []).length > 0 && <button onClick={() => { const s = p.sheetById(p.toolSh); if (s && (s.notas || []).length) p.setNoteSel({ shId: p.toolSh, idxs: s.notas.map((_n: any, i: number) => i) }) }} style={dark}>Seleccionar todas</button>}
          <button onClick={p.alinearNotas} style={dark}>Alinear textos</button>
          <button onClick={p.generarNotasIA} style={{ border: 'none', background: '#D6197E', color: '#fff', borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>{IA_STAR}<span>{p.notasIABusy ? 'Proponiendo…' : 'Etiquetas IA'}</span></button>
        </>
      )}
      <button onClick={() => { p.setTool(null); p.setToolSh(null); p.setNoteSel(null); p.setZoneEdit(null); p.setZoneSel(null) }} style={{ border: 'none', background: 'none', color: muted, fontSize: 16, cursor: 'pointer', padding: '0 2px' }}>×</button>
    </div>
  )
}
