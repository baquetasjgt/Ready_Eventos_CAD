import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { KEYS, read, write } from '../../lib/storage'
import { complete, hasApiKey } from '../../lib/claude'
import * as lib from './cad-lib'
import type { Model } from './cad-lib'
import * as xl from './xlsx-lite'
import { GLYPH, glyphEl, LEYSYMS, SIM_OPTIONS } from './glyphs'
import { renderOverlay } from './overlay'
import PlanosView from './PlanosView'
import type {
  Doc,
  Drawing,
  DrawStyle,
  Sheet,
  Nota,
  Zona,
  ProjectMeta,
} from './types'
import {
  ACCENT,
  CAJ_POS,
  ESCALAS,
  ESTILO_CAPAS,
  GROSOR,
  MONO,
  PAPER,
  PLEGADO,
  SANS,
  TIPOS,
  addFav,
  cajTheme,
  delFav,
  eyeDrop,
  fileToDataURL,
  fmtNum,
  getFavs,
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

const DEFAULT_DOC: Doc = {
  project: {
    empresa: 'Ready Eventos',
    proyecto: 'Stand 6×3 — Feria de muestras',
    subtitulo: 'Proyecto de diseño y montaje de stand',
    arquitecto: '',
    contacto: 'Calle Soria, 34 · 28864 Ajalvir (Madrid) · +34 677 437 113 · ready@readyeventos.com',
    fecha: new Date().toISOString().slice(0, 10),
  },
  drawings: [],
  sheets: [],
  memoria: { directrices: '', sections: [], generating: false, error: '' },
  tables: [],
  anexos: [],
  secciones: { portada: true, indice: true, memoria: true, tablas: true, anexos: true },
  cajetin: [
    { id: 'f1', label: 'PROYECTO', src: 'proyecto', value: '' },
    { id: 'f2', label: 'DISEÑO', src: 'arquitecto', value: '' },
    { id: 'f3', label: 'TIPO DE PLANO', src: 'tipo', value: '' },
    { id: 'f4', label: 'FECHA', src: 'fecha', value: '' },
    { id: 'f5', label: 'ESCALA', src: 'escala', value: '' },
  ],
  cajStyle: { fs: 7.5, h: 26, bg: '#FFFFFF' },
  capasCfg: { marcos: 'STD-10-NO-PLOT, LAMINA, MARCO', rotulos: 'STD-15-NO-PLOT-ROTULOS, ROTULACION' },
  seq: 10,
}

function svgIcon(paths: string[]) {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
      {paths.map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  )
}
const IA_STAR = (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="currentColor" style={{ flex: 'none' }}>
    <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2z" />
  </svg>
)

export default function PlanosApp() {
  const { projectId = '' } = useParams()

  // ---- refs (heavy / imperative) ----
  const models = useRef<Record<string, Model>>({})
  const raws = useRef<Record<string, string>>({})
  const svgCache = useRef<Record<string, string>>({})
  const thumbCache = useRef<Record<string, string>>({})
  const framesCache = useRef<Record<string, lib.Frame[]>>({})
  const snapCache = useRef<Record<string, number[][]>>({})
  const undoRef = useRef<Doc[]>([])
  const redoRef = useRef<Doc[]>([])
  const drag = useRef<any>({})
  const persistT = useRef<any>(null)

  // ---- state ----
  const [doc, setDocState] = useState<Doc>(DEFAULT_DOC)
  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState('proyecto')
  const [zoom, setZoom] = useState(0.5)
  const [vista, setVista] = useState<'doc' | 'grid'>('doc')
  const [notice, setNotice] = useState('')
  const [noticeUndo, setNoticeUndo] = useState(false)
  const [selSheet, setSelSheet] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<any>(null)
  const [shDelPend, setShDelPend] = useState<string | null>(null)
  const [exporting, setExporting] = useState('')
  const [saving, setSaving] = useState(false)
  const [tool, setTool] = useState<string | null>(null)
  const [toolSh, setToolSh] = useState<string | null>(null)
  const [noteSel, setNoteSel] = useState<{ shId: string; idxs: number[] } | null>(null)
  const [notePend, setNotePend] = useState<{ shId: string; pt: number[] } | null>(null)
  const [noteAdding, setNoteAdding] = useState(false)
  const [notePreset, setNotePreset] = useState<string | null>(null)
  const [hoverPt, setHoverPt] = useState<any>(null)
  const [marquee, setMarquee] = useState<any>(null)
  const [zoneEdit, setZoneEdit] = useState<string | null>(null)
  const [zoneSel, setZoneSel] = useState<{ shId: string; idx: number } | null>(null)
  const [zoneGhost, setZoneGhost] = useState<any>(null)
  const [sketchSel, setSketchSel] = useState<{ shId: string; idx: number } | null>(null)
  const [sketchGhost, setSketchGhost] = useState<any>(null)
  const [dd, setDd] = useState<DrawStyle>({ color: '#17161A', grosor: 0.35, dash: 'solid', fs: 3.5, align: 'left', bold: false, fill: '', noBorder: false, tFill: '', tBorder: false })
  const [leyGen, setLeyGen] = useState<string | null>(null)
  const [leyImg, setLeyImg] = useState<string | null>(null)
  const [tablaIA, setTablaIA] = useState<string | null>(null)
  const [notasIABusy, setNotasIABusy] = useState(false)
  const [iaAdj, setIaAdj] = useState<any[]>([])
  const [tablaPaste, setTablaPaste] = useState('')
  const [leyNames, setLeyNames] = useState<Record<string, string>>({})
  const [, setFavTick] = useState(0)
  const bump = () => setFavTick((x) => x + 1)

  const projName = useMemo(() => {
    const list = read<{ list: { id: string; name: string }[] }>(KEYS.projects)?.list || []
    return list.find((p) => p.id === projectId)?.name || doc.project.proyecto || 'Proyecto'
  }, [projectId, doc.project.proyecto])

  // ---- persistence ----
  const buildPayload = useCallback(
    (d: Doc) => ({
      project: d.project,
      sheets: d.sheets,
      memoria: { directrices: d.memoria.directrices, sections: d.memoria.sections },
      tables: d.tables,
      anexos: d.anexos,
      secciones: d.secciones,
      cajetin: d.cajetin,
      cajStyle: d.cajStyle,
      capasCfg: d.capasCfg,
      zoom,
      tab,
      seq: d.seq,
      drawings: d.drawings.map((dr) => ({
        id: dr.id,
        name: dr.name,
        unit: dr.unit,
        sample: !!dr.sample,
        raw: !dr.sample && raws.current[dr.id] && raws.current[dr.id].length < 1200000 ? raws.current[dr.id] : undefined,
      })),
    }),
    [zoom, tab],
  )

  const persistNow = useCallback(
    (d: Doc) => {
      clearTimeout(persistT.current)
      if (!projectId) return
      write(KEYS.planos(projectId), buildPayload(d))
      setSaving(false)
    },
    [projectId, buildPayload],
  )
  const schedulePersist = useCallback(
    (d: Doc) => {
      setSaving(true)
      clearTimeout(persistT.current)
      persistT.current = setTimeout(() => persistNow(d), 500)
    },
    [persistNow],
  )

  // ---- doc mutation with undo/redo ----
  const up = useCallback(
    (patch: Partial<Doc>) => {
      setDocState((prev) => {
        undoRef.current.push(prev)
        if (undoRef.current.length > 30) undoRef.current.shift()
        redoRef.current = []
        const next = { ...prev, ...patch }
        schedulePersist(next)
        return next
      })
    },
    [schedulePersist],
  )
  const live = useCallback((patch: Partial<Doc>) => setDocState((prev) => ({ ...prev, ...patch })), [])
  const undo = useCallback(() => {
    setDocState((prev) => {
      const p = undoRef.current.pop()
      if (!p) return prev
      redoRef.current.push(prev)
      schedulePersist(p)
      return p
    })
    setNoteSel(null)
    setZoneSel(null)
    setSketchSel(null)
  }, [schedulePersist])
  const redo = useCallback(() => {
    setDocState((prev) => {
      const n = redoRef.current.pop()
      if (!n) return prev
      undoRef.current.push(prev)
      schedulePersist(n)
      return n
    })
  }, [schedulePersist])

  const toast = useCallback((msg: string, undoable?: boolean) => {
    setNotice(msg)
    setNoticeUndo(!!undoable)
    setTimeout(() => {
      setNotice('')
      setNoticeUndo(false)
    }, 8000)
  }, [])

  // ---- boot / load ----
  useEffect(() => {
    const saved = read<any>(KEYS.planos(projectId))
    if (saved && saved.project) {
      const drawings: Drawing[] = []
      for (const dr of saved.drawings || []) {
        try {
          if (dr.sample) {
            models.current[dr.id] = lib.sampleModel()
            drawings.push({ id: dr.id, name: dr.name, unit: dr.unit || 'm', sample: true })
          } else if (dr.raw) {
            const m = lib.parseDXF(dr.raw)
            if (m.n > 0) {
              models.current[dr.id] = m
              raws.current[dr.id] = dr.raw
              drawings.push({ id: dr.id, name: dr.name, unit: dr.unit || m.unitsGuess })
            }
          } else {
            drawings.push({ id: dr.id, name: dr.name, unit: dr.unit || 'm', pending: true })
          }
        } catch (e) {}
      }
      let cajetin = saved.cajetin && saved.cajetin.length ? saved.cajetin : DEFAULT_DOC.cajetin
      if (!cajetin.some((f: any) => f.src === 'escala'))
        cajetin = [...cajetin, { id: 'fesc', label: 'ESCALA', src: 'escala', value: '' }]
      setDocState({
        project: { ...DEFAULT_DOC.project, ...saved.project },
        drawings,
        sheets: (saved.sheets || []).map((s: Sheet) => ({
          ...s,
          drawingId: models.current[s.drawingId] || drawings.some((dd0) => dd0.id === s.drawingId) ? s.drawingId : '',
        })),
        memoria: { directrices: saved.memoria?.directrices || '', sections: saved.memoria?.sections || [], generating: false, error: '' },
        tables: saved.tables || [],
        anexos: saved.anexos || [],
        secciones: { ...DEFAULT_DOC.secciones, ...(saved.secciones || {}) },
        cajStyle: { ...DEFAULT_DOC.cajStyle, ...(saved.cajStyle || {}) },
        capasCfg: { ...DEFAULT_DOC.capasCfg, ...(saved.capasCfg || {}) },
        cajetin,
        seq: saved.seq || 50,
      })
      setZoom(saved.zoom || 0.5)
      setTab(saved.tab || 'proyecto')
    } else {
      // primer arranque: plano de ejemplo
      const id = 'd1'
      models.current[id] = lib.sampleModel()
      setDocState({
        ...DEFAULT_DOC,
        drawings: [{ id, name: 'Plano de ejemplo — Stand 6×3', unit: 'm', sample: true }],
        sheets: [{ id: 's1', drawingId: id, num: 'A-01', tipo: 'Planta de distribución — Stand 6×3', escala: 25, size: 'A3', orient: 'l' }],
        tables: [
          {
            id: 't1',
            titulo: 'Cuadro de superficies y datos del stand',
            cols: ['Concepto', 'Valor'],
            rows: [
              ['Superficie total', '18,0 m²'],
              ['Zona de atención', '16,3 m²'],
              ['Almacén', '1,7 m²'],
              ['Frente abierto', '6,00 m'],
              ['Tarima', 'H = 100 mm'],
            ],
          },
        ],
        anexos: [
          { id: 'ax1', caption: 'Render 3D del stand' },
          { id: 'ax2', caption: 'Montaje de referencia en feria anterior' },
        ],
        seq: 10,
      })
    }
    setReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // ---- keyboard shortcuts ----
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const tag = (ev.target as any)?.tagName || ''
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return
      const mod = ev.ctrlKey || ev.metaKey
      if (mod && (ev.key === 'z' || ev.key === 'Z') && !ev.shiftKey) {
        ev.preventDefault()
        undo()
        return
      }
      if (mod && (ev.key === 'y' || ev.key === 'Y' || ((ev.key === 'z' || ev.key === 'Z') && ev.shiftKey))) {
        ev.preventDefault()
        redo()
        return
      }
      if (ev.key === 'Escape') {
        setCtxMenu(null)
        setTool(null)
        setToolSh(null)
        setNoteSel(null)
        setNotePend(null)
        setNoteAdding(false)
        setMarquee(null)
        setHoverPt(null)
        setNotePreset(null)
        setZoneEdit(null)
        setZoneSel(null)
        setZoneGhost(null)
        setSketchSel(null)
        setSketchGhost(null)
        return
      }
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        if (zoneSel && zoneEdit) {
          ev.preventDefault()
          const zs = zoneSel
          setZoneSel(null)
          updZona(zs.shId, zs.idx, null, true)
        } else if (sketchSel) {
          ev.preventDefault()
          const ss = sketchSel
          const sh2 = sheetById(ss.shId)
          setSketchSel(null)
          if (sh2) upSheet(ss.shId, { croquis: (sh2.croquis || []).filter((_e, j) => j !== ss.idx) })
        } else if (noteSel) {
          ev.preventDefault()
          const ns = noteSel
          const sh = sheetById(ns.shId)
          if (sh) {
            const set = new Set(ns.idxs || [])
            setNoteSel(null)
            upSheet(ns.shId, { notas: (sh.notas || []).filter((_n, j) => !set.has(j)) })
          }
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneSel, zoneEdit, sketchSel, noteSel, doc.sheets])

  // ==== helpers ====
  const sheetById = (id: string | null) => doc.sheets.find((x) => x.id === id)
  const upSheet = (id: string, patch: Partial<Sheet>) => up({ sheets: doc.sheets.map((x) => (x.id === id ? { ...x, ...patch } : x)) })
  const liveSheet = (id: string, patch: Partial<Sheet>) => live({ sheets: doc.sheets.map((x) => (x.id === id ? { ...x, ...patch } : x)) })

  const capaMatch = (layer: string, lista: string) => {
    const L = String(layer || '').trim().toUpperCase()
    return String(lista || '')
      .split(',')
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean)
      .some((t) => L === t)
  }
  const isRotulLayer = (layer: string) => capaMatch(layer, doc.capasCfg.rotulos || 'STD-15-NO-PLOT-ROTULOS')
  const isMarcoLayer = (layer: string) => capaMatch(layer, doc.capasCfg.marcos || 'STD-10-NO-PLOT') && !isRotulLayer(layer)

  const viewport = (size: string, orient: string) => {
    const p = PAPER[size] || PAPER.A3
    const W = orient === 'l' ? p[1] : p[0]
    const H = orient === 'l' ? p[0] : p[1]
    const vw = W - 14 - (CAJ_POS === 'lateral' ? 44 : 0)
    const vh = H - 14 - (CAJ_POS === 'lateral' ? 0 : 26)
    return { W, H, vw, vh }
  }
  const planSizeMM = (m: Model, unit: string, escala: number, region: any) => {
    const unitMM = lib.UNIT_MM[unit] || 1000
    const mmPerDU = unitMM / escala
    const w = region ? region.maxX - region.minX : m.bounds.w
    const h = region ? region.maxY - region.minY : m.bounds.h
    return { pw: w * mmPerDU, ph: h * mmPerDU, mmPerDU }
  }
  const suggestScale = (m: Model, unit: string, size: string, orient: string, region?: any) => {
    const { vw, vh } = viewport(size, orient)
    for (const N of ESCALAS) {
      const { pw, ph } = planSizeMM(m, unit, N, region)
      if (pw <= vw - 6 && ph <= vh - 6) return N
    }
    return ESCALAS[ESCALAS.length - 1]
  }
  const vbFor = (m: Model, region: any, strokeDU: number) => {
    const b = region
      ? { minX: region.minX, minY: region.minY, maxX: region.maxX, maxY: region.maxY, w: region.maxX - region.minX || 1, h: region.maxY - region.minY || 1 }
      : m.bounds
    const pad = region ? 0 : strokeDU * 2 + Math.max(b.w, b.h) * 0.004
    return { x: b.minX - pad, y: -(b.maxY + pad), w: b.w + pad * 2, h: b.h + pad * 2 }
  }
  const evPoint = (ev: any, vb: any): [number, number, number] => {
    const r = ev.currentTarget.getBoundingClientRect()
    const sc = Math.min(r.width / vb.w, r.height / vb.h) || 1
    const ox = r.left + (r.width - vb.w * sc) / 2
    const oy = r.top + (r.height - vb.h * sc) / 2
    const xSvg = vb.x + (ev.clientX - ox) / sc
    const ySvg = vb.y + (ev.clientY - oy) / sc
    return [xSvg, -ySvg, 1 / sc]
  }

  const renumber = (sheets: Sheet[]) => sheets.map((sh, i) => (sh.num ? sh : { ...sh, num: 'A-' + String(i + 1).padStart(2, '0') }))
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
  const nextNum = () => 'A-' + String(doc.sheets.length + 1).padStart(2, '0')

  // ==== detection ====
  const zonasFromModel = (m: Model, region: any): Partial<Zona>[] => {
    const out: Partial<Zona>[] = []
    for (const e of m.ents) {
      if (!isRotulLayer(e.layer || '')) continue
      let x = 0,
        y = 0,
        w = 0,
        h = 0,
        poly: number[][] | null = null,
        circle = false
      if (e.k === 'p' && e.closed && e.pts.length > 2) {
        const xs = e.pts.map((p: number[]) => p[0]),
          ys = e.pts.map((p: number[]) => p[1])
        x = Math.min(...xs)
        y = Math.min(...ys)
        w = Math.max(...xs) - x
        h = Math.max(...ys) - y
        const isRect =
          e.pts.length <= 5 &&
          !e.pts.some((p: number[]) => p[2]) &&
          e.pts.every(
            (p: number[]) =>
              (Math.abs(p[0] - x) < w * 0.01 || Math.abs(p[0] - (x + w)) < w * 0.01) &&
              (Math.abs(p[1] - y) < h * 0.01 || Math.abs(p[1] - (y + h)) < h * 0.01),
          )
        if (!isRect) poly = e.pts.map((p: number[]) => [p[0], p[1]])
      } else if (e.k === 'c') {
        x = e.cx - e.r
        y = e.cy - e.r
        w = 2 * e.r
        h = 2 * e.r
        circle = true
      } else continue
      if (!(w > 0 && h > 0)) continue
      if (region) {
        const cx = x + w / 2,
          cy = y + h / 2
        if (cx < region.minX || cx > region.maxX || cy < region.minY || cy > region.maxY) continue
      }
      out.push({ x, y, w, h, poly, circle })
    }
    return out
  }

  const sheetsFromFrames = (drawingId: string, frames: lib.Frame[], startSeq: number): Sheet[] => {
    const m = models.current[drawingId]
    return frames.map((fr, i) => ({
      zonas: m
        ? zonasFromModel(m, fr).map((c, zi) => ({ id: 'z' + Date.now() + i + '_' + zi, name: 'Zona ' + (zi + 1), src: '', fit: 'cover', rot: 0, ...c }) as Zona)
        : [],
      id: 's' + (startSeq + i),
      drawingId,
      num: '',
      tipo: TIPOS[i] || 'Lámina ' + (i + 1),
      escala: fr.escala,
      size: fr.size,
      orient: fr.orient,
      region: { minX: fr.minX, minY: fr.minY, maxX: fr.maxX, maxY: fr.maxY },
      auto: true,
    }))
  }

  const detectar = (drawingId: string) => {
    const d = doc.drawings.find((x) => x.id === drawingId)
    const m = d && models.current[d.id]
    if (!m || !d) return
    const frames = lib.detectFrames(m, d.unit, (ly) => isMarcoLayer(ly)) || []
    framesCache.current = {}
    if (!frames.length) {
      up({} as any)
      toast('No se han detectado marcos de lámina en «' + d.name + '». Dibuja un rectángulo cerrado (RECTANG) con las medidas del papel a escala, idealmente en una capa LAMINA o *NO-PLOT*.')
      return
    }
    const keep = doc.sheets.filter((sh) => !(sh.auto && sh.drawingId === d.id))
    const sheets = renumber([...keep, ...sheetsFromFrames(d.id, frames, doc.seq)])
    up({ seq: doc.seq + frames.length, sheets })
    toast('Detectadas ' + frames.length + (frames.length === 1 ? ' lámina' : ' láminas') + ' en «' + d.name + '».')
  }

  const detectarZonas = (shId: string, silencioso?: boolean) => {
    const sh = sheetById(shId)
    const d = sh && doc.drawings.find((x) => x.id === sh.drawingId)
    const m = d && models.current[d.id]
    if (!m || !sh) return 0
    const cands = zonasFromModel(m, sh.region || null)
    const existentes = sh.zonas || []
    const solapa = (a: any, b: any) => {
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
      const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
      return (ix * iy) / Math.max(1e-9, a.w * a.h) > 0.7
    }
    const nuevas = cands
      .filter((c) => !existentes.some((z) => z.w !== undefined && solapa(c, z)))
      .map((c, i) => ({ id: 'z' + Date.now() + i, name: 'Zona ' + (existentes.length + i + 1), src: '', fit: 'cover', rot: 0, ...c }) as Zona)
    if (nuevas.length) upSheet(shId, { zonas: [...existentes, ...nuevas] })
    if (!silencioso)
      toast(
        nuevas.length
          ? 'Detectadas ' + nuevas.length + (nuevas.length === 1 ? ' zona de rotulación.' : ' zonas de rotulación.')
          : 'No hay zonas nuevas: dibuja rectángulos o polilíneas cerradas en la capa ROTULACION.',
      )
    return nuevas.length
  }

  const updZona = (shId: string, idx: number, patch: Partial<Zona> | null, persist?: boolean) => {
    const sheets = doc.sheets.map((x) => {
      if (x.id !== shId) return x
      const zonas = patch === null ? (x.zonas || []).filter((_z, j) => j !== idx) : (x.zonas || []).map((z, j) => (j === idx ? { ...z, ...patch } : z))
      return { ...x, zonas }
    })
    persist ? up({ sheets }) : live({ sheets })
  }
  const selZona = () => {
    if (!zoneSel) return null
    const sh = sheetById(zoneSel.shId)
    return (sh && (sh.zonas || [])[zoneSel.idx]) || null
  }

  // ==== file upload ====
  const onFile = async (ev: any) => {
    const files = [...ev.target.files]
    ev.target.value = ''
    let d = doc
    for (const file of files) {
      let buf: ArrayBuffer
      try {
        buf = await file.arrayBuffer()
      } catch (e) {
        continue
      }
      const head = new TextDecoder('latin1').decode(buf.slice(0, 24))
      if (/^AC\d{4}/.test(head)) {
        toast('«' + file.name + '» es un DWG binario y el navegador no puede leerlo. En AutoCAD: Guardar como «AutoCAD DXF» y sube ese .dxf.')
        continue
      }
      if (head.startsWith('AutoCAD Binary DXF')) {
        toast('«' + file.name + '» es un DXF binario. Guárdalo como DXF ASCII desde AutoCAD.')
        continue
      }
      const text = new TextDecoder('utf-8').decode(buf)
      try {
        const m = lib.parseDXF(text)
        if (!m.n) {
          toast('No se han encontrado entidades dibujadas en «' + file.name + '».')
          continue
        }
        const id = 'd' + d.seq
        models.current[id] = m
        raws.current[id] = text
        const frames = lib.detectFrames(m, m.unitsGuess, (ly) => isMarcoLayer(ly)) || []
        let newSheets: Sheet[], used: number
        if (frames.length) {
          newSheets = sheetsFromFrames(id, frames, d.seq + 1)
          used = frames.length + 1
          toast('Detectadas ' + frames.length + (frames.length === 1 ? ' lámina dibujada' : ' láminas dibujadas') + ' en «' + file.name + '».')
        } else {
          newSheets = [
            {
              id: 's' + (d.seq + 1),
              drawingId: id,
              num: '',
              tipo: 'Planta — Distribución',
              escala: suggestScale(m, m.unitsGuess, 'A3', 'l'),
              size: 'A3',
              orient: 'l',
              zonas: zonasFromModel(m, null).map((c, zi) => ({ id: 'z' + Date.now() + '_' + zi, name: 'Zona ' + (zi + 1), src: '', fit: 'cover', rot: 0, ...c }) as Zona),
            },
          ]
          used = 2
        }
        d = {
          ...d,
          seq: d.seq + used,
          drawings: [...d.drawings, { id, name: file.name, unit: m.unitsGuess }],
          sheets: renumber([...d.sheets, ...newSheets]),
        }
      } catch (err: any) {
        toast('Error al interpretar «' + file.name + '»: ' + err.message)
      }
    }
    up({ drawings: d.drawings, sheets: d.sheets, seq: d.seq })
    setTab('planos')
  }

  // ==== IA plumbing ====
  const askClaude = async (prompt: string, system: string, max: number, images?: { media: string; data: string }[]) => {
    if (!hasApiKey()) throw new Error('La IA no está disponible en este entorno (falta la clave de API).')
    if (images && images.length) {
      const content = [
        ...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.media, data: im.data } })),
        { type: 'text', text: prompt },
      ]
      return await complete({ system, messages: [{ role: 'user', content } as any], maxTokens: max } as any)
    }
    // adjuntos de memoria
    const imgs = iaAdj.filter((a) => a.kind === 'img')
    const docs = iaAdj.filter((a) => a.kind === 'text')
    let t = prompt
    for (const dd0 of docs) t += '\n\nDOCUMENTO ADJUNTO «' + dd0.name + '»:\n' + dd0.text
    if (imgs.length) {
      const content = [
        ...imgs.map((a) => {
          const mm = String(a.src).match(/^data:([^;]+);base64,(.*)$/)
          return { type: 'image', source: { type: 'base64', media_type: mm ? mm[1] : 'image/jpeg', data: mm ? mm[2] : '' } }
        }),
        { type: 'text', text: t + '\n\nSe adjuntan imágenes como contexto visual: analízalas.' },
      ]
      return await complete({ system, messages: [{ role: 'user', content } as any], maxTokens: max } as any)
    }
    return await complete({ system, messages: [{ role: 'user', content: t }], maxTokens: max })
  }

  const generarMemoria = async () => {
    if (doc.memoria.generating) return
    if (!hasApiKey()) {
      up({ memoria: { ...doc.memoria, error: 'La redacción con IA no está disponible: falta la clave de API.' } })
      return
    }
    up({ memoria: { ...doc.memoria, generating: true, error: '' } })
    const p = doc.project
    const ctx = {
      proyecto: p.proyecto,
      tipo_documento: p.subtitulo,
      arquitecto: p.arquitecto,
      empresa: p.empresa,
      fecha: p.fecha,
      laminas: doc.sheets.map((sh) => ({ numero: sh.num, titulo: sh.tipo, escala: '1:' + sh.escala, formato: sh.size })),
      dibujos: doc.drawings
        .map((d) => {
          const m = models.current[d.id]
          if (!m) return null
          return {
            archivo: d.name,
            dimensiones_generales: m.bounds.w.toFixed(1) + ' × ' + m.bounds.h.toFixed(1) + ' ' + d.unit,
            capas: m.layers.slice(0, 30),
            rotulos_del_plano: m.texts.slice(0, 80).map((t) => t.t),
          }
        })
        .filter(Boolean),
      cuadros: doc.tables.map((t) => ({ titulo: t.titulo, columnas: t.cols, filas: t.rows })),
    }
    const prompt =
      'Redacta la memoria descriptiva de un proyecto de arquitectura para incluirla en una presentación con planos.\n\nDATOS EXTRAÍDOS DE LOS PLANOS Y DEL PROYECTO:\n' +
      JSON.stringify(ctx, null, 1) +
      '\n\nDIRECTRICES DEL AUTOR:\n' +
      (doc.memoria.directrices.trim() || '(Sin directrices específicas: redacta una memoria descriptiva estándar.)') +
      '\n\nResponde EXCLUSIVAMENTE con un array JSON válido, sin markdown, con este formato: [{"titulo":"...","contenido":"..."}]. Entre 4 y 7 secciones típicas de una memoria de proyecto de stand. En "contenido", párrafos separados por \\n\\n. Español técnico. Usa las superficies reales de los rótulos cuando existan; no inventes cifras.'
    try {
      const res = await askClaude(
        prompt,
        'Eres el responsable técnico de Ready Eventos, empresa española del Grupo IGC dedicada al diseño y montaje de stands de exposición. Redactas memorias técnicas claras y profesionales.',
        6000,
      )
      const t = String(res).trim()
      const a = t.indexOf('['),
        b = t.lastIndexOf(']')
      if (a < 0 || b <= a) throw new Error('respuesta con formato inesperado')
      const arr = JSON.parse(t.slice(a, b + 1))
      const sections = arr.map((x: any) => ({ titulo: String(x.titulo || '').trim() || 'Sección', contenido: String(x.contenido || '').trim() }))
      up({ memoria: { ...doc.memoria, generating: false, sections, error: '' } })
      setIaAdj([])
    } catch (err: any) {
      up({ memoria: { ...doc.memoria, generating: false, error: 'No se pudo generar la memoria (' + err.message + ').' } })
    }
  }

  const adjAdd = async (ev: any) => {
    const files = [...ev.target.files]
    ev.target.value = ''
    for (const f of files) {
      try {
        const id = 'adj' + Date.now() + Math.random().toString(36).slice(2, 6)
        if (/^image\//.test(f.type)) {
          const src = await fileToDataURL(f, 1200)
          setIaAdj((a) => [...a, { id, kind: 'img', name: f.name, src }])
        } else {
          let text = ''
          if (/\.pdf$/i.test(f.name)) text = await xl.extractPDFText(await f.arrayBuffer())
          else if (/\.xlsx$/i.test(f.name)) text = JSON.stringify(await xl.parseXLSX(await f.arrayBuffer()))
          else text = await f.text()
          text = String(text || '').slice(0, 9000)
          if (!text.trim()) throw new Error('sin texto legible')
          setIaAdj((a) => [...a, { id, kind: 'text', name: f.name, text }])
        }
      } catch (e2: any) {
        toast('No se pudo adjuntar «' + f.name + '»: ' + e2.message)
      }
    }
  }

  // ==== leyendas ====
  const updLeyenda = (shId: string, patch: any) => {
    const sh = sheetById(shId)
    upSheet(shId, { leyenda: { show: true, items: [], ...(sh?.leyenda || {}), ...patch } })
  }
  const generarLeyenda = async (shId: string) => {
    if (!hasApiKey()) {
      toast('La redacción con IA no está disponible en este entorno.')
      return
    }
    const sh = sheetById(shId)!
    const d = doc.drawings.find((x) => x.id === sh.drawingId)
    const m = d && models.current[d.id]
    setLeyGen(shId)
    const ctx = { tipo_de_plano: sh.tipo, capas: m ? m.layers : [], rotulos: m ? m.texts.slice(0, 60).map((t) => t.t) : [] }
    try {
      const res = await complete({
        system: 'Eres delineante experto de Ready Eventos, empresa española de diseño y montaje de stands de feria.',
        messages: [
          {
            role: 'user',
            content:
              'Plano técnico de un stand de feria. Datos del plano: ' +
              JSON.stringify(ctx) +
              '\n\nCrea la leyenda. Responde SOLO con un array JSON: [{"sym":"...","etiqueta":"..."}]. Símbolos disponibles: ' +
              LEYSYMS.join(', ') +
              '. Entre 3 y 8 elementos, etiquetas cortas en español.',
          },
        ],
        maxTokens: 1200,
      })
      const t = String(res)
      const a = t.indexOf('['),
        b = t.lastIndexOf(']')
      if (a < 0 || b <= a) throw new Error('formato inesperado')
      const arr = JSON.parse(t.slice(a, b + 1))
      const items = arr.map((x: any) => ({ sym: LEYSYMS.includes(x.sym) ? x.sym : 'linea', etiqueta: String(x.etiqueta || '').trim() })).filter((x: any) => x.etiqueta)
      setLeyGen(null)
      updLeyenda(shId, { show: true, items })
    } catch (err: any) {
      setLeyGen(null)
      toast('No se pudo generar la leyenda: ' + err.message)
    }
  }
  const interpretarLeyenda = async (shId: string, ev: any) => {
    const file = ev.target.files[0]
    ev.target.value = ''
    if (!file) return
    if (!hasApiKey()) {
      toast('La IA no está disponible en este entorno.')
      return
    }
    setLeyImg(shId)
    try {
      const src = await fileToDataURL(file, 1400)
      const mm2 = String(src).match(/^data:([^;]+);base64,(.*)$/)
      if (!mm2) throw new Error('imagen no válida')
      const res = await askClaude(
        'La imagen es la LEYENDA de un plano técnico. Interprétala y redibújala vectorialmente: devuelve TODOS los elementos como JSON {"titulo":"...","items":[{"sym":"...","etiqueta":"...","cant":"14"}]}. Catálogo de símbolos: ' +
          LEYSYMS.join(', ') +
          '. Elige para cada gráfico el símbolo más parecido. Responde SOLO con el JSON.',
        'Eres delineante experto de Ready Eventos. Interpretas leyendas de planos con fidelidad.',
        2500,
        [{ media: mm2[1], data: mm2[2] }],
      )
      const t = String(res)
      const a = t.indexOf('{'),
        b = t.lastIndexOf('}')
      if (a < 0 || b <= a) throw new Error('formato inesperado')
      const o = JSON.parse(t.slice(a, b + 1))
      const items = (o.items || [])
        .map((x: any) => ({ sym: LEYSYMS.includes(x.sym) ? x.sym : 'linea', etiqueta: String(x.etiqueta || '').trim(), cant: x.cant != null ? String(x.cant).slice(0, 8) : '' }))
        .filter((x: any) => x.etiqueta)
      if (!items.length) throw new Error('no se reconoció ningún elemento')
      setLeyImg(null)
      updLeyenda(shId, { show: true, items, titulo: String(o.titulo || '').trim() || undefined })
      toast('Leyenda interpretada: ' + items.length + ' elementos redibujados vectorialmente.')
    } catch (err: any) {
      setLeyImg(null)
      toast('No se pudo interpretar la imagen de leyenda: ' + err.message)
    }
  }

  // ==== tablas ====
  const onTablaFile = async (ev: any) => {
    const file = ev.target.files[0]
    ev.target.value = ''
    if (!file) return
    try {
      let rows: string[][]
      if (/\.xlsx$/i.test(file.name)) rows = await xl.parseXLSX(await file.arrayBuffer())
      else rows = xl.parseDelimited(await file.text())
      const t = xl.rowsToTable(rows)
      if (!t.rows.length) throw new Error('no se han encontrado filas con datos')
      up({ seq: doc.seq + 1, tables: [...doc.tables, { id: 't' + doc.seq, titulo: file.name.replace(/\.[^.]+$/, ''), cols: t.cols, rows: t.rows }] })
    } catch (err: any) {
      toast('No se pudo leer «' + file.name + '»: ' + err.message)
      setTab('tablas')
    }
  }
  const crearTablaDesdePaste = () => {
    if (!tablaPaste.trim()) return
    const t = xl.rowsToTable(xl.parseDelimited(tablaPaste))
    if (!t.rows.length) return
    setTablaPaste('')
    up({ seq: doc.seq + 1, tables: [...doc.tables, { id: 't' + doc.seq, titulo: 'Tabla importada', cols: t.cols, rows: t.rows }] })
  }
  const importarSuperficies = (tid: string) => {
    const rows: string[][] = []
    for (const d of doc.drawings) {
      const m = models.current[d.id]
      if (!m) continue
      const areas = m.texts.filter((t) => /m²|m2/i.test(t.t))
      const names = m.texts.filter((t) => !/m²|m2/i.test(t.t))
      for (const a of areas) {
        let best: any = null,
          bd = 1e9
        for (const nm of names) {
          const ddst = Math.hypot(nm.x - a.x, nm.y - a.y)
          if (ddst < bd) {
            bd = ddst
            best = nm
          }
        }
        const lim = (a.h || 1) * 8
        rows.push([best && bd < lim ? best.t : '—', a.t.replace(/m2/i, 'm²')])
      }
    }
    if (!rows.length) {
      toast('No se han encontrado rótulos de superficie (p. ej. «24,5 m²») en los planos.')
      return
    }
    up({ tables: doc.tables.map((t) => (t.id === tid ? { ...t, rows } : t)) })
  }
  const adaptarTablaIA = async (tid: string) => {
    if (!hasApiKey()) {
      toast('La IA no está disponible en este entorno.')
      return
    }
    const t0 = doc.tables.find((x) => x.id === tid)
    if (!t0) return
    setTablaIA(tid)
    try {
      const res = await complete({
        system: 'Eres el responsable de documentación técnica de Ready Eventos.',
        messages: [
          {
            role: 'user',
            content:
              'Tabla en bruto:\n' +
              JSON.stringify({ titulo: t0.titulo, cols: t0.cols, filas: t0.rows }) +
              '\n\nLímpiala y adáptala a una tabla de presentación profesional en español. No inventes datos. Responde SOLO con JSON: {"titulo":"...","cols":[...],"rows":[[...]]}.',
          },
        ],
        maxTokens: 4000,
      })
      const t = String(res)
      const a = t.indexOf('{'),
        b = t.lastIndexOf('}')
      if (a < 0 || b <= a) throw new Error('formato inesperado')
      const obj = JSON.parse(t.slice(a, b + 1))
      setTablaIA(null)
      if (obj.cols && obj.rows)
        up({ tables: doc.tables.map((x) => (x.id === tid ? { ...x, titulo: obj.titulo || x.titulo, cols: obj.cols.map(String), rows: obj.rows.map((r: any[]) => r.map(String)) } : x)) })
    } catch (err: any) {
      setTablaIA(null)
      toast('No se pudo adaptar la tabla con IA: ' + err.message)
      setTab('tablas')
    }
  }

  // ==== labels (etiquetas) IA + align ====
  const selNote0 = (): any => {
    if (!noteSel || !noteSel.idxs.length) return null
    const sh = sheetById(noteSel.shId)
    return (sh && (sh.notas || [])[noteSel.idxs[0]]) || null
  }
  const updNoteSel = (patch: Partial<Nota>) => {
    if (!noteSel) return
    const sh = sheetById(noteSel.shId)
    if (!sh) return
    const set = new Set(noteSel.idxs)
    upSheet(noteSel.shId, { notas: (sh.notas || []).map((n, j) => (set.has(j) ? { ...n, ...patch } : n)) })
  }
  const alinearNotas = () => {
    const sh = sheetById(toolSh)
    if (!sh || !(sh.notas || []).length) return
    const notas = sh.notas!
    const isBal = (n: Nota) => (n.style || 'dot') === 'balloon'
    const rights = notas.filter((n) => !isBal(n) && n.x2 >= n.x1)
    const lefts = notas.filter((n) => !isBal(n) && n.x2 < n.x1)
    const rx = rights.length ? Math.max(...rights.map((n) => n.x2)) : null
    const lx = lefts.length ? Math.min(...lefts.map((n) => n.x2)) : null
    upSheet(sh.id, { notas: notas.map((n) => (isBal(n) ? n : n.x2 >= n.x1 ? { ...n, x2: rx as number } : { ...n, x2: lx as number })) })
  }
  const generarNotasIA = async () => {
    if (notasIABusy) return
    if (!hasApiKey()) {
      toast('La IA no está disponible en este entorno.')
      return
    }
    const sh = sheetById(toolSh)
    const d = sh && doc.drawings.find((x) => x.id === sh.drawingId)
    const m = d && models.current[d.id]
    if (!m || !sh || !d) return
    setNotasIABusy(true)
    const b = sh.region || m.bounds
    const bx = { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY }
    const rot = m.texts
      .filter((t) => t.x >= bx.minX && t.x <= bx.maxX && t.y >= bx.minY && t.y <= bx.maxY)
      .slice(0, 60)
      .map((t) => ({ t: t.t, x: +t.x.toFixed(2), y: +t.y.toFixed(2) }))
    try {
      const res = await complete({
        system: 'Eres delineante experto de Ready Eventos. Colocas anotaciones claras y elegantes en planos.',
        messages: [
          {
            role: 'user',
            content:
              'Plano «' +
              sh.tipo +
              '» de un stand. Límites (' +
              d.unit +
              '): ' +
              JSON.stringify(bx) +
              '. Capas: ' +
              JSON.stringify(m.layers.slice(0, 25)) +
              '. Rótulos: ' +
              JSON.stringify(rot) +
              '\n\nPropón entre 3 y 7 etiquetas con línea guía: {"x1":..,"y1":..,"x2":..,"y2":..,"text":".."} — (x1,y1) punto señalado; (x2,y2) posición del texto. Textos cortos en español. Coordenadas dentro de los límites. Responde SOLO con el array JSON.',
          },
        ],
        maxTokens: 1500,
      })
      const t = String(res)
      const a = t.indexOf('['),
        e2 = t.lastIndexOf(']')
      if (a < 0 || e2 <= a) throw new Error('formato inesperado')
      const arr = JSON.parse(t.slice(a, e2 + 1))
      const cl = (v: any, lo: number, hi: number) => Math.max(lo, Math.min(hi, +v))
      const nuevas = arr
        .filter((n: any) => isFinite(+n.x1) && isFinite(+n.y1) && isFinite(+n.x2) && isFinite(+n.y2) && String(n.text || '').trim())
        .slice(0, 8)
        .map((n: any) => ({ x1: cl(n.x1, bx.minX, bx.maxX), y1: cl(n.y1, bx.minY, bx.maxY), x2: cl(n.x2, bx.minX, bx.maxX), y2: cl(n.y2, bx.minY, bx.maxY), text: String(n.text).trim(), style: 'dot' }))
      setNotasIABusy(false)
      if (nuevas.length) upSheet(sh.id, { notas: [...(sh.notas || []), ...nuevas] })
      else toast('La IA no propuso etiquetas válidas.')
    } catch (err: any) {
      setNotasIABusy(false)
      toast('No se pudieron generar etiquetas: ' + err.message)
    }
  }

  // ==== plan pointer interactions (notes + marquee + sketch) ====
  const dashDefault = dd
  const setStyle = (patch: Partial<DrawStyle>) => {
    setDd((prev) => ({ ...prev, ...patch }))
    if (sketchSel) {
      const sh = sheetById(sketchSel.shId)
      if (sh) upSheet(sketchSel.shId, { croquis: (sh.croquis || []).map((x, j) => (j === sketchSel.idx ? { ...x, ...patch } : x)) })
    }
  }
  const nearestSnap = (dId: string, p: number[], tol: number): number[] | null => {
    if (!snapCache.current[dId]) {
      const m = models.current[dId]
      const pts: number[][] = []
      if (m) {
        for (const e of m.ents) {
          if (lib.NOPLOT_RE.test(e.layer || '')) continue
          if (e.k === 'l') pts.push([e.x1, e.y1], [e.x2, e.y2])
          else if (e.k === 'p') for (const q of e.pts) pts.push([q[0], q[1]])
          else if (e.k === 'c') pts.push([e.cx, e.cy], [e.cx + e.r, e.cy], [e.cx - e.r, e.cy], [e.cx, e.cy + e.r], [e.cx, e.cy - e.r])
          else if (e.k === 'pt') pts.push([e.x, e.y])
        }
      }
      snapCache.current[dId] = pts
    }
    let best: number[] | null = null,
      bd = tol
    for (const q of snapCache.current[dId]) {
      const dd0 = Math.hypot(q[0] - p[0], q[1] - p[1])
      if (dd0 < bd) {
        bd = dd0
        best = q
      }
    }
    return best
  }
  const distSeg = (p: number[], a: number[], b: number[]) => {
    const dx = b[0] - a[0],
      dy = b[1] - a[1]
    const L2 = dx * dx + dy * dy
    if (!L2) return Math.hypot(p[0] - a[0], p[1] - a[1])
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
  }
  const hitEnt = (dId: string, p: number[], tol: number) => {
    const m = models.current[dId]
    if (!m) return -1
    let best = -1,
      bd = tol
    m.ents.forEach((e: any, i: number) => {
      if (lib.NOPLOT_RE.test(e.layer || '')) return
      let dd0 = Infinity
      if (e.k === 'l') dd0 = distSeg(p, [e.x1, e.y1], [e.x2, e.y2])
      else if (e.k === 'p') {
        for (let q = 1; q < e.pts.length; q++) dd0 = Math.min(dd0, distSeg(p, e.pts[q - 1], e.pts[q]))
        if (e.closed) dd0 = Math.min(dd0, distSeg(p, e.pts[e.pts.length - 1], e.pts[0]))
      } else if (e.k === 'c') dd0 = Math.abs(Math.hypot(p[0] - e.cx, p[1] - e.cy) - e.r)
      if (dd0 < bd) {
        bd = dd0
        best = i
      }
    })
    return best
  }
  const hitCroquis = (sh: Sheet, p: number[], tol: number) => {
    const arr = sh.croquis || []
    for (let i = arr.length - 1; i >= 0; i--) {
      const e = arr[i]
      let dd0 = Infinity
      if (e.k === 'l' || e.k === 'a' || e.k === 'd') dd0 = distSeg(p, [e.x1, e.y1], [e.x2, e.y2])
      else if (e.k === 't') {
        const hh = (e.h || 1) * 1.6
        const w = e.bw || Math.max(...String(e.text || '').split('\n').map((l: string) => l.length)) * (e.h || 1) * 0.58
        if (p[0] >= e.x - tol && p[0] <= e.x + w + tol && p[1] <= e.y + (e.h || 1) + tol && p[1] >= e.y - hh - tol) dd0 = 0
      } else if (e.k === 'r')
        dd0 = Math.min(
          distSeg(p, [e.x, e.y], [e.x + e.w, e.y]),
          distSeg(p, [e.x + e.w, e.y], [e.x + e.w, e.y + e.h]),
          distSeg(p, [e.x + e.w, e.y + e.h], [e.x, e.y + e.h]),
          distSeg(p, [e.x, e.y + e.h], [e.x, e.y]),
        )
      else if (e.k === 'c') dd0 = Math.abs(Math.hypot(p[0] - e.cx, p[1] - e.cy) - e.r)
      if (dd0 < tol) return i
    }
    return -1
  }

  const planClick = (sh: Sheet, d: any, vb: any, ev: any) => {
    ev.stopPropagation()
    if (drag.current.justDragged) {
      drag.current.justDragged = false
      return
    }
    const [x, y, dupp] = evPoint(ev, vb)
    const tol = dupp * 10
    if (String(tool || '').indexOf('draw-') === 0) {
      const hi = hitCroquis(sh, [x, y], tol)
      setSketchSel(hi >= 0 ? { shId: sh.id, idx: hi } : null)
      return
    }
    if (tool !== 'note') return
    if (noteAdding) {
      if (!notePend || notePend.shId !== sh.id) {
        setNotePend({ shId: sh.id, pt: [x, y] })
        setNoteSel(null)
      } else {
        const notas = [...(sh.notas || []), { x1: notePend.pt[0], y1: notePend.pt[1], x2: x, y2: y, text: notePreset || '', style: 'dot' } as Nota]
        setNotePend(null)
        setNoteAdding(false)
        setNoteSel({ shId: sh.id, idxs: [notas.length - 1] })
        upSheet(sh.id, { notas })
      }
      return
    }
    const ni = (sh.notas || []).findIndex((n) => Math.hypot(n.x2 - x, n.y2 - y) < tol * 2 || Math.hypot(n.x1 - x, n.y1 - y) < tol)
    if (ni >= 0) {
      if (ev.shiftKey && noteSel && noteSel.shId === sh.id) {
        const idxs = noteSel.idxs.includes(ni) ? noteSel.idxs.filter((q) => q !== ni) : [...noteSel.idxs, ni]
        setNoteSel(idxs.length ? { shId: sh.id, idxs } : null)
      } else setNoteSel({ shId: sh.id, idxs: [ni] })
      return
    }
    if (!ev.shiftKey) setNoteSel(null)
  }
  const planDown = (sh: Sheet, d: any, vb: any, ev: any) => {
    const tl = String(tool || '')
    if (tl.indexOf('draw-') === 0 && (toolSh === sh.id || toolSh === '*')) {
      ev.preventDefault()
      ev.stopPropagation()
      const [x, y, dupp] = evPoint(ev, vb)
      const hi = hitCroquis(sh, [x, y], dupp * 8)
      if (hi >= 0) {
        undoRef.current.push(doc)
        drag.current.sketch = { shId: sh.id, mode: 'move', idx: hi, last: [x, y], moved: false }
        setSketchSel({ shId: sh.id, idx: hi })
        return
      }
      const sp = nearestSnap(d.id, [x, y], dupp * 8)
      const p = sp || [x, y]
      const mm2du = sh.escala / (lib.UNIT_MM[d.unit] || 1000)
      drag.current.sketch = { shId: sh.id, mode: 'new', kind: tl.slice(5), x0: p[0], y0: p[1], moved: false, mm2du }
      return
    }
    if (tool !== 'note' || notePend || noteAdding) return
    const [x, y, dupp] = evPoint(ev, vb)
    const tol = dupp * 10
    const notas = sh.notas || []
    let idx = -1,
      part: string | null = null,
      bd = tol * 1.6
    notas.forEach((n, i) => {
      const d2 = Math.hypot(n.x2 - x, n.y2 - y)
      const d1 = Math.hypot(n.x1 - x, n.y1 - y)
      if (d2 < bd) {
        bd = d2
        idx = i
        part = 'txt'
      }
      if (d1 < bd) {
        bd = d1
        idx = i
        part = 'pt'
      }
    })
    if (idx >= 0) {
      ev.preventDefault()
      ev.stopPropagation()
      undoRef.current.push(doc)
      drag.current.noteDrag = { shId: sh.id, idx, part, moved: false, last: [x, y] }
    } else {
      ev.preventDefault()
      drag.current.marquee = { shId: sh.id, x0: x, y0: y, moved: false }
    }
  }
  const planMove = (sh: Sheet, d: any, vb: any, ev: any) => {
    const [x, y, dupp] = evPoint(ev, vb)
    const sk = drag.current.sketch
    if (sk && sk.shId === sh.id) {
      sk.moved = true
      if (sk.mode === 'move') {
        const dx = x - sk.last[0],
          dy = y - sk.last[1]
        sk.last = [x, y]
        liveSheet(sh.id, {
          croquis: (sheetById(sh.id)?.croquis || []).map((e, j) => {
            if (j !== sk.idx) return e
            if (e.k === 'l' || e.k === 'a' || e.k === 'd') return { ...e, x1: e.x1 + dx, y1: e.y1 + dy, x2: e.x2 + dx, y2: e.y2 + dy }
            if (e.k === 'r' || e.k === 't') return { ...e, x: e.x + dx, y: e.y + dy }
            if (e.k === 'c') return { ...e, cx: e.cx + dx, cy: e.cy + dy }
            return e
          }),
        })
      } else {
        const sp = nearestSnap(d.id, [x, y], dupp * 8)
        const p = sp ? [sp[0], sp[1]] : [x, y]
        if ((sk.kind === 'l' || sk.kind === 'a' || sk.kind === 'd') && ev.shiftKey) {
          if (Math.abs(p[0] - sk.x0) > Math.abs(p[1] - sk.y0)) p[1] = sk.y0
          else p[0] = sk.x0
        }
        setSketchGhost({ shId: sh.id, kind: sk.kind, x0: sk.x0, y0: sk.y0, x1: p[0], y1: p[1], mm2du: sk.mm2du })
      }
      return
    }
    const mq = drag.current.marquee
    if (mq && mq.shId === sh.id) {
      mq.moved = true
      setMarquee({ shId: sh.id, x0: mq.x0, y0: mq.y0, x1: x, y1: y })
      return
    }
    const nd = drag.current.noteDrag
    if (nd && nd.shId === sh.id) {
      nd.moved = true
      const group = nd.part === 'txt' && noteSel && noteSel.shId === sh.id && noteSel.idxs.length > 1 && noteSel.idxs.includes(nd.idx)
      if (group) {
        const dx2 = x - nd.last[0],
          dy2 = y - nd.last[1]
        nd.last = [x, y]
        const set = new Set(noteSel!.idxs)
        liveSheet(sh.id, { notas: (sh.notas || []).map((n, j) => (set.has(j) ? { ...n, x2: n.x2 + dx2, y2: n.y2 + dy2 } : n)) })
      } else {
        liveSheet(sh.id, { notas: (sh.notas || []).map((n, j) => (j !== nd.idx ? n : nd.part === 'pt' ? { ...n, x1: x, y1: y } : { ...n, x2: x, y2: y })) })
      }
      return
    }
    if (notePend && notePend.shId === sh.id) setHoverPt({ shId: sh.id, p: [x, y] })
  }
  const planUp = () => {
    const sk = drag.current.sketch
    if (sk) {
      drag.current.sketch = null
      if (sk.mode === 'move') {
        if (sk.moved) {
          drag.current.justDragged = true
          schedulePersist(doc)
        }
        return
      }
      const g = sketchGhost
      setSketchGhost(null)
      const dd0 = dashDefault
      const mm2du = sk.mm2du || 0.02
      const sh = sheetById(sk.shId)
      if (!sh) return
      if (sk.kind === 't' && !sk.moved) {
        const croquis = [...(sh.croquis || []), { k: 't', x: sk.x0, y: sk.y0, h: dd0.fs * mm2du, text: 'Texto', color: dd0.color, align: dd0.align, bold: dd0.bold, fill: dd0.tFill || undefined, border: dd0.tBorder || undefined }]
        setSketchSel({ shId: sh.id, idx: croquis.length - 1 })
        upSheet(sh.id, { croquis })
        return
      }
      if (sk.moved && g) {
        drag.current.justDragged = true
        let e: any = null
        const dx = g.x1 - g.x0,
          dy = g.y1 - g.y0
        const estilo = { color: dd0.color, grosor: dd0.grosor, dash: dd0.dash }
        const relleno = { fill: dd0.fill || undefined, noBorder: dd0.noBorder || undefined }
        if (g.kind === 'l') {
          if (Math.hypot(dx, dy) > 1e-9) e = { k: 'l', x1: g.x0, y1: g.y0, x2: g.x1, y2: g.y1, ...estilo }
        } else if (g.kind === 'a') {
          if (Math.hypot(dx, dy) > 1e-9) e = { k: 'a', x1: g.x0, y1: g.y0, x2: g.x1, y2: g.y1, ...estilo }
        } else if (g.kind === 'd') {
          if (Math.hypot(dx, dy) > 1e-9) e = { k: 'd', x1: g.x0, y1: g.y0, x2: g.x1, y2: g.y1, off: 8 * mm2du, color: dd0.color }
        } else if (g.kind === 'r') {
          const w = Math.abs(dx),
            h = Math.abs(dy)
          if (w > 1e-9 && h > 1e-9) e = { k: 'r', x: Math.min(g.x0, g.x1), y: Math.min(g.y0, g.y1), w, h, ...estilo, ...relleno }
        } else if (g.kind === 'c') {
          const r = Math.hypot(dx, dy)
          if (r > 1e-9) e = { k: 'c', cx: g.x0, cy: g.y0, r, ...estilo, ...relleno }
        } else if (g.kind === 't') {
          const bw = Math.abs(dx)
          if (bw > 1e-9) {
            const fs = dd0.fs * mm2du
            e = { k: 't', x: Math.min(g.x0, g.x1), y: Math.max(g.y0, g.y1) - fs, bw, h: fs, text: 'Escribe el texto en la barra inferior', color: dd0.color, align: dd0.align, bold: dd0.bold, fill: dd0.tFill || undefined, border: dd0.tBorder || undefined }
          }
        }
        if (e) {
          const croquis = [...(sh.croquis || []), e]
          setSketchSel({ shId: sh.id, idx: croquis.length - 1 })
          upSheet(sh.id, { croquis })
        }
      }
      return
    }
    const mq = drag.current.marquee
    if (mq) {
      drag.current.marquee = null
      const box = marquee
      setMarquee(null)
      if (mq.moved && box) {
        drag.current.justDragged = true
        const sh = sheetById(box.shId)
        if (sh) {
          const bx0 = Math.min(box.x0, box.x1),
            bx1 = Math.max(box.x0, box.x1)
          const by0 = Math.min(box.y0, box.y1),
            by1 = Math.max(box.y0, box.y1)
          const idxs: number[] = []
          ;(sh.notas || []).forEach((n, i) => {
            const nx0 = Math.min(n.x1, n.x2),
              nx1 = Math.max(n.x1, n.x2)
            const ny0 = Math.min(n.y1, n.y2),
              ny1 = Math.max(n.y1, n.y2)
            if (nx0 <= bx1 && nx1 >= bx0 && ny0 <= by1 && ny1 >= by0) idxs.push(i)
          })
          setNoteSel(idxs.length ? { shId: box.shId, idxs } : null)
        }
      }
      return
    }
    const nd = drag.current.noteDrag
    if (!nd) return
    drag.current.noteDrag = null
    if (nd.moved) {
      drag.current.justDragged = true
      if (!(noteSel && noteSel.shId === nd.shId && noteSel.idxs.includes(nd.idx))) setNoteSel({ shId: nd.shId, idxs: [nd.idx] })
      schedulePersist(doc)
    }
  }

  // ==== zone pointer interactions ====
  const zoneDown = (sh: Sheet, d: any, vb: any, ev: any) => {
    const [x, y, dupp] = evPoint(ev, vb)
    const tol = dupp * 8
    ev.preventDefault()
    const zonas = sh.zonas || []
    const sel = zoneSel && zoneSel.shId === sh.id ? zonas[zoneSel.idx] : null
    if (sel && sel.w !== undefined && Math.hypot(x - (sel.x + sel.w), y - sel.y) < tol * 1.8) {
      undoRef.current.push(doc)
      drag.current.zdrag = { mode: 'resize', shId: sh.id, idx: zoneSel!.idx, moved: false }
      return
    }
    let idx = -1
    for (let i = zonas.length - 1; i >= 0; i--) {
      const z = zonas[i]
      if (z.w !== undefined && x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) {
        idx = i
        break
      }
    }
    if (idx >= 0) {
      undoRef.current.push(doc)
      drag.current.zdrag = { mode: 'move', shId: sh.id, idx, dx: x - zonas[idx].x, dy: y - zonas[idx].y, moved: false }
    } else {
      drag.current.zdrag = { mode: 'create', shId: sh.id, x0: x, y0: y, moved: false }
    }
  }
  const zoneMove = (sh: Sheet, d: any, vb: any, ev: any) => {
    const zd = drag.current.zdrag
    if (!zd || zd.shId !== sh.id) return
    const [x, y] = evPoint(ev, vb)
    zd.moved = true
    if (zd.mode === 'create') setZoneGhost({ shId: sh.id, x0: zd.x0, y0: zd.y0, x1: x, y1: y })
    else if (zd.mode === 'move') {
      const z = (sh.zonas || [])[zd.idx]
      if (!z) return
      const nx = x - zd.dx,
        ny = y - zd.dy
      const ddx = nx - z.x,
        ddy = ny - z.y
      updZona(sh.id, zd.idx, { x: nx, y: ny, poly: z.poly ? z.poly.map((p) => [p[0] + ddx, p[1] + ddy]) : z.poly }, false)
    } else if (zd.mode === 'resize') {
      const z = (sh.zonas || [])[zd.idx]
      if (!z) return
      const w2 = Math.max(1e-6, x - z.x),
        h2 = Math.max(1e-6, z.y + z.h - y)
      const sx = w2 / z.w,
        sy = h2 / z.h
      const yTop = z.y + z.h
      updZona(sh.id, zd.idx, { w: w2, h: h2, y: yTop - h2, poly: z.poly ? z.poly.map((p) => [z.x + (p[0] - z.x) * sx, yTop - (yTop - p[1]) * sy]) : z.poly }, false)
    }
  }
  const zoneUp = (sh: Sheet) => {
    const zd = drag.current.zdrag
    if (!zd || zd.shId !== sh.id) return
    drag.current.zdrag = null
    if (zd.mode === 'create') {
      const g = zoneGhost
      setZoneGhost(null)
      if (zd.moved && g) {
        const x = Math.min(g.x0, g.x1),
          y = Math.min(g.y0, g.y1)
        const w = Math.abs(g.x1 - g.x0),
          h = Math.abs(g.y1 - g.y0)
        if (w > 0.001 && h > 0.001) {
          drag.current.justDragged = true
          const zonas = [...(sh.zonas || []), { id: 'z' + Date.now(), name: 'Zona ' + ((sh.zonas || []).length + 1), src: '', fit: 'cover', rot: 0, x, y, w, h } as Zona]
          setZoneSel({ shId: sh.id, idx: zonas.length - 1 })
          upSheet(sh.id, { zonas })
        }
      }
    } else {
      if (zd.moved) {
        drag.current.justDragged = true
        schedulePersist(doc)
      }
      setZoneSel({ shId: zd.shId, idx: zd.idx })
    }
  }
  const zoneClick = (sh: Sheet, d: any, vb: any, ev: any) => {
    if (drag.current.justDragged) {
      drag.current.justDragged = false
      return
    }
    const [x, y, dupp] = evPoint(ev, vb)
    const zonas = sh.zonas || []
    for (let i = zonas.length - 1; i >= 0; i--) {
      const z = zonas[i]
      if (z.w !== undefined && x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) {
        setZoneSel({ shId: sh.id, idx: i })
        return
      }
    }
    const ei = hitEnt(d.id, [x, y], dupp * 10)
    if (ei >= 0) {
      const e = models.current[d.id].ents[ei]
      let bb: any = null,
        poly: number[][] | null = null
      if (e.k === 'p' && e.pts.length > 1) {
        const xs = e.pts.map((p: number[]) => p[0]),
          ys = e.pts.map((p: number[]) => p[1])
        bb = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
        if (e.closed && e.pts.length > 2) poly = e.pts.map((p: number[]) => [p[0], p[1]])
      } else if (e.k === 'l') bb = { x: Math.min(e.x1, e.x2), y: Math.min(e.y1, e.y2), w: Math.abs(e.x2 - e.x1), h: Math.abs(e.y2 - e.y1) }
      else if (e.k === 'c' || e.k === 'a') bb = { x: e.cx - e.r, y: e.cy - e.r, w: 2 * e.r, h: 2 * e.r }
      if (bb && bb.w > 0.0001 && bb.h > 0.0001) {
        const zonas2 = [...zonas, { id: 'z' + Date.now(), name: 'Zona ' + (zonas.length + 1), src: '', fit: 'cover', rot: 0, ...bb, poly, circle: e.k === 'c' } as Zona]
        setZoneSel({ shId: sh.id, idx: zonas2.length - 1 })
        upSheet(sh.id, { zonas: zonas2 })
        return
      }
    }
    setZoneSel(null)
  }
  const onZoneFile = async (ev: any) => {
    const file = ev.target.files[0]
    ev.target.value = ''
    if (!file || !zoneSel) return
    try {
      const src = await fileToDataURL(file)
      updZona(zoneSel.shId, zoneSel.idx, { src }, true)
    } catch (e: any) {
      toast('No se pudo cargar la imagen: ' + e.message)
    }
  }

  // ==== sheet ops ====
  const addSheet = () => {
    const first = doc.drawings[0]
    up({ seq: doc.seq + 1, sheets: [...doc.sheets, { id: 's' + doc.seq, drawingId: first ? first.id : '', num: nextNum(), tipo: 'Planta — Distribución', escala: 100, size: 'A3', orient: 'l' }] })
  }
  const dupSheet = (shId: string) => {
    const sh = sheetById(shId)
    if (!sh) return
    const i = doc.sheets.findIndex((x) => x.id === shId)
    const copia = JSON.parse(JSON.stringify(sh))
    copia.id = 's' + doc.seq
    const usados = new Set(doc.sheets.map((x) => x.num))
    let n2 = doc.sheets.length + 1
    while (usados.has('A-' + String(n2).padStart(2, '0'))) n2++
    copia.num = 'A-' + String(n2).padStart(2, '0')
    const sheets = [...doc.sheets]
    sheets.splice(i + 1, 0, copia)
    up({ seq: doc.seq + 1, sheets })
  }
  const moveSheet = (shId: string, dir: number) => {
    const arr = [...doc.sheets]
    const i = arr.findIndex((x) => x.id === shId)
    const j = i + dir
    if (i < 0 || j < 0 || j >= arr.length) return
    const t = arr[i]
    arr[i] = arr[j]
    arr[j] = t
    up({ sheets: renumberAll(arr) })
  }
  const delSheetConfirm = (id: string) => {
    if (shDelPend === id) {
      setShDelPend(null)
      up({ sheets: doc.sheets.filter((x) => x.id !== id) })
      toast('Plano eliminado.', true)
    } else {
      setShDelPend(id)
      setTimeout(() => setShDelPend((v) => (v === id ? null : v)), 3000)
    }
  }
  const selectSheet = (shId: string, opts?: { goDoc?: boolean }) => {
    setSelSheet(shId)
    setTab('planos')
    if (opts?.goDoc) setVista('doc')
  }

  // ==== PDF export ====
  const loadCdn = (src: string) =>
    new Promise<void>((res, rej) => {
      const s = document.createElement('script')
      s.src = src
      s.onload = () => res()
      s.onerror = () => rej(new Error('no se pudo cargar ' + src))
      document.head.appendChild(s)
    })
  const doExportPdf = async () => {
    if (exporting) return
    let HTI = (window as any).htmlToImage
    let JSPDF = ((window as any).jspdf || {}).jsPDF
    if (!HTI || !JSPDF) {
      try {
        if (!HTI) await loadCdn('https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/dist/html-to-image.js')
        if (!JSPDF) await loadCdn('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js')
        HTI = (window as any).htmlToImage
        JSPDF = ((window as any).jspdf || {}).jsPDF
      } catch (e) {}
    }
    setTool(null)
    setToolSh(null)
    setNoteSel(null)
    setZoneEdit(null)
    setZoneSel(null)
    setSketchSel(null)
    if (!HTI || !JSPDF) {
      setTimeout(() => window.print(), 120)
      return
    }
    setExporting('Preparando…')
    await new Promise((r) => setTimeout(r, 150))
    try {
      await (document as any).fonts.ready
    } catch (e) {}
    const pages = Array.from(document.querySelectorAll('[data-page]')) as HTMLElement[]
    if (!pages.length) {
      setExporting('')
      return
    }
    const PX2MM = 25.4 / 96
    const RATIO = 300 / 96
    const A4H = 297,
      MARG = 14,
      CONT = A4H - MARG * 2
    let pdf: any = null
    try {
      for (let i = 0; i < pages.length; i++) {
        setExporting(i + 1 + ' / ' + pages.length + '…')
        await new Promise((r) => setTimeout(r, 40))
        const el = pages[i]
        const canvas = await HTI.toCanvas(el, { pixelRatio: RATIO, backgroundColor: '#FFFFFF', filter: (n: any) => !(n.getAttribute && n.getAttribute('data-noprint')), style: { boxShadow: 'none', margin: '0' } })
        const wmm = el.offsetWidth * PX2MM,
          hmm = el.offsetHeight * PX2MM
        const isDoc = el.hasAttribute('data-docpage')
        if (isDoc && hmm > A4H + 2) {
          const pxPerMM = canvas.height / hmm
          const contPx = Math.floor(CONT * pxPerMM)
          let y = 0
          while (y < canvas.height - 2) {
            const slice = Math.min(contPx, canvas.height - y)
            const c2 = document.createElement('canvas')
            c2.width = canvas.width
            c2.height = slice
            const ctx = c2.getContext('2d')!
            ctx.fillStyle = '#FFFFFF'
            ctx.fillRect(0, 0, c2.width, c2.height)
            ctx.drawImage(canvas, 0, y, canvas.width, slice, 0, 0, canvas.width, slice)
            const img2 = c2.toDataURL('image/jpeg', 0.93)
            if (!pdf) pdf = new JSPDF({ unit: 'mm', format: [210, A4H], orientation: 'p', compress: true })
            else pdf.addPage([210, A4H], 'p')
            pdf.addImage(img2, 'JPEG', 0, MARG, wmm, slice / pxPerMM)
            c2.width = c2.height = 0
            y += slice
          }
        } else {
          const img = canvas.toDataURL('image/jpeg', 0.93)
          const orient = wmm >= hmm ? 'l' : 'p'
          if (!pdf) pdf = new JSPDF({ unit: 'mm', format: [wmm, hmm], orientation: orient, compress: true })
          else pdf.addPage([wmm, hmm], orient)
          pdf.addImage(img, 'JPEG', 0, 0, wmm, hmm)
        }
        canvas.width = canvas.height = 0
      }
      const nm = (projName.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'presentacion')
      pdf.save(nm + '.pdf')
      setExporting('')
    } catch (err) {
      setExporting('')
      setTimeout(() => window.print(), 80)
    }
  }

  // ---- derived (favs snapshot for render) ----
  const favs = getFavs()

  return (
    <PlanosView
      projectId={projectId}
      projName={projName}
      doc={doc}
      ready={ready}
      tab={tab}
      setTab={setTab}
      zoom={zoom}
      setZoom={(z) => setZoom(z)}
      vista={vista}
      setVista={setVista}
      notice={notice}
      noticeUndo={noticeUndo}
      clearNotice={() => {
        setNotice('')
        setNoticeUndo(false)
      }}
      undoDo={undo}
      redoDo={redo}
      canUndo={undoRef.current.length > 0}
      canRedo={redoRef.current.length > 0}
      saving={saving}
      exporting={exporting}
      selSheet={selSheet}
      ctxMenu={ctxMenu}
      setCtxMenu={setCtxMenu}
      shDelPend={shDelPend}
      tool={tool}
      toolSh={toolSh}
      noteSel={noteSel}
      notePend={notePend}
      noteAdding={noteAdding}
      setNoteAdding={setNoteAdding}
      notePreset={notePreset}
      setNotePreset={setNotePreset}
      hoverPt={hoverPt}
      marquee={marquee}
      zoneEdit={zoneEdit}
      setZoneEdit={setZoneEdit}
      zoneSel={zoneSel}
      setZoneSel={setZoneSel}
      zoneGhost={zoneGhost}
      sketchSel={sketchSel}
      sketchGhost={sketchGhost}
      dd={dd}
      leyGen={leyGen}
      leyImg={leyImg}
      tablaIA={tablaIA}
      notasIABusy={notasIABusy}
      iaAdj={iaAdj}
      setIaAdj={setIaAdj}
      tablaPaste={tablaPaste}
      setTablaPaste={setTablaPaste}
      leyNames={leyNames}
      setLeyNames={setLeyNames}
      favs={favs}
      models={models}
      raws={raws}
      svgCache={svgCache}
      thumbCache={thumbCache}
      framesCache={framesCache}
      // actions
      up={up}
      upSheet={upSheet}
      toast={toast}
      isRotulLayer={isRotulLayer}
      isMarcoLayer={isMarcoLayer}
      viewport={viewport}
      planSizeMM={planSizeMM}
      suggestScale={suggestScale}
      vbFor={vbFor}
      onFile={onFile}
      detectar={detectar}
      detectarZonas={detectarZonas}
      updZona={updZona}
      selZona={selZona}
      addSheet={addSheet}
      dupSheet={dupSheet}
      moveSheet={moveSheet}
      delSheetConfirm={delSheetConfirm}
      selectSheet={selectSheet}
      setTool={setTool}
      setToolSh={setToolSh}
      setNoteSel={setNoteSel}
      setSketchSel={setSketchSel}
      setStyle={setStyle}
      updNoteSel={updNoteSel}
      selNote0={selNote0}
      alinearNotas={alinearNotas}
      generarNotasIA={generarNotasIA}
      generarMemoria={generarMemoria}
      adjAdd={adjAdd}
      updLeyenda={updLeyenda}
      generarLeyenda={generarLeyenda}
      interpretarLeyenda={interpretarLeyenda}
      onTablaFile={onTablaFile}
      crearTablaDesdePaste={crearTablaDesdePaste}
      importarSuperficies={importarSuperficies}
      adaptarTablaIA={adaptarTablaIA}
      onZoneFile={onZoneFile}
      doExportPdf={doExportPdf}
      overlayHandlers={{ planClick, planDown, planMove, planUp, zoneClick, zoneDown, zoneMove, zoneUp }}
      sheetById={sheetById}
      bump={bump}
    />
  )
}
