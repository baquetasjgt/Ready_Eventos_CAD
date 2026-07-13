// Documento de venta — full editor, ported from the design prototype
// (project/Documento de venta.dc.html). The prototype was a class extending a
// custom DCLogic runtime; here it is a real React class component so the logic
// methods carry over almost verbatim. Integration points swapped:
//   - project comes from the route (props.projectId), not an in-app switcher
//   - window.claude.complete(...)  -> complete(...) from src/lib/claude
//   - xlsx-lite.js / pdf text      -> src/features/venta/xlsx + src/lib/pdf
//   - persistence                  -> read/write(KEYS.venta(id)) + IndexedDB
import React, { Component } from 'react'
import { Link } from 'react-router-dom'
import { KEYS, read, write } from '../../lib/storage'
import { complete, hasApiKey } from '../../lib/claude'
import RevisionLayer from '../revision/RevisionLayer'
import RevisionBar from '../revision/RevisionBar'
import { bajarDataUrl, subirDataUrl } from '../../lib/files'
import { supabase, supabaseReady } from '../../lib/supabase'
import VersionesModal from '../versiones/VersionesModal'
import { pdfText } from '../../lib/pdf'
import * as XL from './xlsx'
import type { Imagen, Slide, Presupuesto, Anota, CollageItem } from './types'

const R = React.createElement

interface Props {
  projectId: string
  acento?: string
}

interface VState {
  projId: string | null
  projName: string
  fase: string
  tab: string
  zoom: number
  datos: Record<string, string>
  imagenes: Imagen[]
  slides: Slide[]
  presupuesto: Presupuesto
  generating: boolean
  error: string
  presuIA: boolean
  paste: string
  notice: string
  seq: number
  pdfBusy: boolean
  presuPrompt: string
  presuEdit: boolean
  iaAdj: any[]
  micOn: string | null
  modalPresu: boolean
  dragIdx: number | null
  overIdx: number | null
  overOut: boolean
  slDrag: number | null
  slOver: number | null
  iaPrompt: string
  iaPrompts: Record<string, string>
  iaBusyId: string | null
  iaError: string
  imgSel: { sid: string; k: number } | null
  saving?: boolean
  noticeUndo?: boolean
  ctxMenu?: { x: number; y: number; slId: string } | null
  clSel?: { sid: string; idx: number } | null
  clCrop?: boolean
  clPick?: Record<string, string>
  dTool?: string | null
  dSel?: { slId: string; idx: number } | null
  dGhost?: any
  vdd?: any
  dragSlot?: { sid: string; k: number } | null
  slDelPend?: string | null
  edRev?: number
  libSel?: string
  vista?: 'doc' | 'grid'
  gridOver?: string | null
  imgDelPend?: string | null
  pdfExporting?: string
  modalVers?: boolean
  modalShare?: boolean
  shareBusy?: boolean
  shareUrl?: string
  shareCopied?: boolean
  shareList?: { name: string; url: string }[]
}

const SANS = "'Archivo','Helvetica Neue',Helvetica,sans-serif"
const MONO = "'JetBrains Mono',monospace"

const GLOBAL_CSS = `
@keyframes gcspin { to { transform: rotate(360deg); } }
@keyframes slotlabel { 0%,100% { transform: scale(1); } 50% { transform: scale(1.06); } }
@keyframes slotpulse { 0%,100% { outline-offset:-2mm; outline-color:#D6197E; } 50% { outline-offset:-4.5mm; outline-color:#F06AB4; } }
.venta-ed:focus { outline:1.5px dashed #D6197E; outline-offset:3px; background:rgba(214,25,126,0.06); }
.venta-ctxbtn:hover { background:#F4F3F0; }
.venta-ctxbtn-del:hover { background:#FBF1F6; }
.venta-page { page: a4l; break-after: page; }
@page { margin: 0; }
@page a4l { size: 297mm 210mm; margin: 0; }
@media print {
  html, body { background:#fff !important; }
  [data-ui] { display:none !important; }
  .venta-page { box-shadow:none !important; margin:0 !important; }
  /* Imprimir siempre a tamaño real, ignorando el zoom de pantalla */
  .venta-zoomwrap { zoom: 1 !important; }
  .venta-ph { visibility: hidden !important; }
}
`

// Parse tolerante de un objeto JSON de la IA: quita vallas markdown, recorta
// texto sobrante alrededor y, si la respuesta llegó cortada (los modelos
// "pensantes" agotan tokens y truncan), intenta cerrar las llaves/corchetes
// pendientes para rescatar lo que haya.
function salvageObj(raw: string): any {
  let t = String(raw || '').trim()
  t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '')
  const a = t.indexOf('{')
  if (a < 0) throw new Error('la IA no ha devuelto el formato esperado — vuelve a intentarlo')
  // 1) el mayor {...} válido recortando desde el final
  for (let end = t.lastIndexOf('}'); end > a; end = t.lastIndexOf('}', end - 1)) {
    try { return JSON.parse(t.slice(a, end + 1)) } catch { /* seguir recortando */ }
  }
  // 2) respuesta truncada: cerrar cadenas y llaves abiertas y reintentar
  let s = t.slice(a)
  let inStr = false, esc = false
  const stack: string[] = []
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
    } else if (ch === '"') inStr = true
    else if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') stack.pop()
  }
  if (inStr) s += '"'
  s = s.replace(/,\s*$/, '')
  while (stack.length) s += stack.pop()
  try { return JSON.parse(s) } catch { /* nada que rescatar */ }
  throw new Error('la IA no ha devuelto el formato esperado — vuelve a intentarlo')
}

// Parse the AI's document JSON tolerantly: strips markdown fences, and if the
// JSON is truncated (thinking models can cut the output mid-array) it salvages
// every fully-formed slide object instead of failing outright.
function salvageSlides(raw: string): { slides: any[] } {
  let t = String(raw || '').trim()
  t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '')
  const a = t.indexOf('{')
  if (a < 0) throw new Error('formato inesperado')
  // 1) try to parse the largest valid {...} by trimming from the end
  for (let end = t.lastIndexOf('}'); end > a; end = t.lastIndexOf('}', end - 1)) {
    try {
      const o = JSON.parse(t.slice(a, end + 1))
      if (o && Array.isArray(o.slides)) {
        if (o.slides.length) return o
        throw new Error('la IA no ha devuelto láminas')
      }
    } catch (e: any) {
      if (e?.message === 'la IA no ha devuelto láminas') throw e
      /* keep trimming */
    }
  }
  // 2) repair a truncated "slides":[ … ] by reading complete objects only
  const m = t.match(/"slides"\s*:\s*\[/)
  if (m && m.index != null) {
    const slides: any[] = []
    let i = m.index + m[0].length
    while (i < t.length) {
      while (i < t.length && /[\s,]/.test(t[i])) i++
      if (t[i] !== '{') break
      let depth = 0,
        j = i,
        inStr = false,
        esc = false
      for (; j < t.length; j++) {
        const ch = t[j]
        if (inStr) {
          if (esc) esc = false
          else if (ch === '\\') esc = true
          else if (ch === '"') inStr = false
        } else if (ch === '"') inStr = true
        else if (ch === '{') depth++
        else if (ch === '}') {
          depth--
          if (depth === 0) {
            j++
            break
          }
        }
      }
      if (depth !== 0) break // object was cut off
      try {
        slides.push(JSON.parse(t.slice(i, j)))
      } catch {
        break
      }
      i = j
    }
    if (slides.length) return { slides }
  }
  throw new Error('formato inesperado')
}

export default class VentaApp extends Component<Props, VState> {
  xl: any
  _idbp: Promise<IDBDatabase> | null = null
  _undo: any[] = []
  _redo: any[] = []
  _wlt = 0
  _pt: any = null
  _ntT: any = null
  _sdp: any = null
  _dDrag: any = null
  _rec: any = null
  _dKeys: any = null
  _undoSig = ''
  _undoAt = 0
  _idp: any = null
  _gridDrag: string | null = null
  _imgAr: Record<string, number> = {}

  LIBKEY = 'ready-slide-lib'
  FAVKEY = 'ready-fav-colors'
  UNDOABLE = ['slides', 'imagenes', 'datos', 'presupuesto']
  TIPOS_OK = ['hero', 'quienes', 'split', 'fullimg', 'dark', 'gallery3', 'text', 'presupuesto', 'cierre', 'libre', 'columnas2', 'timeline', 'ficha', 'collage']
  TR0 = { s: 1, ox: 50, oy: 50, mask: 'none', fx: 'none' }
  MASKS: Record<string, string> = {
    none: '',
    'fade-r': 'linear-gradient(to right, #000 50%, transparent 99%)',
    'fade-l': 'linear-gradient(to left, #000 50%, transparent 99%)',
    'fade-t': 'linear-gradient(to top, #000 50%, transparent 99%)',
    'fade-b': 'linear-gradient(to bottom, #000 50%, transparent 99%)',
    'fade-edges': 'radial-gradient(ellipse 75% 75% at center, #000 45%, transparent 98%)',
  }
  FXS: Record<string, string> = {
    none: '',
    bn: 'grayscale(1)',
    'bn-contraste': 'grayscale(1) contrast(1.3) brightness(1.05)',
    calido: 'sepia(0.32) saturate(1.15)',
    suave: 'saturate(0.8) brightness(1.06)',
    oscuro: 'brightness(0.7) saturate(0.95)',
  }
  EXTRA_SPEC = '\n- "columnas2": comparativa a dos columnas; "texto" = dos bloques separados por línea en blanco, la primera línea de cada bloque es su subtítulo; hasta 2 imágenes (una por columna).\n- "timeline": cronograma de montaje; "texto" = 3–6 líneas "Hito: descripción corta" (p. ej. "Diseño: aprobación del proyecto"); sin imágenes.\n- "ficha": ficha técnica del stand; "texto" = líneas "Clave: valor" (Superficie: 18 m², Altura: 3,5 m…); 1 imagen lateral.'
  COLLAGE_SPEC = '\n- "collage": lienzo en blanco donde el usuario compone a mano imágenes superpuestas con fusión; créala vacía (sin textos ni imágenes) solo si el usuario la pide; conserva su campo "collage" intacto si ya existe.'
  LIBRE_SPEC = '\n- "libre": composición libre para cuando ninguna plantilla exprese bien el contenido o quieras más impacto. Define "bg" (hex del fondo) y "bloques": hasta 14 cajas posicionadas en porcentaje de la lámina A4 apaisada (x,y = esquina superior izquierda; w,h = tamaño; 0–100). Cada bloque: {"kind":"text"|"image"|"rect"|"logo","x":..,"y":..,"w":..,"h":..} y según kind: text → "text","size" (pt, 7–60),"weight" (400–800),"color" hex,"align":"left|center|right","mono":true para rótulos tipo kicker,"lh" interlineado,"ls" letter-spacing en em; image → "imgId" de las imágenes disponibles; rect → "color" hex de relleno (para franjas y acentos); logo → el logo de Ready Eventos (mantén su proporción, fondo blanco si el fondo es oscuro). Estética de marca: fondos #FFFFFF o #17161A, acento #D6197E, mucho aire, jerarquía tipográfica clara.'

  state: VState = {
    projId: null,
    projName: '',
    fase: 'brief',
    tab: 'laminas',
    zoom: 0.5,
    datos: { cliente: '', web: '', feria: '', stand: '', objetivo: '', productos: '', descripcion: '', directrices: '' },
    imagenes: [],
    slides: [],
    presupuesto: this.defaults().presupuesto,
    generating: false,
    error: '',
    presuIA: false,
    paste: '',
    notice: '',
    seq: 1,
    pdfBusy: false,
    presuPrompt: '',
    presuEdit: false,
    iaAdj: [],
    micOn: null,
    modalPresu: false,
    dragIdx: null,
    overIdx: null,
    overOut: false,
    slDrag: null,
    slOver: null,
    iaPrompt: '',
    iaPrompts: {},
    iaBusyId: null,
    iaError: '',
    imgSel: null,
    vista: 'doc',
    gridOver: null,
  }

  // ---- AI adapter (was window.claude.complete) ----
  aiAvail() {
    return hasApiKey()
  }
  claude = async (opts: { messages: any[]; system?: string; max_tokens?: number }): Promise<string> => {
    return complete({ system: opts.system, messages: opts.messages as any, maxTokens: opts.max_tokens })
  }

  componentDidMount() {
    this.xl = {
      parseXLSX: XL.parseXLSX,
      parseDelimited: XL.parseDelimited,
      rowsToTable: XL.rowsToTable,
      num: XL.num,
      fmtEUR: XL.fmtEUR,
      sumLastCol: XL.sumLastCol,
      extractPDFText: (buf: ArrayBuffer) => pdfText(buf),
    }
    this.boot()
    this._revScroll()
    window.addEventListener('hashchange', this._revScroll)
    if (!this._dKeys) {
      this._dKeys = (ev: KeyboardEvent) => {
        const tag = ((ev.target as any) && (ev.target as any).tagName) || ''
        if (/INPUT|TEXTAREA|SELECT/.test(tag) || (ev.target && (ev.target as any).isContentEditable)) return
        const mod = ev.ctrlKey || ev.metaKey
        if (mod && (ev.key === 'z' || ev.key === 'Z') && !ev.shiftKey) { ev.preventDefault(); this.undo(); return }
        if (mod && ((ev.key === 'y' || ev.key === 'Y') || ((ev.key === 'z' || ev.key === 'Z') && ev.shiftKey))) { ev.preventDefault(); this.redo(); return }
        if (mod && (ev.key === 'd' || ev.key === 'D')) {
          const sid = (this.state.dSel && this.state.dSel.slId) || (this.state.imgSel && this.state.imgSel.sid) || (this.state.clSel && this.state.clSel.sid)
          if (sid) { ev.preventDefault(); this.dupSlide(sid); this.toast('Lámina duplicada.', true) }
          return
        }
        if (ev.key === 'Escape' && (this.state.ctxMenu || this.state.imgSel || this.state.clSel)) { this.setState({ ctxMenu: null, imgSel: null, clSel: null }); return }
        if (ev.key === 'Escape' && this.state.dTool) this.setState({ dTool: null, dSel: null, dGhost: null })
        else if ((ev.key === 'Delete' || ev.key === 'Backspace') && this.state.dSel) {
          ev.preventDefault()
          const ds = this.state.dSel
          const sl2 = this.state.slides.find((x) => x.id === ds.slId)
          this.setState({ dSel: null })
          if (sl2) this.updAnota(ds.slId, ((sl2.anota) || []).filter((_x, j) => j !== ds.idx))
        }
      }
      document.addEventListener('keydown', this._dKeys)
    }
  }

  // Llegada desde una tarea con post-it (#lamina=<id>): desplazarse hasta la
  // lámina en cuanto esté renderizada.
  _revScroll = () => {
    const m = window.location.hash.match(/lamina=([^&]+)/)
    if (!m) return
    const id = decodeURIComponent(m[1])
    this.setState({ vista: 'doc' }, () => {
      let tries = 0
      const go = () => {
        const el = document.querySelector(`[data-rev-page="${CSS.escape(id)}"]`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        else if (tries++ < 25) setTimeout(go, 150)
      }
      go()
    })
  }

  componentWillUnmount() {
    window.removeEventListener('hashchange', this._revScroll)
    if (this._dKeys) document.removeEventListener('keydown', this._dKeys)
    clearTimeout(this._pt)
    clearTimeout(this._ntT)
    clearTimeout(this._sdp)
    clearTimeout(this._idp)
    try { this._rec && this._rec.stop() } catch { /* mic ya parado */ }
    // Volcar la escritura pendiente (debounce de 500 ms): sin esto, editar y
    // salir a otra ruta perdía los últimos cambios.
    if (this.state.projId) write(KEYS.venta(this.state.projId), this.buildPayload(false))
  }

  dupSlide(id: string) {
    const i = this.state.slides.findIndex((x) => x.id === id)
    if (i < 0) return
    const copia = JSON.parse(JSON.stringify(this.state.slides[i]))
    copia.id = 'sl' + this.state.seq
    delete copia.planoRef
    const slides = [...this.state.slides]
    slides.splice(i + 1, 0, copia)
    this.up({ seq: this.state.seq + 1, slides })
  }

  openCtx(slId: string, e: any) {
    e.preventDefault()
    e.stopPropagation()
    this.setState({ ctxMenu: { x: e.clientX, y: e.clientY, slId } })
  }

  ctxDo(kind: string) {
    const cm = this.state.ctxMenu
    this.setState({ ctxMenu: null })
    if (!cm) return
    const sl = this.state.slides.find((x) => x.id === cm.slId)
    if (!sl) return
    if (kind === 'dup') this.dupSlide(sl.id)
    else if (kind === 'lib') this.libAdd(sl)
    else if (kind === 'up') this.moveSlide(sl.id, -1)
    else if (kind === 'down') this.moveSlide(sl.id, 1)
    else if (kind === 'del') {
      this.up({ slides: this.state.slides.filter((x) => x.id !== sl.id) })
      this.toast('Lámina eliminada.', true)
    }
  }

  edCommit(slId: string, key: string, e: any) {
    const v = String(e.target.innerText || '').replace(/ /g, ' ').replace(/\n+$/, '')
    const sl = this.state.slides.find((x) => x.id === slId)
    if (sl && String((sl as any)[key] || '') !== v) this.updSlide(slId, { [key]: v } as any)
  }

  // ---- library of reusable láminas ----
  libList(): any[] {
    try { return JSON.parse(localStorage.getItem(this.LIBKEY) || '[]') } catch (e) { return [] }
  }
  libWrite(list: any[]) {
    try { localStorage.setItem(this.LIBKEY, JSON.stringify(list)) } catch (e) {}
    this.forceUpdate()
  }
  async libAdd(sl: Slide) {
    const name = String(sl.titulo || sl.kicker || sl.tipo || 'Lámina').slice(0, 48)
    const ids = new Set<string>([
      ...(sl.imgs || []).filter(Boolean),
      ...((sl.collage || []).map((it) => it.img)),
      ...((sl.bloques || []).map((b) => b.imgId).filter(Boolean) as string[]),
    ])
    const imgs: any[] = []
    for (const id of ids) {
      const im = this.state.imagenes.find((x) => x.id === id)
      if (im && im.src) imgs.push({ id, src: im.src, name: im.name, desc: im.desc || '' })
    }
    const entry = { id: 'lib' + Date.now(), name, tipo: sl.tipo, ts: Date.now() }
    const sl2 = JSON.parse(JSON.stringify(sl))
    delete sl2.id
    delete sl2.planoRef
    await this.idbPut('slib-' + entry.id, JSON.stringify({ slide: sl2, imgs }))
    this.libWrite([...this.libList(), entry])
    this.up({ notice: 'Lámina «' + name + '» guardada en la biblioteca — disponible en todos los proyectos.' })
  }
  async libInsert(libId: string) {
    if (!libId) return
    const raw = await this.idbGet('slib-' + libId)
    if (!raw) { this.up({ notice: 'No se encontró esa lámina en la biblioteca.' }); return }
    let data: any
    try { data = JSON.parse(raw) } catch (e) { return }
    let seq = this.state.seq
    const map: Record<string, string> = {}
    const nuevas: Imagen[] = []
    for (const im of (data.imgs || [])) {
      const nid = 'im' + seq++
      map[im.id] = nid
      this.idbPut(nid, im.src)
      nuevas.push({ id: nid, name: im.name, desc: im.desc || '', src: im.src })
    }
    const sl = JSON.parse(JSON.stringify(data.slide || {}))
    sl.id = 'sl' + seq++
    sl.imgs = (sl.imgs || []).map((q: string) => map[q] || '')
    ;(sl.collage || []).forEach((it: CollageItem) => { it.img = map[it.img] || it.img })
    ;(sl.bloques || []).forEach((b: any) => { if (b.imgId) b.imgId = map[b.imgId] || b.imgId })
    this.logUndo({ slides: 1, imagenes: 1 })
    this.setState({ seq, imagenes: [...this.state.imagenes, ...nuevas], slides: [...this.state.slides, sl], libSel: '' }, () => this.persistNow())
  }
  libDel(libId: string) {
    if (!libId) return
    this.idbDel('slib-' + libId)
    this.libWrite(this.libList().filter((x) => x.id !== libId))
    this.setState({ libSel: '' })
  }

  // ---- CRM data (shared registries from Inicio) ----
  crmInfo(): { cliente?: any; feria?: any } {
    try {
      const sh = JSON.parse(localStorage.getItem('ready-projects-v1') || 'null')
      const rec = sh && sh.list && sh.list.find((p: any) => p.id === this.state.projId)
      if (!rec) return {}
      const cl = (JSON.parse(localStorage.getItem('ready-clientes-v1') || 'null') || {}).list || []
      const fe = (JSON.parse(localStorage.getItem('ready-ferias-v1') || 'null') || {}).list || []
      return { cliente: cl.find((c: any) => c.id === rec.clienteId) || null, feria: fe.find((f: any) => f.id === rec.feriaId) || null }
    } catch (e) { return {} }
  }
  autofillCrm() {
    const { cliente, feria } = this.crmInfo()
    if (!cliente && !feria) return
    const d = { ...this.state.datos }
    let ch = false
    if (cliente) {
      if (!String(d.cliente || '').trim() && cliente.nombre) { d.cliente = cliente.nombre; ch = true }
      if (!String(d.web || '').trim() && cliente.web) { d.web = cliente.web; ch = true }
    }
    if (feria) {
      const ftxt = [feria.nombre, feria.recinto, feria.fechas].filter(Boolean).join(' · ')
      if (!String(d.feria || '').trim() && ftxt) { d.feria = ftxt; ch = true }
    }
    const pr = { ...this.state.presupuesto }
    if (cliente && !String(pr.receptor || '').trim()) {
      const ct = (cliente.contactos && cliente.contactos[0]) || { nombre: cliente.contacto, telefono: cliente.telefono, email: cliente.email }
      const rc = [
        cliente.nombre,
        ct && ct.nombre ? ('Att.: ' + ct.nombre + (ct.cargo ? ' (' + ct.cargo + ')' : '')) : '',
        [ct && ct.telefono, ct && ct.email].filter(Boolean).join(' · '),
        cliente.web,
      ].filter(Boolean).join('\n')
      if (rc) { pr.receptor = rc; ch = true }
    }
    if (ch) this.setState({ datos: d, presupuesto: pr }, () => this.persist())
  }

  projName(): string {
    try {
      const sh = JSON.parse(localStorage.getItem('ready-projects-v1') || 'null')
      const rec = sh && sh.list && sh.list.find((p: any) => p.id === this.props.projectId)
      return (rec && rec.name) || ''
    } catch (e) { return '' }
  }
  renameProject = (name: string) => {
    try {
      const sh = JSON.parse(localStorage.getItem('ready-projects-v1') || 'null')
      if (sh && sh.list) {
        const rec = sh.list.find((p: any) => p.id === this.props.projectId)
        if (rec) { rec.name = name; localStorage.setItem('ready-projects-v1', JSON.stringify(sh)) }
      }
    } catch (e) {}
    this.setState({ projName: name })
  }

  defaults() {
    return {
      fase: 'brief', tab: 'laminas',
      datos: { cliente: '', web: '', feria: '', stand: '', objetivo: '', productos: '', descripcion: '', directrices: '' },
      imagenes: [], slides: [],
      presupuesto: {
        titulo: 'Presupuesto de diseño y montaje',
        num: '', fecha: new Date().toISOString().slice(0, 10),
        emisor: 'Ready Eventos · Grupo IGC\nCalle Soria, 34 · 28864 Ajalvir (Madrid)\n+34 677 437 113 · ready@readyeventos.com\nreadyeventos.com',
        receptor: '', cols: [] as string[], rows: [] as string[][],
        condiciones: 'Precios sin IVA. Validez de la oferta: 30 días. Incluye transporte, montaje y desmontaje en feria. No incluye tasas del recinto ferial ni consumos eléctricos.',
      } as Presupuesto,
      seq: Math.floor(Date.now() % 1e7),
      imgSel: null, iaPrompts: {}, iaPrompt: '', notice: '', error: '',
    }
  }

  async boot() {
    const id = this.props.projectId
    this.setState({ projId: id, projName: this.projName() })
    await this.loadData(read<any>(KEYS.venta(id)), true)
  }

  async loadData(saved: any, allowRescue: boolean) {
    if (!saved || !saved.datos) { this.autofillCrm(); return }
    const imagenes: Imagen[] = []
    for (const im of (saved.imagenes || [])) {
      let src = im.src
      if (!src) src = await this.idbGet(im.id)
      if (!src) {
        // No está en este dispositivo: intentar la copia del equipo en Storage.
        src = await bajarDataUrl('imagenes', this.props.projectId + '/' + im.id)
        if (src) this.idbPut(im.id, src)
      }
      if (src) {
        imagenes.push({ id: im.id, name: im.name, desc: im.desc || '', src })
        if (im.src) this.idbPut(im.id, im.src)
      }
    }
    let rescued = false
    if (allowRescue) {
      try {
        const known = new Set(imagenes.map((im) => im.id))
        const refs = new Set<string>()
        for (const sl of (saved.slides || [])) {
          for (const q of (sl.imgs || [])) refs.add(q)
          for (const b of (sl.bloques || [])) if (b.imgId) refs.add(b.imgId)
        }
        for (const key of await this.idbKeys()) {
          const k = String(key)
          if (known.has(k) || !refs.has(k)) continue
          const src = await this.idbGet(k)
          if (src) { imagenes.push({ id: k, name: 'Imagen ' + k.replace(/^im/, ''), desc: '', src }); rescued = true }
        }
      } catch (e) {}
    }
    this.setState({
      fase: saved.fase || (saved.slides && saved.slides.length ? 'doc' : 'brief'),
      tab: saved.tab || 'laminas',
      datos: { ...this.defaults().datos, ...saved.datos },
      imagenes,
      slides: saved.slides || [],
      presupuesto: { ...this.defaults().presupuesto, ...saved.presupuesto },
      zoom: saved.zoom || 0.5,
      seq: saved.seq || 50,
    }, () => {
      if (rescued || (saved.imagenes && saved.imagenes.some((im: any) => im.src))) this.persistNow()
      this.autofillCrm()
    })
  }

  buildPayload(inlineImgs: boolean) {
    const s = this.state
    return {
      fase: s.fase, tab: s.tab, datos: s.datos,
      imagenes: s.imagenes.map((im) => inlineImgs ? { id: im.id, name: im.name, desc: im.desc, src: im.src } : { id: im.id, name: im.name, desc: im.desc }),
      slides: s.slides, presupuesto: s.presupuesto, zoom: s.zoom, seq: s.seq,
    }
  }

  exportProject = () => {
    this.persistNow()
    const name = this.state.projName || 'proyecto'
    const blob = new Blob([JSON.stringify({ tipo: 'gencad-venta', v: 1, name, data: this.buildPayload(true) }, null, 1)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name.replace(/[^\wáéíóúñ -]/gi, '') + '.readyventa.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }
  importProject = async (ev: any) => {
    const file = ev.target.files[0]; ev.target.value = ''
    if (!file) return
    try {
      const o = JSON.parse(await file.text())
      const data = o.data && o.data.datos ? o.data : (o.datos ? o : null)
      if (!data) throw new Error('no es un proyecto de documento de venta')
      for (const im of (data.imagenes || [])) if (im.src) this.idbPut(im.id, im.src)
      this.persistNow()
      write(KEYS.venta(this.props.projectId), { ...data, imagenes: (data.imagenes || []).map((im: any) => ({ id: im.id, name: im.name, desc: im.desc })) })
      this.setState({ ...(this.defaults() as any) }, () => this.loadData(data, false))
    } catch (err: any) {
      this.up({ notice: 'No se pudo importar: ' + err.message })
    }
  }

  persistNow() {
    clearTimeout(this._pt)
    if (!this.state.projId) return
    write(KEYS.venta(this.state.projId), this.buildPayload(false))
    if (this.state.saving) this.setState({ saving: false })
  }
  toast(msg: string, undoable?: boolean) {
    clearTimeout(this._ntT)
    this.setState({ notice: msg, noticeUndo: !!undoable })
    this._ntT = setTimeout(() => this.setState({ notice: '', noticeUndo: false }), 7000)
  }
  persist() {
    clearTimeout(this._pt)
    if (!this.state.saving) this.setState({ saving: true })
    this._pt = setTimeout(() => this.persistNow(), 500)
  }

  // ---- IndexedDB for image blobs (base64) ----
  idb(): Promise<IDBDatabase> {
    if (this._idbp) return this._idbp
    this._idbp = new Promise((res, rej) => {
      const rq = indexedDB.open('gencad-venta', 1)
      rq.onupgradeneeded = () => { rq.result.createObjectStore('imgs') }
      rq.onsuccess = () => res(rq.result)
      rq.onerror = () => rej(rq.error)
    })
    return this._idbp
  }
  async idbPut(id: string, val: any) {
    try {
      const db = await this.idb()
      await new Promise<void>((res, rej) => {
        const tx = db.transaction('imgs', 'readwrite')
        tx.objectStore('imgs').put(val, id)
        tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error)
      })
    } catch (e) {}
    // Copia del equipo: las imágenes del proyecto suben a Storage en segundo
    // plano (las de la biblioteca local, 'slib-…', se quedan en el dispositivo).
    if (/^im/.test(id) && typeof val === 'string') {
      subirDataUrl('imagenes', this.props.projectId + '/' + id, val)
    }
  }
  async idbGet(id: string): Promise<any> {
    try {
      const db = await this.idb()
      return await new Promise((res, rej) => {
        const rq = db.transaction('imgs', 'readonly').objectStore('imgs').get(id)
        rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error)
      })
    } catch (e) { return undefined }
  }
  async idbKeys(): Promise<IDBValidKey[]> {
    try {
      const db = await this.idb()
      return await new Promise((res, rej) => {
        const rq = db.transaction('imgs', 'readonly').objectStore('imgs').getAllKeys()
        rq.onsuccess = () => res(rq.result || []); rq.onerror = () => rej(rq.error)
      })
    } catch (e) { return [] }
  }
  async idbDel(id: string) {
    try {
      const db = await this.idb()
      await new Promise<void>((res, rej) => {
        const tx = db.transaction('imgs', 'readwrite')
        tx.objectStore('imgs').delete(id)
        tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error)
      })
    } catch (e) {}
  }

  // ---- undo / redo ----
  logUndo(patch: any) {
    const keys = Object.keys(patch).filter((k) => this.UNDOABLE.includes(k))
    if (!keys.length) return
    // Coalescer ráfagas de tecleo: ediciones consecutivas de las mismas claves
    // en <700 ms comparten una sola entrada de deshacer (si no, escribir 30
    // caracteres vaciaba todo el historial).
    const sig = keys.slice().sort().join(',')
    const now = Date.now()
    if (sig === this._undoSig && now - this._undoAt < 700) {
      this._undoAt = now
      return
    }
    const snap: any = {}
    for (const k of keys) snap[k] = (this.state as any)[k]
    this._undo.push(snap)
    while (this._undo.length > 30) this._undo.shift()
    this._redo = []
    this._wlt = 0
    this._undoSig = sig
    this._undoAt = now
  }
  logGesture() {
    this._undo.push({ slides: this.state.slides })
    while (this._undo.length > 30) this._undo.shift()
    this._redo = []
  }
  logWheel() {
    const t = Date.now()
    if (!this._wlt || t - this._wlt > 700) this.logGesture()
    this._wlt = t
  }
  undo = () => {
    const prev = this._undo.pop()
    if (!prev) return
    const cur: any = {}
    for (const k of Object.keys(prev)) cur[k] = (this.state as any)[k]
    this._redo.push(cur)
    this.setState({ ...prev, dSel: null, imgSel: null, clSel: null, dGhost: null, edRev: (this.state.edRev || 0) + 1 }, () => this.persist())
    this.forceUpdate()
  }
  redo = () => {
    const nxt = this._redo.pop()
    if (!nxt) return
    const cur: any = {}
    for (const k of Object.keys(nxt)) cur[k] = (this.state as any)[k]
    this._undo.push(cur)
    this.setState({ ...nxt, dSel: null, imgSel: null, clSel: null, dGhost: null, edRev: (this.state.edRev || 0) + 1 }, () => this.persist())
    this.forceUpdate()
  }
  up = (patch: any) => { this.logUndo(patch); this.setState(patch, () => this.persist()) }

  // ---- drawing annotations (mm on 297×210) ----
  dPoint(ev: any): [number, number] {
    const r = ev.currentTarget.getBoundingClientRect()
    return [(ev.clientX - r.left) / r.width * 297, (ev.clientY - r.top) / r.height * 210]
  }
  updAnota(slId: string, anota: Anota[]) {
    this.up({ slides: this.state.slides.map((x) => x.id === slId ? { ...x, anota } : x) })
  }
  dHit(sl: Slide, p: [number, number]): number {
    const arr = sl.anota || []
    const tol = 2.5
    const dSeg = (P: number[], a: number[], b: number[]) => {
      const vx = b[0] - a[0], vy = b[1] - a[1]
      const L2 = vx * vx + vy * vy || 1e-9
      const t = Math.max(0, Math.min(1, ((P[0] - a[0]) * vx + (P[1] - a[1]) * vy) / L2))
      return Math.hypot(P[0] - a[0] - vx * t, P[1] - a[1] - vy * t)
    }
    for (let i = arr.length - 1; i >= 0; i--) {
      const e: any = arr[i]
      let dd = Infinity
      if (e.k === 'l' || e.k === 'a') dd = dSeg(p, [e.x1, e.y1], [e.x2, e.y2])
      else if (e.k === 'n') {
        const fs = e.h || 5
        const tw = Math.max(...String(e.text || 'Etiqueta').split('\n').map((l: string) => l.length)) * fs * 0.58
        const tx0 = e.x2 >= e.x1 ? e.x2 : e.x2 - tw
        dd = Math.min(dSeg(p, [e.x1, e.y1], [e.x2, e.y2]),
          (p[0] >= tx0 - tol && p[0] <= tx0 + tw + tol && p[1] >= e.y2 - fs - tol && p[1] <= e.y2 + fs + tol) ? 0 : Infinity)
      } else if (e.k === 'r') dd = Math.min(dSeg(p, [e.x, e.y], [e.x + e.w, e.y]), dSeg(p, [e.x + e.w, e.y], [e.x + e.w, e.y + e.h]), dSeg(p, [e.x + e.w, e.y + e.h], [e.x, e.y + e.h]), dSeg(p, [e.x, e.y + e.h], [e.x, e.y]))
      else if (e.k === 'c') dd = Math.abs(Math.hypot(p[0] - e.cx, p[1] - e.cy) - e.r)
      else if (e.k === 't') {
        const h = e.h || 5
        const lines = String(e.text || '').split('\n')
        const w = e.bw || Math.max(...lines.map((l: string) => l.length)) * h * 0.58
        const nl = e.bw ? Math.max(lines.length, Math.ceil(String(e.text || '').length * h * 0.55 / e.bw)) : lines.length
        if (p[0] >= e.x - tol && p[0] <= e.x + w + tol && p[1] >= e.y - h - tol && p[1] <= e.y + (nl - 1) * h * 1.25 + tol) dd = 0
      }
      if (dd < tol) return i
    }
    return -1
  }
  dDown(sl: Slide, ev: any) {
    const s = this.state
    if (!s.dTool) return
    ev.preventDefault()
    ev.stopPropagation()
    try { ev.currentTarget.setPointerCapture(ev.pointerId) } catch (e) {}
    const p = this.dPoint(ev)
    const hi = this.dHit(sl, p)
    if (hi >= 0) {
      this._dDrag = { slId: sl.id, mode: 'move', idx: hi, last: p, moved: false }
      this.setState({ dSel: { slId: sl.id, idx: hi } })
      return
    }
    this._dDrag = { slId: sl.id, mode: 'new', kind: s.dTool, x0: p[0], y0: p[1], moved: false }
  }
  eyeDrop(cb: (c: string) => void) {
    if (!(window as any).EyeDropper) return
    try { new (window as any).EyeDropper().open().then((r: any) => cb(r.sRGBHex)).catch(() => {}) } catch (e) {}
  }
  getFavs(): string[] {
    try {
      const raw = localStorage.getItem(this.FAVKEY)
      let list = raw === null ? [] : JSON.parse(raw || '[]').filter((x: string) => /^#[0-9a-fA-F]{6}$/.test(x))
      if (!localStorage.getItem(this.FAVKEY + '-seeded')) {
        list = [...['#17161A', '#D6197E'].filter((c) => !list.includes(c)), ...list]
        localStorage.setItem(this.FAVKEY, JSON.stringify(list))
        localStorage.setItem(this.FAVKEY + '-seeded', '1')
      }
      return list.slice(0, 12)
    } catch (e) { return ['#17161A', '#D6197E'] }
  }
  addFav(c: string | null) {
    if (!/^#[0-9a-fA-F]{6}$/.test(String(c || ''))) return
    const f = this.getFavs()
    if (f.includes(c as string)) return
    f.push(c as string)
    while (f.length > 12) f.shift()
    try { localStorage.setItem(this.FAVKEY, JSON.stringify(f)) } catch (e) {}
    this.forceUpdate()
  }
  delFav(c: string) {
    try { localStorage.setItem(this.FAVKEY, JSON.stringify(this.getFavs().filter((x) => x !== c))) } catch (e) {}
    this.forceUpdate()
  }
  vdd(): any {
    return { color: '#17161A', grosor: 0.6, dash: 'solid', fs: 6, align: 'left', bold: false, fill: '', noBorder: false, tFill: '', tBorder: false, ...(this.state.vdd || {}) }
  }
  vSetStyle(patch: any) {
    this.setState({ vdd: { ...this.vdd(), ...patch } })
    const ds = this.state.dSel
    if (ds) {
      const sl2 = this.state.slides.find((x) => x.id === ds.slId)
      if (sl2) this.updAnota(ds.slId, (sl2.anota || []).map((x, j) => j === ds.idx ? { ...x, ...patch } : x))
    }
  }
  dMove(sl: Slide, ev: any) {
    const dd = this._dDrag
    if (!dd || dd.slId !== sl.id) return
    const p = this.dPoint(ev)
    dd.moved = true
    if (dd.mode === 'move') {
      if (!dd.moved2) { dd.moved2 = true; this.logGesture() }
      const dx = p[0] - dd.last[0], dy = p[1] - dd.last[1]
      dd.last = p
      const anota = (((this.state.slides.find((x) => x.id === sl.id) || {}) as any).anota || []).map((e: any, j: number) => {
        if (j !== dd.idx) return e
        if (e.k === 'l' || e.k === 'a' || e.k === 'n') return { ...e, x1: e.x1 + dx, y1: e.y1 + dy, x2: e.x2 + dx, y2: e.y2 + dy }
        if (e.k === 'r' || e.k === 't') return { ...e, x: e.x + dx, y: e.y + dy }
        if (e.k === 'c') return { ...e, cx: e.cx + dx, cy: e.cy + dy }
        return e
      })
      this.setState({ slides: this.state.slides.map((x) => x.id === sl.id ? { ...x, anota } : x) })
    } else {
      let px = p[0], py = p[1]
      if ((dd.kind === 'l' || dd.kind === 'a' || dd.kind === 'n') && ev.shiftKey) { if (Math.abs(px - dd.x0) > Math.abs(py - dd.y0)) py = dd.y0; else px = dd.x0 }
      this.setState({ dGhost: { slId: sl.id, kind: dd.kind, x0: dd.x0, y0: dd.y0, x1: px, y1: py } })
    }
  }
  dUp(sl: Slide) {
    const dd = this._dDrag
    if (!dd || dd.slId !== sl.id) return
    this._dDrag = null
    if (dd.mode === 'move') { if (dd.moved) this.persist(); return }
    const g = this.state.dGhost
    this.setState({ dGhost: null })
    const dd0 = this.vdd()
    if (!dd.moved && dd.kind === 't') {
      const sl2 = this.state.slides.find((x) => x.id === sl.id)
      const anota = [...(((sl2 && sl2.anota) || []) as Anota[]), { k: 't', x: dd.x0, y: dd.y0, h: dd0.fs, text: 'Texto', color: dd0.color, align: dd0.align, bold: dd0.bold, fill: dd0.tFill || undefined, border: dd0.tBorder || undefined } as Anota]
      this.setState({ dSel: { slId: sl.id, idx: anota.length - 1 } })
      this.updAnota(sl.id, anota)
      return
    }
    if (!dd.moved || !g) return
    const dx = g.x1 - g.x0, dy = g.y1 - g.y0
    const estilo = { color: dd0.color, grosor: dd0.grosor, dash: dd0.dash }
    const relleno = { fill: dd0.fill || undefined, noBorder: dd0.noBorder || undefined }
    let e: any = null
    if (g.kind === 'l' && Math.hypot(dx, dy) > 0.5) e = { k: 'l', x1: g.x0, y1: g.y0, x2: g.x1, y2: g.y1, ...estilo }
    else if (g.kind === 'a' && Math.hypot(dx, dy) > 0.5) e = { k: 'a', x1: g.x0, y1: g.y0, x2: g.x1, y2: g.y1, ...estilo }
    else if (g.kind === 'n' && Math.hypot(dx, dy) > 0.5) e = { k: 'n', x1: g.x0, y1: g.y0, x2: g.x1, y2: g.y1, text: 'Etiqueta', h: 5, ...estilo }
    else if (g.kind === 'r' && Math.abs(dx) > 0.5 && Math.abs(dy) > 0.5) e = { k: 'r', x: Math.min(g.x0, g.x1), y: Math.min(g.y0, g.y1), w: Math.abs(dx), h: Math.abs(dy), ...estilo, ...relleno }
    else if (g.kind === 'c' && Math.hypot(dx, dy) > 0.5) e = { k: 'c', cx: g.x0, cy: g.y0, r: Math.hypot(dx, dy), ...estilo, ...relleno }
    else if (g.kind === 't' && Math.abs(dx) > 2) e = { k: 't', x: Math.min(g.x0, g.x1), y: Math.min(g.y0, g.y1) + dd0.fs, bw: Math.abs(dx), h: dd0.fs, text: 'Escribe el texto en la barra superior', color: dd0.color, align: dd0.align, bold: dd0.bold, fill: dd0.tFill || undefined, border: dd0.tBorder || undefined }
    if (!e && g.kind === 't') e = { k: 't', x: g.x0, y: g.y0, h: dd0.fs, text: 'Texto', color: dd0.color, align: dd0.align, bold: dd0.bold, fill: dd0.tFill || undefined, border: dd0.tBorder || undefined }
    if (e) {
      const sl2 = this.state.slides.find((x) => x.id === sl.id)
      const anota = [...(((sl2 && sl2.anota) || []) as Anota[]), e]
      this.setState({ dSel: { slId: sl.id, idx: anota.length - 1 } })
      this.updAnota(sl.id, anota)
    }
  }

  dProps(sl: Slide): { dSvg: any } {
    const s = this.state
    const active = !!s.dTool
    const selIdx = (s.dSel && s.dSel.slId === sl.id) ? s.dSel.idx : -1
    const acc = '#D6197E'
    const kids: any[] = []
    const dashOf = (e2: any) => e2.dash === 'dash' ? '3 1.8' : e2.dash === 'dot' ? '0.6 1.4' : undefined
    const arrow = (key: string, e: any, col: string) => {
      const ang = Math.atan2(e.y2 - e.y1, e.x2 - e.x1)
      const cs = Math.cos(ang), sn = Math.sin(ang), sz = 3.2 * Math.max(1, (e.grosor || 0.6) / 0.6 * 0.8)
      const bx = e.x2 - cs * sz, by = e.y2 - sn * sz
      return R('g', { key },
        R('line', { x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, stroke: col, strokeWidth: e.grosor || 0.6, strokeLinecap: 'round', strokeDasharray: dashOf(e) }),
        R('polygon', { points: `${e.x2},${e.y2} ${bx - sn * sz * 0.42},${by + cs * sz * 0.42} ${bx + sn * sz * 0.42},${by - cs * sz * 0.42}`, fill: col }))
    }
    const wrapLines = (raw: string, bw: number, fs: number) => {
      const out: string[] = []
      for (const para of String(raw || '').split('\n')) {
        const words = para.split(/\s+/).filter(Boolean)
        if (!words.length) { out.push(''); continue }
        let cur = ''
        for (const w0 of words) {
          const cand = cur ? cur + ' ' + w0 : w0
          if (cand.length * fs * 0.55 > bw && cur) { out.push(cur); cur = w0 } else cur = cand
        }
        out.push(cur)
      }
      return out
    }
    ;(sl.anota || []).forEach((e: any, i: number) => {
      const selHere = i === selIdx
      const col = selHere ? acc : (e.color || '#17161A')
      const st: any = { stroke: col, strokeWidth: e.grosor || 0.6, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round', strokeDasharray: dashOf(e) }
      const stFill: any = {
        ...st, fill: e.fill || 'none',
        stroke: e.noBorder ? (selHere ? acc : 'none') : col,
        strokeDasharray: e.noBorder && selHere ? '1.4 1.1' : dashOf(e),
        strokeWidth: e.noBorder && selHere ? 0.3 : (e.grosor || 0.6),
      }
      if (e.k === 'l') kids.push(R('line', { key: 'a' + i, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, ...st }))
      else if (e.k === 'a') kids.push(arrow('a' + i, e, col))
      else if (e.k === 'n') {
        const fs = e.h || 5
        const right = e.x2 >= e.x1
        const lines = String(e.text || 'Etiqueta').split('\n')
        kids.push(R('g', { key: 'a' + i },
          R('line', { x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, stroke: col, strokeWidth: e.grosor || 0.5, strokeLinecap: 'round', strokeDasharray: dashOf(e) }),
          R('line', { x1: e.x2, y1: e.y2, x2: e.x2 + (right ? 3 : -3), y2: e.y2, stroke: col, strokeWidth: e.grosor || 0.5, strokeLinecap: 'round' }),
          R('circle', { cx: e.x1, cy: e.y1, r: Math.max(0.9, (e.grosor || 0.5) * 1.6), fill: col }),
          R('text', {
            x: e.x2 + (right ? 4.2 : -4.2), y: e.y2 + fs * 0.34,
            fontSize: fs, fontFamily: "'Archivo',sans-serif", fontWeight: e.bold ? 800 : 600,
            textAnchor: right ? 'start' : 'end', fill: col, stroke: '#FFFFFF', strokeWidth: fs * 0.1, paintOrder: 'stroke',
          }, lines.map((ln: string, li: number) => R('tspan', { key: li, x: e.x2 + (right ? 4.2 : -4.2), dy: li === 0 ? 0 : fs * 1.25 }, ln || ' ')))))
      } else if (e.k === 'r') kids.push(R('rect', { key: 'a' + i, x: e.x, y: e.y, width: e.w, height: e.h, ...stFill }))
      else if (e.k === 'c') kids.push(R('circle', { key: 'a' + i, cx: e.cx, cy: e.cy, r: e.r, ...stFill }))
      else if (e.k === 't') {
        const fs = e.h || 6
        const lines = e.bw ? wrapLines(e.text, e.bw, fs) : String(e.text || '').split('\n')
        const anchor = e.align === 'center' ? 'middle' : e.align === 'right' ? 'end' : 'start'
        const ax = e.x + (e.bw ? (e.align === 'center' ? e.bw / 2 : e.align === 'right' ? e.bw : 0) : 0)
        const tg: any[] = []
        if (e.fill || e.border) {
          const lw = e.bw || Math.max(...lines.map((l: string) => l.length), 1) * fs * 0.58
          const pad = fs * 0.35
          tg.push(R('rect', { key: 'bg', x: e.x - pad, y: e.y - fs - pad + fs * 0.2, width: lw + pad * 2, height: (lines.length - 1) * fs * 1.25 + fs * 1.25 + pad * 2 - fs * 0.2, fill: e.fill || 'none', stroke: e.border ? col : 'none', strokeWidth: 0.4 }))
        }
        if (selHere && e.bw) {
          tg.push(R('rect', { key: 'bx', x: e.x, y: e.y - fs, width: e.bw, height: (lines.length - 1) * fs * 1.25 + fs * 1.25, fill: 'none', stroke: col, strokeWidth: 0.25, strokeDasharray: '1.4 1.1' }))
        }
        tg.push(R('text', { key: 'tx', x: ax, y: e.y, fontSize: fs, fontFamily: "'Archivo',sans-serif", fontWeight: e.bold ? 800 : 600, textAnchor: anchor, fill: col, stroke: '#FFFFFF', strokeWidth: fs * 0.1, paintOrder: 'stroke' }, lines.map((ln: string, li: number) => R('tspan', { key: li, x: ax, dy: li === 0 ? 0 : fs * 1.25 }, ln || ' '))))
        kids.push(R('g', { key: 'a' + i }, tg))
      }
    })
    if (s.dGhost && s.dGhost.slId === sl.id) {
      const g = s.dGhost
      const gst: any = { stroke: acc, strokeWidth: 0.5, fill: 'none', strokeDasharray: '2 1.4' }
      if (g.kind === 'l' || g.kind === 'a' || g.kind === 'n') kids.push(R('line', { key: 'gh', x1: g.x0, y1: g.y0, x2: g.x1, y2: g.y1, ...gst }))
      else if (g.kind === 'r' || g.kind === 't') kids.push(R('rect', { key: 'gh', x: Math.min(g.x0, g.x1), y: Math.min(g.y0, g.y1), width: Math.abs(g.x1 - g.x0), height: Math.abs(g.y1 - g.y0), ...gst }))
      else if (g.kind === 'c') kids.push(R('circle', { key: 'gh', cx: g.x0, cy: g.y0, r: Math.hypot(g.x1 - g.x0, g.y1 - g.y0) || 0.01, ...gst }))
    }
    const dSvg = R('svg', {
      viewBox: '0 0 297 210', preserveAspectRatio: 'none',
      style: { position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 25, pointerEvents: active ? 'auto' : 'none', cursor: active ? 'crosshair' : 'default' },
      onPointerDown: (ev: any) => this.dDown(sl, ev),
      onPointerMove: (ev: any) => this.dMove(sl, ev),
      onPointerUp: () => this.dUp(sl),
    }, kids)
    return { dSvg }
  }

  dGlobalProps(): any {
    const s = this.state
    const acc = '#D6197E'
    const icon = (paths: string[]) => R('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', style: { flex: 'none' } }, paths.map((p2, i2) => R('path', { key: i2, d: p2 })))
    const TOOLS: any[] = [
      ['t', 'Texto', 'Clic = texto libre · arrastra = cuadro de texto con ajuste de línea', ['M5 6V4h14v2', 'M12 4v16', 'M9 20h6']],
      ['l', 'Línea', 'Línea (Mayús = H/V)', ['M4 20 20 4']],
      ['a', 'Flecha', 'Flecha indicadora', ['M4 20 18 6', 'M18 13V6h-7']],
      ['r', 'Rect.', 'Rectángulo', ['M3 5h18v14H3z']],
      ['c', 'Círculo', 'Círculo desde el centro', ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z']],
      ['n', 'Etiqueta', 'Etiqueta con línea guía: arrastra desde el punto a señalar hasta donde irá el texto', ['M5 19l7-7', 'M12 12h8', 'M5 17.6a1.4 1.4 0 1 0 .01 0']],
    ]
    const ds = s.dSel
    const sl2 = ds && s.slides.find((x) => x.id === ds.slId)
    const selEnt: any = sl2 && (sl2.anota || [])[ds!.idx]
    const updSel = (patch: any) => {
      const ds2 = this.state.dSel
      if (!ds2) return
      const slX = this.state.slides.find((x) => x.id === ds2.slId)
      this.updAnota(ds2.slId, ((slX && slX.anota) || []).map((x, j) => j === ds2.idx ? { ...x, ...patch } : x))
    }
    const dd0 = this.vdd()
    const cur = selEnt || dd0
    const kind = selEnt ? selEnt.k : s.dTool
    return {
      gTools: TOOLS.map(([t, label, title, ic]: any) => {
        const on = s.dTool === t
        return { label, title, icon: icon(ic), bd: on ? acc : '#DCD9D2', bg: on ? acc : '#fff', fg: on ? '#fff' : '#55524D', onClick: () => this.setState(on ? { dTool: null, dSel: null, dGhost: null } : { dTool: t, dSel: null, dGhost: null }) }
      }),
      gStyleOn: !!kind,
      gStrokeOn: ['l', 'a', 'r', 'c', 'n'].includes(kind),
      gFillOn: ['r', 'c'].includes(kind),
      gTextOn: kind === 't',
      sColHex: /^#[0-9a-fA-F]{6}$/.test(cur.color || '') ? cur.color : '#17161A',
      sOnColHex: (e: any) => this.vSetStyle({ color: e.target.value }),
      sColEye: () => this.eyeDrop((c) => this.vSetStyle({ color: c })),
      sFavs: this.getFavs().map((c) => ({ c, bd: (cur.color || '#17161A') === c ? '#17161A' : '#E0DED8', onPick: () => this.vSetStyle({ color: c }), onDrop: () => this.delFav(c) })),
      sFavAdd: () => this.addFav(/^#[0-9a-fA-F]{6}$/.test(cur.color || '') ? cur.color : null),
      gW: String(cur.grosor || 0.6),
      gOnW: (e: any) => this.vSetStyle({ grosor: parseFloat(e.target.value) }),
      gDash: cur.dash || 'solid',
      gOnDash: (e: any) => this.vSetStyle({ dash: e.target.value }),
      gBoldBg: cur.bold ? '#17161A' : '#fff',
      gBoldFg: cur.bold ? '#fff' : '#55524D',
      gOnBold: () => this.vSetStyle({ bold: !cur.bold }),
      gAlign: cur.align || 'left',
      gOnAlign: (e: any) => this.vSetStyle({ align: e.target.value }),
      ...(() => {
        const isTxt = kind === 't'
        const curFill = isTxt
          ? ((selEnt && selEnt.k === 't' ? (selEnt.fill || '') : dd0.tFill) || '')
          : ((selEnt ? (selEnt.fill || '') : dd0.fill) || '')
        const applyFill = (v: string) => {
          if (isTxt) {
            this.setState({ vdd: { ...dd0, tFill: v } })
            const ds2 = this.state.dSel
            if (ds2) {
              const slX = this.state.slides.find((x) => x.id === ds2.slId)
              const enX: any = slX && (slX.anota || [])[ds2.idx]
              if (enX && enX.k === 't') this.vSetStyle({ fill: v || undefined })
            }
          } else this.vSetStyle({ fill: v || undefined })
        }
        return {
          gFillHex: /^#[0-9a-fA-F]{6}$/.test(curFill) ? curFill : '#FBE9B7',
          gNoneBg: curFill ? '#fff' : '#17161A',
          gNoneFg: curFill ? '#55524D' : '#fff',
          gOnFillHex: (e: any) => applyFill(e.target.value),
          gFillEye: () => this.eyeDrop((c) => applyFill(c)),
          gFillNone: () => applyFill(''),
          favColors: this.getFavs().map((c) => ({ c, onPick: () => applyFill(c), onDrop: () => this.delFav(c), bd: curFill === c ? '#17161A' : '#E0DED8' })),
          favAdd: () => this.addFav(/^#[0-9a-fA-F]{6}$/.test(curFill) ? curFill : null),
        }
      })(),
      gBorderBg: (selEnt ? !selEnt.noBorder : !dd0.noBorder) ? '#17161A' : '#fff',
      gBorderFg: (selEnt ? !selEnt.noBorder : !dd0.noBorder) ? '#fff' : '#55524D',
      gOnBorder: () => this.vSetStyle({ noBorder: !(selEnt ? selEnt.noBorder : dd0.noBorder) }),
      gTBorderBg: (selEnt && selEnt.k === 't' ? !!selEnt.border : dd0.tBorder) ? '#17161A' : '#fff',
      gTBorderFg: (selEnt && selEnt.k === 't' ? !!selEnt.border : dd0.tBorder) ? '#fff' : '#55524D',
      gOnTBorder: () => {
        const c2 = selEnt && selEnt.k === 't' ? !!selEnt.border : dd0.tBorder
        this.setState({ vdd: { ...dd0, tBorder: !c2 } })
        if (selEnt && selEnt.k === 't') this.vSetStyle({ border: !c2 || undefined })
      },
      gSelOn: !!selEnt,
      gSelText: !!(selEnt && (selEnt.k === 't' || selEnt.k === 'n')),
      gText: (selEnt && (selEnt.k === 't' || selEnt.k === 'n')) ? String(selEnt.text || '').replace(/\n/g, '\\n') : '',
      gOnText: (e: any) => updSel({ text: String(e.target.value).replace(/\\n/g, '\n') }),
      gFs: (selEnt && (selEnt.k === 't' || selEnt.k === 'n')) ? String(selEnt.h || 6) : '6',
      gOnFs: (e: any) => updSel({ h: parseFloat(e.target.value) }),
      gDel: () => {
        const ds2 = this.state.dSel
        if (!ds2) return
        const slX = this.state.slides.find((x) => x.id === ds2.slId)
        this.setState({ dSel: null })
        this.updAnota(ds2.slId, ((slX && slX.anota) || []).filter((_x, j) => j !== ds2.idx))
      },
      gHint: s.dTool ? (s.dSel ? 'Arrastra para mover · Supr elimina · Esc sale' : (s.dTool === 't' ? 'Clic sobre la lámina para colocar el texto' : 'Arrastra sobre cualquier lámina para dibujar · Esc sale')) : 'Elige una herramienta y dibuja sobre cualquier lámina',
    }
  }

  async fileToDataURL(file: File, maxDim = 1400): Promise<string> {
    const url = URL.createObjectURL(file)
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('imagen no válida')); i.src = url })
      const sc = Math.min(1, maxDim / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.width * sc))
      c.height = Math.max(1, Math.round(img.height * sc))
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      return file.type === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85)
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  onImgs = async (ev: any) => {
    const files = [...ev.target.files] as File[]
    ev.target.value = ''
    for (const f of files) {
      try {
        const src = await this.fileToDataURL(f)
        const id = 'im' + this.state.seq
        this.idbPut(id, src)
        this.setState({ seq: this.state.seq + 1, imagenes: [...this.state.imagenes, { id, name: f.name.replace(/\.[^.]+$/, ''), src, desc: '' }] }, () => this.persistNow())
      } catch (e) {}
    }
  }

  onPresuFile = async (ev: any) => {
    const file = ev.target.files[0]; ev.target.value = ''
    if (!file || !this.xl) return
    try {
      if (/\.pdf$/i.test(file.name)) {
        this.setState({ pdfBusy: true, notice: '' })
        const text = await this.xl.extractPDFText(await file.arrayBuffer())
        if (!text || text.trim().length < 30) throw new Error('no se pudo extraer texto del PDF (¿es un documento escaneado?)')
        await this.analizarPresuTexto(text.slice(0, 14000), file.name)
        this.setState({ pdfBusy: false })
        return
      }
      let rows
      if (/\.xlsx$/i.test(file.name)) rows = await this.xl.parseXLSX(await file.arrayBuffer())
      else rows = this.xl.parseDelimited(await file.text())
      const t = this.xl.rowsToTable(rows)
      if (!t.rows.length) throw new Error('no se han encontrado filas con datos')
      this.up({ notice: '', presupuesto: { ...this.state.presupuesto, cols: t.cols, rows: t.rows } })
    } catch (err: any) {
      this.setState({ pdfBusy: false })
      this.up({ notice: 'No se pudo leer «' + file.name + '»: ' + err.message })
    }
  }

  async analizarPresuTexto(text: string, nombre: string) {
    if (!this.aiAvail()) throw new Error('la IA no está disponible en este entorno')
    const res = await this.claude({
      messages: [{ role: 'user', content: 'Texto extraído automáticamente de un PDF de presupuesto («' + nombre + '») — puede venir desordenado:\n\n' + text + '\n\nReconstruye el presupuesto como tabla limpia y profesional de Ready Eventos (stands de feria), CONSERVANDO la organización del documento original: mismos capítulos/secciones, mismas partidas en el mismo orden y mismos subtotales. Formato: un capítulo = fila con SOLO la primera celda rellena (resto vacías); un subtotal = fila cuyo primer texto empiece por "Subtotal". Columnas con sentido según los datos reales (p. ej. Concepto, Uds, Precio ud., Importe), números en formato español (1.234,56). NO incluyas la fila del TOTAL GENERAL ni el IVA (se calculan aparte). Si detectas condiciones o notas al pie, inclúyelas. No inventes importes. Responde SOLO con JSON: {"titulo":"...","cols":[...],"rows":[[...]],"condiciones":"..."}' }],
      system: 'Eres el responsable comercial de Ready Eventos, empresa española de stands de feria. Reconstruyes presupuestos a partir de texto extraído de PDF con total fidelidad a las cifras. Responde SOLO con el JSON pedido, sin explicaciones ni ```.',
      max_tokens: 8000,
    })
    const o = salvageObj(res)
    if (!Array.isArray(o.cols) || !Array.isArray(o.rows) || !o.rows.length) throw new Error('no se reconoció ninguna partida')
    this.up({
      notice: '',
      presupuesto: {
        ...this.state.presupuesto,
        titulo: o.titulo ? String(o.titulo) : this.state.presupuesto.titulo,
        cols: o.cols.map(String), rows: o.rows.map((r: any[]) => r.map(String)),
        condiciones: o.condiciones ? String(o.condiciones) : this.state.presupuesto.condiciones,
      },
    })
  }

  pedirPresu = async () => {
    const instr = this.state.presuPrompt.trim()
    if (!instr || this.state.presuEdit) return
    if (!this.aiAvail()) { this.up({ notice: 'La IA no está disponible en este entorno.' }); return }
    const pr = this.state.presupuesto
    this.setState({ presuEdit: true, notice: '' })
    try {
      const res = await this.askClaude('Presupuesto actual de Ready Eventos:\n' + JSON.stringify({ titulo: pr.titulo, cols: pr.cols, rows: pr.rows, condiciones: pr.condiciones }) +
        '\n\nINSTRUCCIÓN DEL USUARIO:\n' + instr +
        '\n\nAplica la instrucción. Puedes hacer cálculos (importes = uds × precio, descuentos, porcentajes, redondeos, agrupar partidas, añadir o quitar columnas y filas) — hazlos con precisión aritmética y números en formato español (1.234,56). CONSERVA la estructura de capítulos y subtotales salvo que la instrucción pida cambiarla (capítulo = fila con solo la primera celda rellena; subtotal = fila cuyo primer texto empiece por "Subtotal"; si cambias importes de un capítulo, recalcula su subtotal). NO añadas fila de total general (se calcula aparte a partir de los subtotales o, si no hay, de las partidas). No inventes precios que no se deduzcan de los datos o de la instrucción. Puedes actualizar también el título y las condiciones si la instrucción lo pide.\n\nResponde SOLO con JSON: {"titulo":"...","cols":[...],"rows":[[...]],"condiciones":"..."}', 'Eres el responsable comercial de Ready Eventos, empresa española de stands de feria. Editas presupuestos con precisión: cambias solo lo que se pide y calculas sin errores. Responde SOLO con el JSON pedido, sin explicaciones ni ```.', 8000)
      const o = salvageObj(res)
      if (!Array.isArray(o.cols) || !Array.isArray(o.rows)) throw new Error('respuesta incompleta')
      this.setState({ presuEdit: false })
      this.up({
        presuPrompt: '',
        presupuesto: {
          ...this.state.presupuesto,
          titulo: o.titulo ? String(o.titulo) : this.state.presupuesto.titulo,
          cols: o.cols.map(String), rows: o.rows.map((r: any[]) => r.map(String)),
          condiciones: (o.condiciones !== undefined && o.condiciones !== null) ? String(o.condiciones) : this.state.presupuesto.condiciones,
        },
      })
    } catch (err: any) {
      this.setState({ presuEdit: false })
      this.up({ notice: 'No se pudieron aplicar los cambios al presupuesto: ' + err.message })
    }
  }

  crearDesdePaste = () => {
    if (!this.xl || !this.state.paste.trim()) return
    const t = this.xl.rowsToTable(this.xl.parseDelimited(this.state.paste))
    if (!t.rows.length) return
    this.up({ paste: '', notice: '', presupuesto: { ...this.state.presupuesto, cols: t.cols, rows: t.rows } })
  }

  sanitizeSlides(arr: any[]): { slides: Slide[]; n: number } {
    const validIds = new Set(this.state.imagenes.map((im) => im.id))
    const hex = (v: any) => (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(String(v).trim())) ? String(v).trim() : ''
    const cl = (v: any, a: number, b: number, dflt: number) => { const q = +v; return isFinite(q) ? Math.max(a, Math.min(b, q)) : dflt }
    let n = this.state.seq
    const slides = arr.filter((x) => this.TIPOS_OK.includes(x.tipo)).map((x) => {
      // Conservar lo que la IA no conoce de la lámina existente: anotaciones a
      // mano (anota), transformaciones, collage… Si la IA omite bg/bloques en
      // una lámina que ya los tenía, se mantienen los actuales (antes se
      // borraban los dibujos de TODAS las láminas al pedir cualquier cambio).
      const prev = (this.state.slides.find((o) => o.id === x.id) || ({} as any))
      return {
      id: (typeof x.id === 'string' && x.id) ? x.id : ('sl' + (n++)),
      tipo: x.tipo,
      kicker: String(x.kicker || '').trim(),
      titulo: String(x.titulo || '').trim(),
      texto: String(x.texto || '').trim(),
      imgs: (Array.isArray(x.imgs) ? x.imgs : []).filter((id: string) => validIds.has(id)).slice(0, 3),
      side: (x.side === 'right' ? 'right' : 'left') as 'left' | 'right',
      bg: hex(x.bg) || prev.bg || '',
      anota: prev.anota,
      tr: prev.tr,
      collage: prev.collage,
      planoRef: prev.planoRef,
      bloques: x.tipo === 'libre' ? (!Array.isArray(x.bloques) || !x.bloques.length ? prev.bloques : x.bloques.slice(0, 14).map((b: any) => ({
        kind: ['text', 'image', 'rect', 'logo'].includes(b.kind) ? b.kind : 'text',
        x: cl(b.x, -5, 100, 5), y: cl(b.y, -5, 100, 5), w: cl(b.w, 1, 110, 40), h: cl(b.h, 1, 110, 12),
        text: String(b.text || ''), size: cl(b.size, 6, 64, 11), weight: cl(b.weight, 400, 800, 400),
        color: hex(b.color) || '#17161A', bg: hex(b.bg), align: ['center', 'right', 'justify'].includes(b.align) ? b.align : 'left',
        mono: !!b.mono, lh: cl(b.lh, 0.9, 2.6, 1.45), ls: cl(b.ls, -0.05, 0.5, 0),
        imgId: validIds.has(b.imgId) ? b.imgId : '',
      }))) : prev.bloques,
    }
    })
    return { slides: slides as Slide[], n }
  }

  generarDoc = async () => {
    if (this.state.generating) return
    if (!this.aiAvail()) { this.up({ error: 'La redacción con IA no está disponible en este entorno.' }); return }
    this.up({ generating: true, error: '' })
    const s = this.state, d = s.datos
    const ctx = {
      cliente_expositor: d.cliente, web_del_expositor: d.web, feria: d.feria, stand: d.stand,
      objetivo_del_proyecto: d.objetivo, productos_que_se_exponen: d.productos,
      descripcion_del_stand: d.descripcion, directrices_adicionales: d.directrices,
      imagenes_disponibles: s.imagenes.map((im) => ({ id: im.id, nombre: im.name, descripcion: im.desc || '(sin descripción)' })),
      hay_presupuesto: s.presupuesto.rows.length > 0,
    }
    const prompt = 'Compón el documento de venta de Ready Eventos para presentar el diseño de un stand de feria a un cliente expositor.\n\nBRIEF:\n' + JSON.stringify(ctx, null, 1) +
      '\n\nTIPOS DE LÁMINA DISPONIBLES (formato A4 apaisado, criterios de marca fijos):\n' +
      '- "hero": portada a sangre con la imagen más espectacular; titulo = claim de máx. 8 palabras; texto = subtítulo corto en una línea (cliente · feria · stand).\n' +
      '- "quienes": presentación de Ready Eventos (texto + 1 imagen de montaje si la hay); titulo y texto sobre la empresa (acompañamiento integral del diseño a la ejecución, especialistas en stands).\n' +
      '- "split": imagen grande a un lado ("side": "left" o "right") + kicker, titulo y texto.\n' +
      '- "fullimg": imagen a toda página arriba + titulo y texto abajo.\n' +
      '- "dark": lámina oscura de impacto, texto emocional + 1 imagen.\n' +
      '- "gallery3": titulo + texto + 3 imágenes (ideal para productos o detalles).\n' +
      '- "text": declaración centrada sin imagen (usar como mucho 1 vez).\n' +
      '- "presupuesto": tabla del presupuesto (solo si hay_presupuesto es true; sin titulo/texto propios, solo kicker "PRESUPUESTO").\n' +
      '- "cierre": lámina final centrada; titulo = llamada a la acción de máx. 8 palabras; texto = 1 frase de refuerzo.' +
      this.EXTRA_SPEC + this.LIBRE_SPEC + '\n' +
      'Además, cualquier lámina admite "bg" (hex) para cambiar su color de fondo.\n' +
      '\nREGLAS:\n' +
      '1. Entre 6 y 10 láminas. La primera SIEMPRE "hero", la segunda "quienes", la última "cierre". Si hay_presupuesto, incluye "presupuesto" justo antes del cierre.\n' +
      '2. Estructura el resto según el brief: concepto, el espacio y su recorrido, la experiencia del visitante, los productos… Elige el tipo de lámina más adecuado a cada contenido y a las imágenes disponibles. Tienes libertad compositiva: usa "libre" cuando aporte más impacto (máx. 3 láminas libres).\n' +
      '3. Asigna las imágenes por su descripción usando sus "id" en "imgs" (máx. 1 uso por imagen; "gallery3" lleva hasta 3 ids; deja [] si no hay imagen adecuada).\n' +
      '4. Kickers cortos numerados (p. ej. "01 · CONCEPTO", "02 · EL ESPACIO"); hero y cierre sin número.\n' +
      '5. Textos: retórica arquitectónica (materialidad, luz, recorrido, escala, umbral, ritmo) + neuromarketing (emoción primero, beneficios sensoriales, lo que vive el visitante, verbos de acción, frases cortas). 45–85 palabras por lámina (salvo hero y cierre). Español. Sin listas ni markdown. No inventes cifras.\n' +
      '\nResponde EXCLUSIVAMENTE con JSON válido: {"slides":[{"tipo":"...","kicker":"...","titulo":"...","texto":"...","imgs":["im1"],"side":"left"}]}'
    try {
      const res = await this.claude({ messages: [{ role: 'user', content: prompt }], system: 'Eres el director creativo de Ready Eventos, empresa española de diseño y montaje de stands de exposición para ferias (Grupo IGC). Compones presentaciones comerciales impecables. Responde SOLO con el JSON pedido, sin explicaciones ni ```.', max_tokens: 8000 })
      const o = salvageSlides(res)
      if (!o.slides || !o.slides.length) throw new Error('sin láminas')
      const { slides, n } = this.sanitizeSlides(o.slides)
      if (!slides.length) throw new Error('sin láminas válidas')
      this.up({ generating: false, seq: n, slides, fase: 'doc', tab: 'laminas' })
    } catch (err: any) {
      this.up({ generating: false, error: 'No se pudo componer el documento (' + err.message + '). Vuelve a intentarlo.' })
    }
  }

  adaptarIA = async () => {
    if (this.state.presuIA) return
    if (!this.aiAvail()) { this.up({ notice: 'La IA no está disponible en este entorno.' }); return }
    const pr = this.state.presupuesto
    if (!pr.rows.length) return
    this.setState({ presuIA: true })
    try {
      const res = await this.claude({
        messages: [{ role: 'user', content: 'Presupuesto en bruto exportado de Excel:\n' + JSON.stringify({ cols: pr.cols, filas: pr.rows }) + '\n\nAdáptalo a un presupuesto corporativo limpio de Ready Eventos (stands de feria) CONSERVANDO la organización del original: mismos capítulos/secciones, mismas partidas en el mismo orden y mismos subtotales. Formato: capítulo = fila con SOLO la primera celda rellena; subtotal = fila cuyo primer texto empiece por "Subtotal". Elimina solo filas vacías o basura de exportación. Conceptos con nombres claros, columnas con sentido, números en formato español (1.234,56). NO incluyas la fila del TOTAL GENERAL (se calcula aparte). No inventes importes. Responde SOLO con JSON: {"cols":[...],"rows":[[...]]}.' }],
        system: 'Eres el responsable comercial de Ready Eventos, empresa española de stands de feria. Responde SOLO con el JSON pedido, sin explicaciones ni ```.', max_tokens: 8000,
      })
      const o = salvageObj(res)
      this.setState({ presuIA: false })
      if (Array.isArray(o.cols) && Array.isArray(o.rows)) this.up({ presupuesto: { ...this.state.presupuesto, cols: o.cols.map(String), rows: o.rows.map((r: any[]) => r.map(String)) } })
      else this.up({ notice: 'La IA no ha devuelto un presupuesto válido. Vuelve a intentarlo.' })
    } catch (err: any) {
      this.setState({ presuIA: false })
      this.up({ notice: 'No se pudo adaptar el presupuesto: ' + err.message })
    }
  }

  adjAdd = async (ev: any) => {
    const files = [...ev.target.files] as File[]
    ev.target.value = ''
    for (const f of files) {
      try {
        const id = 'adj' + Date.now() + Math.random().toString(36).slice(2, 6)
        if (/^image\//.test(f.type)) {
          const src = await this.fileToDataURL(f, 1200)
          this.setState({ iaAdj: [...this.state.iaAdj, { id, kind: 'img', name: f.name, src }] })
        } else {
          let text = ''
          if (/\.pdf$/i.test(f.name)) text = await this.xl.extractPDFText(await f.arrayBuffer())
          else if (/\.xlsx$/i.test(f.name)) text = JSON.stringify(await this.xl.parseXLSX(await f.arrayBuffer()))
          else text = await f.text()
          text = String(text || '').slice(0, 9000)
          if (!text.trim()) throw new Error('sin texto legible')
          this.setState({ iaAdj: [...this.state.iaAdj, { id, kind: 'text', name: f.name, text }] })
        }
      } catch (e2: any) {
        this.up({ notice: 'No se pudo adjuntar «' + f.name + '»: ' + e2.message })
      }
    }
  }

  mkContent(text: string): any {
    const imgs = this.state.iaAdj.filter((a) => a.kind === 'img')
    const docs = this.state.iaAdj.filter((a) => a.kind === 'text')
    let t = text
    for (const d of docs) t += '\n\nDOCUMENTO ADJUNTO «' + d.name + '»:\n' + d.text
    if (imgs.length) t += '\n\nSe adjuntan ' + imgs.length + ' imagen(es) como contexto visual: analízalas y tenlas en cuenta.'
    if (!imgs.length) return t
    return [
      ...imgs.map((a) => {
        const m = String(a.src).match(/^data:([^;]+);base64,(.*)$/)
        return { type: 'image', source: { type: 'base64', media_type: m ? m[1] : 'image/jpeg', data: m ? m[2] : '' } }
      }),
      { type: 'text', text: t },
    ]
  }

  async askClaude(prompt: string, system: string, max: number): Promise<string> {
    const content = this.mkContent(prompt)
    try {
      return await this.claude({ messages: [{ role: 'user', content }], system, max_tokens: max })
    } catch (e) {
      if (Array.isArray(content)) {
        const txt = (content.find((c: any) => c.type === 'text') || {}).text || prompt
        return await this.claude({ messages: [{ role: 'user', content: txt + '\n\n(Nota: había imágenes adjuntas que no se pudieron procesar.)' }], system, max_tokens: max })
      }
      throw e
    }
  }

  dictar(fieldKey: string) {
    if (this.state.micOn) {
      const same = this.state.micOn === fieldKey
      try { this._rec && this._rec.stop() } catch (e) {}
      this.setState({ micOn: null })
      if (same) return
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { this.up({ notice: 'El dictado por voz no está disponible en este navegador. Prueba con Chrome o Edge.' }); return }
    const rec = new SR()
    rec.lang = 'es-ES'; rec.continuous = true; rec.interimResults = false
    rec.onresult = (ev: any) => {
      let txt = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) txt += ev.results[i][0].transcript
      txt = txt.trim()
      if (!txt) return
      if (fieldKey === 'global') this.setState({ iaPrompt: ((this.state.iaPrompt || '') + ' ' + txt).trim() })
      else if (fieldKey === 'presu') this.setState({ presuPrompt: ((this.state.presuPrompt || '') + ' ' + txt).trim() })
      else this.setState({ iaPrompts: { ...this.state.iaPrompts, [fieldKey]: (((this.state.iaPrompts || {})[fieldKey] || '') + ' ' + txt).trim() } })
    }
    rec.onend = () => { if (this.state.micOn === fieldKey) this.setState({ micOn: null }) }
    rec.onerror = () => this.setState({ micOn: null })
    this._rec = rec
    try { rec.start(); this.setState({ micOn: fieldKey }) } catch (e) {}
  }

  pedirCambios = async (scopeId: string | null) => {
    const instr = (scopeId ? (this.state.iaPrompts[scopeId] || '') : this.state.iaPrompt).trim()
    if (!instr || this.state.iaBusyId) return
    if (!this.aiAvail()) { this.up({ iaError: 'La IA no está disponible en este entorno.' }); return }
    this.setState({ iaBusyId: scopeId || 'global', iaError: '' })
    const s = this.state, d = s.datos
    const scope = scopeId ? s.slides.findIndex((x) => x.id === scopeId) : -1
    const ctx = {
      brief: { cliente: d.cliente, feria: d.feria, stand: d.stand, objetivo: d.objetivo, productos: d.productos, descripcion: d.descripcion },
      imagenes_disponibles: s.imagenes.map((im) => ({ id: im.id, descripcion: im.desc || im.name })),
      hay_presupuesto: s.presupuesto.rows.length > 0,
      laminas_actuales: s.slides.map((x) => ({ id: x.id, tipo: x.tipo, kicker: x.kicker, titulo: x.titulo, texto: x.texto, imgs: x.imgs || [], side: x.side || 'left' })),
    }
    const prompt = 'Documento de venta de Ready Eventos (stands de feria). Estado actual:\n' + JSON.stringify(ctx, null, 1) +
      '\n\nTIPOS DE LÁMINA: "hero" (portada a sangre, titulo=claim), "quienes" (presentación Ready Eventos), "split" (imagen a un lado, "side":"left"|"right"), "fullimg" (imagen a toda página + texto abajo), "dark" (lámina oscura de impacto), "gallery3" (hasta 3 imágenes), "text" (declaración centrada), "presupuesto" (tabla, solo kicker), "cierre" (final, llamada a la acción).' +
      this.EXTRA_SPEC + this.COLLAGE_SPEC + this.LIBRE_SPEC + '\nCualquier lámina admite "bg" (hex) para su color de fondo. Tienes libertad total de diseño: si el usuario pide un diseño que las plantillas no cubren, convierte la lámina a "libre" y compónla con bloques; conserva el contenido salvo indicación contraria.\n' +
      '\nINSTRUCCIÓN DEL USUARIO:\n' + instr +
      (scope >= 0 ? '\n\nÁMBITO: aplica los cambios SOLO a la lámina ' + (scope + 1) + ' (id "' + scopeId + '"); deja las demás EXACTAMENTE igual salvo que la instrucción exija lo contrario.' : '\n\nÁMBITO: todo el documento.') +
      '\n\nDevuelve el array COMPLETO de láminas ya modificado (incluidas las que no cambian, con sus mismos id, en el orden final). Puedes cambiar textos, tipos, lados, imágenes (solo ids existentes, máx. 1 uso por imagen), reordenar, añadir láminas nuevas (sin id) o eliminar. Mantén el estilo: retórica arquitectónica + neuromarketing, textos 45–85 palabras (salvo hero/cierre), kickers cortos numerados. Español. No inventes cifras.\n\nResponde EXCLUSIVAMENTE con JSON: {"slides":[{"id":"...","tipo":"...","kicker":"...","titulo":"...","texto":"...","imgs":[],"side":"left"}]}'
    try {
      const res = await this.askClaude(prompt, 'Eres el director creativo de Ready Eventos, empresa española de diseño y montaje de stands de exposición para ferias. Editas presentaciones comerciales con precisión: cambias solo lo que se pide.', 8000)
      const o = salvageSlides(res)
      if (!o.slides || !o.slides.length) throw new Error('sin láminas')
      const { slides, n } = this.sanitizeSlides(o.slides)
      if (!slides.length) throw new Error('sin láminas válidas')
      const iaPrompts = { ...this.state.iaPrompts }
      if (scopeId) delete iaPrompts[scopeId]
      // edRev remonta los contentEditable para que muestren el texto nuevo
      // aunque el usuario tuviera uno enfocado durante la petición.
      this.setState({ iaBusyId: null, edRev: (this.state.edRev || 0) + 1 })
      this.up({ seq: n, slides, iaPrompt: scopeId ? this.state.iaPrompt : '', iaPrompts, iaError: '', iaAdj: [] })
    } catch (err: any) {
      this.setState({ iaBusyId: null, iaError: 'No se pudieron aplicar los cambios (' + err.message + '). Vuelve a intentarlo.' })
    }
  }

  // ---- direct image editing (pan + scale within mask) ----
  getTr(sid: string, k: number): any {
    const sl = this.state.slides.find((x) => x.id === sid)
    return { ...this.TR0, ...((sl && sl.tr && sl.tr[k]) || {}) }
  }
  // ---- collage ----
  clItems0(sid: string): CollageItem[] { return ((this.state.slides.find((x) => x.id === sid) || ({} as any)).collage) || [] }
  clSet(sid: string, items: CollageItem[], log?: boolean) {
    const slides = this.state.slides.map((x) => x.id === sid ? { ...x, collage: items } : x)
    if (log) this.up({ slides }); else this.setState({ slides }, () => this.persist())
  }
  clPatch(sid: string, idx: number, patch: any, log?: boolean) {
    this.clSet(sid, this.clItems0(sid).map((it, i) => i === idx ? { ...it, ...patch } : it), log)
  }
  async clDrop(sid: string, ev: any) {
    ev.preventDefault(); ev.stopPropagation()
    const rect = ev.currentTarget.getBoundingClientRect()
    const mx = (ev.clientX - rect.left) / rect.width * 297
    const my = (ev.clientY - rect.top) / rect.height * 210
    const files = [...(ev.dataTransfer.files || [])].filter((f: any) => /^image\//.test(f.type)) as File[]
    if (!files.length) return
    this.logUndo({ slides: 1, imagenes: 1 })
    let seq = this.state.seq, imagenes = this.state.imagenes, items = [...this.clItems0(sid)], off = 0
    for (const f of files) {
      try {
        const src = await this.fileToDataURL(f, 1600)
        const id = 'im' + seq++
        this.idbPut(id, src)
        imagenes = [...imagenes, { id, name: f.name.replace(/\.[^.]+$/, ''), src, desc: '' }]
        items.push({ id: 'cl' + Date.now() + '_' + off, img: id, x: Math.min(280, mx + off * 10), y: Math.min(196, my + off * 8), w: 95, rot: 0, f: 0.35 })
        off++
      } catch (e) {}
    }
    this.setState({ seq, imagenes, slides: this.state.slides.map((x) => x.id === sid ? { ...x, collage: items } : x), clSel: { sid, idx: items.length - 1 } }, () => this.persistNow())
  }
  clAddGal(sid: string, imgId: string) {
    if (!imgId) return
    const items = this.clItems0(sid)
    this.clSet(sid, [...items, { id: 'cl' + Date.now(), img: imgId, x: 110 + (items.length % 4) * 26, y: 85 + (items.length % 3) * 22, w: 95, rot: 0, f: 0.35 }], true)
    this.setState({ clSel: { sid, idx: items.length } })
  }
  clStart(sid: string, idx: number, mode: string, e: any, corner?: string) {
    e.stopPropagation(); e.preventDefault()
    const page = e.currentTarget.closest('[data-page]')
    if (!page) return
    const rect = page.getBoundingClientRect()
    const pmm = (ev: any): [number, number] => [(ev.clientX - rect.left) / rect.width * 297, (ev.clientY - rect.top) / rect.height * 210]
    const it0: any = { ...this.clItems0(sid)[idx] }
    const p0 = pmm(e)
    const prev = this.state.clSel
    this.setState({ clSel: { sid, idx }, clCrop: (prev && prev.sid === sid && prev.idx === idx) ? this.state.clCrop : false })
    this.logGesture()
    const cr0 = { t: 0, r: 0, b: 0, l: 0, ...(it0.crop || {}) }
    const ar = (((this._imgAr && this._imgAr[it0.img]) || 0.72) * Math.max(0.05, 1 - cr0.t - cr0.b)) / Math.max(0.05, 1 - cr0.l - cr0.r)
    const rot = (it0.rot || 0) * Math.PI / 180
    const Rv = (vx: number, vy: number): [number, number] => [Math.cos(rot) * vx - Math.sin(rot) * vy, Math.sin(rot) * vx + Math.cos(rot) * vy]
    const sx = corner && corner.includes('l') ? -1 : 1
    const sy = corner && corner.includes('t') ? -1 : 1
    const h0 = it0.w * ar
    const co = Rv(sx * it0.w / 2, sy * h0 / 2)
    const anchor = [it0.x - co[0], it0.y - co[1]]
    const mv = (ev: any) => {
      const p = pmm(ev)
      if (mode === 'move') this.clPatch(sid, idx, { x: it0.x + p[0] - p0[0], y: it0.y + p[1] - p0[1] }, false)
      else if (mode === 'scale') {
        const v = [p[0] - anchor[0], p[1] - anchor[1]]
        const u = [Math.cos(rot) * v[0] + Math.sin(rot) * v[1], -Math.sin(rot) * v[0] + Math.cos(rot) * v[1]]
        const neww = Math.max(12, Math.min(420, Math.max(Math.abs(u[0]), Math.abs(u[1]) / ar)))
        const cc = Rv(sx * neww / 2, sy * neww * ar / 2)
        this.clPatch(sid, idx, { w: neww, x: anchor[0] + cc[0], y: anchor[1] + cc[1] }, false)
      } else if (mode === 'rot') {
        const a = Math.atan2(p[1] - it0.y, p[0] - it0.x) - Math.atan2(p0[1] - it0.y, p0[0] - it0.x)
        let r = (it0.rot || 0) + a * 180 / Math.PI
        if (ev.shiftKey) r = Math.round(r / 15) * 15
        this.clPatch(sid, idx, { rot: Math.round(((r % 360) + 360) % 360 * 10) / 10 }, false)
      }
    }
    const fin = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', fin); this.persistNow() }
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', fin)
  }
  clCropStart(sid: string, idx: number, edge: string, e: any) {
    e.stopPropagation(); e.preventDefault()
    const page = e.currentTarget.closest('[data-page]')
    if (!page) return
    const rect = page.getBoundingClientRect()
    const pmm = (ev: any): [number, number] => [(ev.clientX - rect.left) / rect.width * 297, (ev.clientY - rect.top) / rect.height * 210]
    const it0: any = { ...this.clItems0(sid)[idx] }
    const cr0 = { t: 0, r: 0, b: 0, l: 0, ...(it0.crop || {}) }
    const ar = (this._imgAr && this._imgAr[it0.img]) || 0.72
    const rot = (it0.rot || 0) * Math.PI / 180
    const W = it0.w / Math.max(0.05, 1 - cr0.l - cr0.r)
    const H = W * ar
    const p0 = pmm(e)
    this.logGesture()
    const Rv = (vx: number, vy: number): [number, number] => [Math.cos(rot) * vx - Math.sin(rot) * vy, Math.sin(rot) * vx + Math.cos(rot) * vy]
    const cl = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))
    const mv = (ev: any) => {
      const p = pmm(ev)
      const v = [p[0] - p0[0], p[1] - p0[1]]
      const u = Math.cos(rot) * v[0] + Math.sin(rot) * v[1]
      const w2 = -Math.sin(rot) * v[0] + Math.cos(rot) * v[1]
      const cr: any = { ...cr0 }
      let shift: [number, number] = [0, 0]
      if (edge === 'l') { cr.l = cl(cr0.l + u / W, 0, 0.9 - cr0.r); shift = Rv((cr.l - cr0.l) * W / 2, 0) }
      else if (edge === 'r') { cr.r = cl(cr0.r - u / W, 0, 0.9 - cr0.l); shift = Rv(-(cr.r - cr0.r) * W / 2, 0) }
      else if (edge === 't') { cr.t = cl(cr0.t + w2 / H, 0, 0.9 - cr0.b); shift = Rv(0, (cr.t - cr0.t) * H / 2) }
      else { cr.b = cl(cr0.b - w2 / H, 0, 0.9 - cr0.t); shift = Rv(0, -(cr.b - cr0.b) * H / 2) }
      this.clPatch(sid, idx, { crop: cr, w: W * Math.max(0.05, 1 - cr.l - cr.r), x: it0.x + shift[0], y: it0.y + shift[1] }, false)
    }
    const fin = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', fin); this.persistNow() }
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', fin)
  }
  async dropSlot(slId: string, k: number, ev: any) {
    ev.preventDefault(); ev.stopPropagation()
    const f = [...(ev.dataTransfer.files || [])].find((x: any) => /^image\//.test(x.type)) as File | undefined
    if (this.state.dragSlot) this.setState({ dragSlot: null })
    if (!f) return
    this.logUndo({ slides: 1, imagenes: 1 })
    try {
      const src = await this.fileToDataURL(f)
      const id = 'im' + this.state.seq
      this.idbPut(id, src)
      const slides = this.state.slides.map((x) => {
        if (x.id !== slId) return x
        const imgs = [...(x.imgs || [])]
        while (imgs.length <= k) imgs.push('')
        imgs[k] = id
        const tr: any = { ...(x.tr || {}) }
        delete tr[k]
        return { ...x, imgs, tr }
      })
      this.setState({ seq: this.state.seq + 1, imagenes: [...this.state.imagenes, { id, name: f.name.replace(/\.[^.]+$/, ''), src, desc: '' }], slides }, () => this.persistNow())
    } catch (e) {}
  }
  slotOver = (ev: any) => { ev.preventDefault(); ev.stopPropagation(); ev.dataTransfer.dropEffect = 'copy' }
  slotOverHi(sid: string, k: number, ev: any) {
    ev.preventDefault(); ev.stopPropagation(); ev.dataTransfer.dropEffect = 'copy'
    const d = this.state.dragSlot
    if (!d || d.sid !== sid || d.k !== k) this.setState({ dragSlot: { sid, k } })
  }
  slotLeaveHi(sid: string, k: number) {
    const d = this.state.dragSlot
    if (d && d.sid === sid && d.k === k) this.setState({ dragSlot: null })
  }
  clWheel(sid: string, idx: number, e: any) {
    e.preventDefault(); e.stopPropagation()
    const it = this.clItems0(sid)[idx]
    if (!it) return
    this.logWheel()
    if (e.shiftKey) this.clPatch(sid, idx, { rot: Math.round((((it.rot || 0) + (e.deltaY < 0 ? -3 : 3)) % 360 + 360) % 360) }, false)
    else this.clPatch(sid, idx, { w: Math.max(12, Math.min(420, (it.w || 95) * (e.deltaY < 0 ? 1.06 : 1 / 1.06))) }, false)
    this.persist()
  }
  setTr(sid: string, k: number, patch: any, persist?: boolean) {
    const slides = this.state.slides.map((x) => {
      if (x.id !== sid) return x
      const cur = { ...this.TR0, ...((x.tr && x.tr[k]) || {}) }
      return { ...x, tr: { ...(x.tr || {}), [k]: { ...cur, ...patch } } }
    })
    persist ? this.up({ slides }) : this.setState({ slides })
  }
  imgDragStart(sid: string, k: number, e: any) {
    e.preventDefault(); e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const tr = this.getTr(sid, k)
    const cl = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
    this.logGesture()
    const d = { x0: e.clientX, y0: e.clientY, ox: tr.ox, oy: tr.oy }
    const mv = (ev: any) => {
      const dx = (ev.clientX - d.x0) / Math.max(1, rect.width) * 100
      const dy = (ev.clientY - d.y0) / Math.max(1, rect.height) * 100
      this.setTr(sid, k, { ox: cl(d.ox - dx, 0, 100), oy: cl(d.oy - dy, 0, 100) }, false)
    }
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); this.persist() }
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up)
  }
  imgWheel(sid: string, k: number, e: any) {
    e.preventDefault()
    const tr = this.getTr(sid, k)
    const s2 = Math.max(1, Math.min(4, tr.s * (e.deltaY < 0 ? 1.07 : 1 / 1.07)))
    this.logWheel()
    this.setTr(sid, k, { s: s2 }, true)
  }

  // ---- budget line-items modal ----
  presuLvArr(): (number | undefined)[] {
    const pr = this.state.presupuesto
    return Array.from({ length: pr.rows.length }, (_q, k) => (pr.lv || [])[k])
  }
  presuMoveRow(from: number | null, to: number) {
    if (from === null || from === undefined || from === to) { this.setState({ dragIdx: null, overIdx: null, overOut: false }); return }
    const rows = [...this.state.presupuesto.rows]
    const lv = this.presuLvArr()
    const [it] = rows.splice(from, 1)
    lv.splice(from, 1)
    const target = from < to ? to - 1 : to
    rows.splice(target, 0, it)
    lv.splice(target, 0, undefined)
    this.setState({ dragIdx: null, overIdx: null, overOut: false })
    this.up({ presupuesto: { ...this.state.presupuesto, rows, lv } })
  }
  presuSetLv(i: number | null, v: number) {
    if (i === null || i === undefined) return
    const lv = this.presuLvArr()
    lv[i] = v
    this.setState({ dragIdx: null, overIdx: null, overOut: false })
    this.up({ presupuesto: { ...this.state.presupuesto, lv } })
  }
  presuInsertRow(idx: number | undefined, kind: string) {
    const pr = this.state.presupuesto
    const w = Math.max(1, pr.cols.length)
    const row = Array.from({ length: w }, () => '')
    if (kind === 'cap') row[0] = 'NUEVO CAPÍTULO'
    if (kind === 'sub') row[0] = 'Subtotal'
    const rows = [...pr.rows]
    const lv = this.presuLvArr()
    const at = idx === undefined ? rows.length : idx
    rows.splice(at, 0, row)
    lv.splice(at, 0, undefined)
    this.up({ presupuesto: { ...pr, rows, lv } })
  }

  updSlide(id: string, patch: Partial<Slide>) {
    this.up({ slides: this.state.slides.map((x) => x.id === id ? { ...x, ...patch } : x) })
  }
  // ---- PDF directo (mismas librerías empaquetadas que en Planos) ----
  buildPdf = async (): Promise<any | null> => {
    let HTI: any = null, JSPDF: any = null
    try {
      HTI = await import('html-to-image')
      JSPDF = (await import('jspdf')).jsPDF
    } catch { return null }
    // vista documento, sin selecciones (nada rosa) y a tamaño natural
    await new Promise<void>((res) => this.setState({ imgSel: null, dSel: null, dGhost: null, dTool: null, vista: 'doc' }, () => res()))
    await new Promise((r) => setTimeout(r, 120))
    try { await (document as any).fonts.ready } catch { /* ignore */ }
    const pages = Array.from(document.querySelectorAll('.venta-page')) as HTMLElement[]
    if (!pages.length) return null
    let pdf: any = null
    for (let i = 0; i < pages.length; i++) {
      this.setState({ pdfExporting: (i + 1) + ' / ' + pages.length + '…' })
      await new Promise((r) => setTimeout(r, 30))
      const canvas = await HTI.toCanvas(pages[i], {
        pixelRatio: 300 / 96,
        backgroundColor: '#FFFFFF',
        filter: (n: any) => !(n.getAttribute && (n.getAttribute('data-ui') || n.getAttribute('data-noprint'))),
        style: { boxShadow: 'none', margin: '0' },
      })
      const img = canvas.toDataURL('image/jpeg', 0.92)
      if (!pdf) pdf = new JSPDF({ unit: 'mm', format: [297, 210], orientation: 'l', compress: true })
      else pdf.addPage([297, 210], 'l')
      pdf.addImage(img, 'JPEG', 0, 0, 297, 210)
      canvas.width = canvas.height = 0
    }
    return pdf
  }

  exportPdfFile = async () => {
    if (this.state.pdfExporting) return
    this.setState({ pdfExporting: 'Preparando…' })
    try {
      const pdf = await this.buildPdf()
      if (!pdf) {
        this.setState({ pdfExporting: '' })
        setTimeout(() => window.print(), 80)
        return
      }
      const nm = (this.state.projName || 'documento-venta').replace(/[\\/:*?"<>|]+/g, '-').trim()
      pdf.save(nm + '.pdf')
      this.setState({ pdfExporting: '' })
    } catch {
      this.setState({ pdfExporting: '' })
      this.toast('No se pudo generar el PDF directo; se abre la impresión del navegador como alternativa.')
      setTimeout(() => window.print(), 80)
    }
  }

  // ---- compartir con el cliente: PDF en Storage + enlace firmado 60 días ----
  compartir = async () => {
    if (!supabaseReady) { this.toast('Compartir necesita conexión con la nube.'); return }
    if (this.state.shareBusy) return
    this.setState({ shareBusy: true, modalShare: true, shareUrl: '', shareCopied: false })
    try {
      const pdf = await this.buildPdf()
      if (!pdf) throw new Error('no se pudo generar el PDF')
      const blob: Blob = pdf.output('blob')
      const token = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
      const path = this.props.projectId + '/' + token + '.pdf'
      const { error } = await supabase.storage.from('compartidos').upload(path, blob, { upsert: true, contentType: 'application/pdf' })
      if (error) throw new Error(error.message)
      const { data, error: e2 } = await supabase.storage.from('compartidos').createSignedUrl(path, 60 * 86400)
      if (e2 || !data?.signedUrl) throw new Error(e2?.message || 'no se pudo firmar el enlace')
      let copied = false
      try { await navigator.clipboard.writeText(data.signedUrl); copied = true } catch { /* http o permiso */ }
      this.setState({ shareBusy: false, shareUrl: data.signedUrl, shareCopied: copied, pdfExporting: '' })
      this.cargarShares()
    } catch (err: any) {
      this.setState({ shareBusy: false, pdfExporting: '', modalShare: false })
      this.toast('No se pudo compartir: ' + err.message + (/(bucket|not found)/i.test(String(err.message)) ? ' — ¿está ejecutada la migración «mejoras»?' : ''))
    }
  }

  cargarShares = async () => {
    if (!supabaseReady) return
    try {
      const { data } = await supabase.storage.from('compartidos').list(this.props.projectId, { limit: 50 })
      const out: { name: string; url: string }[] = []
      for (const f of data || []) {
        const { data: u } = await supabase.storage.from('compartidos').createSignedUrl(this.props.projectId + '/' + f.name, 60 * 86400)
        if (u?.signedUrl) out.push({ name: f.name, url: u.signedUrl })
      }
      this.setState({ shareList: out })
    } catch { /* ignore */ }
  }

  revocarShare = async (name: string) => {
    try {
      await supabase.storage.from('compartidos').remove([this.props.projectId + '/' + name])
      this.cargarShares()
    } catch { /* ignore */ }
  }

  moveSlide(id: string, dir: number) {
    const arr = [...this.state.slides]
    const i = arr.findIndex((x) => x.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= arr.length) return
    const [it] = arr.splice(i, 1)
    arr.splice(j, 0, it)
    this.up({ slides: arr })
  }
  // Reordenación por arrastre en la vista de cuadrícula: mueve la lámina
  // arrastrada (por id, robusto aunque cambie la lista en vuelo) delante de la
  // de destino, o al final si dstId es null.
  gridReorder(dstId: string | null) {
    const fromId = this._gridDrag
    this._gridDrag = null
    this.setState({ gridOver: null })
    if (!fromId || fromId === dstId) return
    const slides = [...this.state.slides]
    const from = slides.findIndex((x) => x.id === fromId)
    if (from < 0) return
    const [it] = slides.splice(from, 1)
    const dst = dstId === null ? slides.length : slides.findIndex((x) => x.id === dstId)
    if (dst < 0) return
    slides.splice(dst, 0, it)
    this.up({ slides })
  }

  renderVals(): any {
    const s = this.state
    const d = s.datos
    const accent = this.props.acento ?? '#D6197E'

    const df = (key: string, label: string, ph?: string) => ({
      label, ph: ph || '', value: d[key] || '',
      onChange: (e: any) => this.up({ datos: { ...this.state.datos, [key]: e.target.value } }),
    })
    const datosCortos = [
      df('cliente', 'Cliente / expositor', 'p. ej. Diasorin'),
      df('web', 'Web del expositor', 'p. ej. diasorin.com'),
      df('feria', 'Feria', 'p. ej. Fitur 2026 · IFEMA'),
      df('stand', 'Stand', 'p. ej. Stand 6×3, dos frentes abiertos'),
    ]
    const datosLargos = [
      df('objetivo', 'Objetivo del proyecto', 'Qué debe conseguir el stand: notoriedad, captación de leads, presentación de producto…'),
      df('productos', 'Productos que se exponen', 'Qué se expone y qué hay que destacar de cada producto'),
      df('descripcion', 'Descripción del stand', 'Describe el diseño: materiales, alturas, mostrador, almacén, iluminación, pantallas…'),
      df('directrices', 'Directrices para la IA (opcional)', 'Tono, número de láminas, qué destacar…'),
    ]

    const galeriaRows = s.imagenes.map((im) => ({
      src: im.src, name: im.name, desc: im.desc,
      el: R('img', { src: im.src, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } }),
      onDesc: (e: any) => this.up({ imagenes: this.state.imagenes.map((x) => x.id === im.id ? { ...x, desc: e.target.value } : x) }),
      // Borrado en dos pasos y deshacible: el primer clic pide confirmación y
      // el blob no se toca (así Ctrl+Z restaura la imagen íntegra).
      delPend: s.imgDelPend === im.id,
      onDelete: () => {
        if (this.state.imgDelPend !== im.id) {
          clearTimeout(this._idp)
          this.setState({ imgDelPend: im.id })
          this._idp = setTimeout(() => this.setState((st) => st.imgDelPend === im.id ? { imgDelPend: null } as any : null), 3000)
          return
        }
        clearTimeout(this._idp)
        this.setState({ imgDelPend: null })
        this.up({
          imagenes: this.state.imagenes.filter((x) => x.id !== im.id),
          slides: this.state.slides.map((sl) => ({ ...sl, imgs: (sl.imgs || []).filter((q) => q !== im.id) })),
        })
        this.toast('Imagen eliminada de la galería.', true)
      },
    }))

    const pr = s.presupuesto
    const upPresu = (patch: Partial<Presupuesto>) => this.up({ presupuesto: { ...this.state.presupuesto, ...patch } })
    const presuCols = pr.cols.map((c, ci) => ({ value: c, onChange: (e: any) => upPresu({ cols: this.state.presupuesto.cols.map((x, j) => j === ci ? e.target.value : x) }) }))
    const presuRows = pr.rows.map((r, ri) => ({
      cells: r.map((c, ci) => ({ value: c, onChange: (e: any) => upPresu({ rows: this.state.presupuesto.rows.map((rr, j) => j === ri ? rr.map((cc, k) => k === ci ? e.target.value : cc) : rr) }) })),
      onDel: () => upPresu({ rows: this.state.presupuesto.rows.filter((_rr, j) => j !== ri) }),
    }))
    const isNum = (v: any) => this.xl && !isNaN(this.xl.num(v))
    const subRow = (r: string[]) => { const f = r.find((c) => String(c || '').trim()); return /^(sub)?total/i.test(String(f || '').trim()) }
    const capRow = (r: string[]) => !subRow(r) && String(r[0] || '').trim() !== '' && r.slice(1).every((c) => !String(c || '').trim())
    const hideSet = new Set((pr.hideCols || []).filter((i) => i > 0 && i < pr.cols.length))
    const visIdx = pr.cols.map((_c, i) => i).filter((i) => i === 0 || !hideSet.has(i))
    const hasSubs = pr.rows.some((r) => !capRow(r) && subRow(r))
    const extraCol = visIdx.length === 1 && hasSubs
    let presuPageCols: any[] = visIdx.map((i) => ({ label: pr.cols[i], ta: i === 0 ? 'left' : 'right' }))
    if (extraCol) presuPageCols = [...presuPageCols, { label: '', ta: 'right' }]
    let _inCap = false
    const inCapFlags = pr.rows.map((r) => { if (capRow(r)) { _inCap = true; return false } return _inCap })
    const effInCap = (r: string[], i: number) => {
      if (capRow(r)) return false
      const v = (pr.lv || [])[i]
      return (v === 0 || v === 1) ? v === 1 : inCapFlags[i]
    }
    const mkCellsRow = (r: string[], inCap: boolean) => {
      const cap = capRow(r), sub = !cap && subRow(r)
      let vals: string[]
      if (sub) {
        let amt = ''
        for (let q = r.length - 1; q > 0; q--) { if (String(r[q] || '').trim()) { amt = r[q]; break } }
        vals = visIdx.map((i2) => i2 === 0 ? r[0] : '')
        if (extraCol) vals.push('')
        if (vals.length > 1) vals[vals.length - 1] = amt
      } else {
        vals = visIdx.map((i2) => r[i2] !== undefined ? r[i2] : '')
        if (extraCol) vals.push('')
      }
      return {
        cells: vals.map((c, i) => ({
          v: c, ta: i === 0 ? 'left' : (isNum(c) ? 'right' : 'left'),
          fw: (cap || sub) ? 700 : 400,
          fs: cap ? '7.5pt' : (sub ? '8.5pt' : '9pt'),
          tt: cap ? 'uppercase' : 'none', ls: cap ? '0.1em' : '0em',
          ff: cap ? MONO : SANS,
          bt: sub ? '0.35mm solid #17161A' : 'none',
          bb: cap ? '0.45mm solid #17161A' : (sub ? 'none' : '0.2mm solid #E4E1DA'),
          bg: sub ? '#FAF9F7' : 'transparent',
          pad: cap ? '4.4mm 2mm 1.6mm' : ((i === 0 && inCap) ? '2.3mm 2mm 2.3mm 7mm' : '2.3mm 2mm'),
        })),
      }
    }
    const presuRowObjs = pr.rows.map((r, i) => mkCellsRow(r, effInCap(r, i)))
    const presuChunks: any[] = []
    { let q = 0, first = true
      while (q < presuRowObjs.length) { const size = first ? 10 : 15; presuChunks.push(presuRowObjs.slice(q, q + size)); q += size; first = false }
      if (!presuChunks.length) presuChunks.push([])
    }
    let presuFechaTxt = pr.fecha || ''
    try { presuFechaTxt = new Date((pr.fecha || '') + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) } catch (e) {}
    let presuTotal = '', hasTotal = false
    const totalsRows: any[] = []
    if (this.xl && pr.rows.length) {
      const subs = pr.rows.filter((r) => !capRow(r) && subRow(r))
      const items = pr.rows.filter((r) => !capRow(r) && !subRow(r))
      const base = this.xl.sumLastCol(subs.length ? subs : items)
      if (!isNaN(base) && base > 0) {
        hasTotal = true
        let acc0 = base
        const descPct = +(pr.descPct || 0)
        const conIva = pr.conIva !== false && pr.conIva !== undefined ? !!pr.conIva : false
        const ivaPct = +(pr.ivaPct || 21)
        if (descPct > 0 || conIva) totalsRows.push({ k: 'BASE', v: this.xl.fmtEUR(base) })
        if (descPct > 0) {
          const dsc = base * descPct / 100
          acc0 = base - dsc
          totalsRows.push({ k: 'DESCUENTO ' + String(descPct).replace('.', ',') + '%', v: '−' + this.xl.fmtEUR(dsc) })
          if (conIva) totalsRows.push({ k: 'BASE IMPONIBLE', v: this.xl.fmtEUR(acc0) })
        }
        if (conIva) { const iva = acc0 * ivaPct / 100; totalsRows.push({ k: 'IVA ' + String(ivaPct).replace('.', ',') + '%', v: this.xl.fmtEUR(iva) }); acc0 += iva }
        presuTotal = this.xl.fmtEUR(acc0)
      }
    }

    const TIPO_LABELS: Record<string, string> = {
      hero: 'Portada (hero)', quienes: 'Quiénes somos', split: 'Imagen + texto', fullimg: 'Imagen a toda página',
      dark: 'Impacto (oscura)', gallery3: 'Galería de 3', text: 'Declaración', presupuesto: 'Presupuesto', cierre: 'Cierre',
      libre: 'Diseño libre (IA)', columnas2: 'Comparativa 2 columnas', timeline: 'Timeline de montaje', ficha: 'Ficha técnica', collage: 'Collage',
    }
    const tipoOptions = Object.keys(TIPO_LABELS).map((v) => ({ v, label: TIPO_LABELS[v] }))
    const imgOptions = [{ v: '', label: '— sin imagen —' }, ...s.imagenes.map((im) => ({ v: im.id, label: (im.desc || im.name).slice(0, 40) }))]
    const nImgs = (tipo: string) => tipo === 'gallery3' ? 3 : tipo === 'columnas2' ? 2 : (tipo === 'text' || tipo === 'presupuesto' || tipo === 'cierre' || tipo === 'libre' || tipo === 'timeline' || tipo === 'collage') ? 0 : 1

    const slideRows = s.slides.map((sl, ix) => ({
      n: String(ix + 1).padStart(2, '0'),
      tipo: sl.tipo, kicker: sl.kicker, titulo: sl.titulo, texto: sl.texto, side: sl.side || 'left',
      isSplit: sl.tipo === 'split', isLibre: sl.tipo === 'libre', isCollage: sl.tipo === 'collage',
      clPickV: (s.clPick || {})[sl.id] || '',
      onClPick: (e: any) => this.setState({ clPick: { ...(this.state.clPick || {}), [sl.id]: e.target.value } }),
      onClAdd: () => this.clAddGal(sl.id, (this.state.clPick || {})[sl.id] || (s.imagenes[0] || ({} as any)).id),
      hasTexts: sl.tipo !== 'presupuesto' && sl.tipo !== 'libre' && sl.tipo !== 'collage',
      textHint: sl.tipo === 'columnas2' ? 'Dos bloques separados por línea en blanco; la 1ª línea de cada bloque es su subtítulo.'
        : sl.tipo === 'timeline' ? 'Una línea por hito: «Hito: descripción corta».'
        : sl.tipo === 'ficha' ? 'Una línea por dato: «Clave: valor».' : '',
      hasImgSel: nImgs(sl.tipo) > 0,
      imgSels: Array.from({ length: nImgs(sl.tipo) }, (_q, k) => ({
        v: (sl.imgs || [])[k] || '',
        onChange: (e: any) => { const imgs = [...(sl.imgs || [])]; while (imgs.length <= k) imgs.push(''); imgs[k] = e.target.value; this.updSlide(sl.id, { imgs: imgs.filter((x, j) => x || j < nImgs(sl.tipo)) }) },
      })),
      onTipo: (e: any) => this.updSlide(sl.id, { tipo: e.target.value }),
      onKicker: (e: any) => this.updSlide(sl.id, { kicker: e.target.value }),
      onTitulo: (e: any) => this.updSlide(sl.id, { titulo: e.target.value }),
      onTexto: (e: any) => this.updSlide(sl.id, { texto: e.target.value }),
      onSide: (e: any) => this.updSlide(sl.id, { side: e.target.value }),
      onUp: () => this.moveSlide(sl.id, -1),
      onDown: () => this.moveSlide(sl.id, 1),
      onLibSave: () => this.libAdd(sl),
      onDup: () => this.dupSlide(sl.id),
      onCtx: (e: any) => this.openCtx(sl.id, e),
      onDelete: () => {
        if (this.state.slDelPend === sl.id) { clearTimeout(this._sdp); this.setState({ slDelPend: null }); this.up({ slides: this.state.slides.filter((x) => x.id !== sl.id) }); this.toast('Lámina eliminada.', true) }
        else { this.setState({ slDelPend: sl.id }); clearTimeout(this._sdp); this._sdp = setTimeout(() => this.setState({ slDelPend: null }), 3000) }
      },
      delLabel: s.slDelPend === sl.id ? '¿Eliminar?' : '×',
      delBg: s.slDelPend === sl.id ? '#C03A2B' : 'transparent',
      delFg: s.slDelPend === sl.id ? '#FFFFFF' : '#B4B0A8',
      delFs: s.slDelPend === sl.id ? '10.5px' : '16px',
      delPad: s.slDelPend === sl.id ? '4px 8px' : '0 2px',
      dropLine: (s.slOver === ix && s.slDrag !== null && s.slDrag !== ix) ? '2px solid #D6197E' : '2px solid transparent',
      onDragStart: (e: any) => { e.dataTransfer.effectAllowed = 'move'; this.setState({ slDrag: ix }) },
      onDragOver: (e: any) => { e.preventDefault(); if (this.state.slOver !== ix) this.setState({ slOver: ix }) },
      onDrop: (e: any) => {
        e.preventDefault()
        const from = this.state.slDrag
        this.setState({ slDrag: null, slOver: null })
        if (from === null || from === undefined || from === ix) return
        const slides = [...this.state.slides]
        const [it] = slides.splice(from, 1)
        slides.splice(from < ix ? ix - 1 : ix, 0, it)
        this.up({ slides })
      },
      onDragEnd: () => this.setState({ slDrag: null, slOver: null }),
      iaVal: s.iaPrompts[sl.id] || '',
      onIaVal: (e: any) => this.setState({ iaPrompts: { ...this.state.iaPrompts, [sl.id]: e.target.value } }),
      onPedirIa: () => this.pedirCambios(sl.id),
      iaBusy: s.iaBusyId === sl.id, iaIdle: s.iaBusyId !== sl.id,
      onMic: () => this.dictar(sl.id),
      micBg: s.micOn === sl.id ? '#D6197E' : 'transparent',
      micFg: s.micOn === sl.id ? '#FFFFFF' : '#B0447E',
    }))

    const addSlide = () => {
      const id = 'sl' + s.seq
      this.up({ seq: s.seq + 1, slides: [...s.slides, { id, tipo: 'split', kicker: '', titulo: 'Nueva lámina', texto: '', imgs: [], side: 'left' }] })
    }

    const byId = (id: string) => s.imagenes.find((im) => im.id === id)
    const mkImg = (sl: Slide, k: number) => {
      const im = byId((sl.imgs || [])[k])
      const sel = !!(s.imgSel && s.imgSel.sid === sl.id && s.imgSel.k === k)
      const tr = { ...this.TR0, ...((sl.tr && sl.tr[k]) || {}) }
      const maskCss = this.MASKS[tr.mask] || ''
      const fxCss = this.FXS[tr.fx] || ''
      const hl = !!(s.dragSlot && s.dragSlot.sid === sl.id && s.dragSlot.k === k)
      return {
        src: im ? im.src : '', has: !!im, no: !im,
        over: (e: any) => this.slotOverHi(sl.id, k, e),
        leave: () => this.slotLeaveHi(sl.id, k),
        drop: (e: any) => this.dropSlot(sl.id, k, e),
        hlOl: hl ? '0.9mm dashed #D6197E' : 'none',
        hlAnim: hl ? 'slotpulse 0.9s ease-in-out infinite' : 'none',
        el: im ? R('div', {
          onDragOver: (e: any) => this.slotOverHi(sl.id, k, e),
          onDragLeave: () => this.slotLeaveHi(sl.id, k),
          onDrop: (e: any) => this.dropSlot(sl.id, k, e),
          style: {
            position: 'absolute', inset: 0, overflow: 'hidden', cursor: sel ? 'grab' : 'pointer',
            outline: hl ? '0.9mm dashed #D6197E' : (sel ? '2px solid #D6197E' : 'none'), outlineOffset: hl ? '-2mm' : '-2px',
            animation: hl ? 'slotpulse 0.9s ease-in-out infinite' : undefined,
            WebkitMaskImage: maskCss || undefined, maskImage: maskCss || undefined, filter: fxCss || undefined,
          },
          title: sel ? 'Arrastra para recolocar · rueda para escalar' : 'Clic para editar la imagen',
          onClick: (e: any) => { e.stopPropagation(); if (!sel) this.setState({ imgSel: { sid: sl.id, k } }) },
          onDoubleClick: (e: any) => { e.stopPropagation(); this.setState({ imgSel: { sid: sl.id, k } }) },
          onMouseDown: sel ? ((e: any) => this.imgDragStart(sl.id, k, e)) : undefined,
          onWheel: sel ? ((e: any) => this.imgWheel(sl.id, k, e)) : undefined,
        }, [
          R('img', { key: 'img', src: im.src, alt: '', style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: tr.ox + '% ' + tr.oy + '%', transform: 'scale(' + tr.s + ')', transformOrigin: 'center', pointerEvents: 'none' } }),
          hl ? R('div', { key: 'hlov', 'data-ui': '1', style: { position: 'absolute', inset: 0, background: 'rgba(214,25,126,0.22)', backdropFilter: 'saturate(0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' } }, R('div', { style: { background: '#17161A', color: '#fff', borderRadius: '999px', padding: '2.6mm 5mm', fontFamily: MONO, fontSize: '8.5pt', letterSpacing: '0.06em', boxShadow: '0 4px 18px rgba(23,22,26,0.35)', animation: 'slotlabel 0.9s ease-in-out infinite' } }, 'Soltar para sustituir la imagen')) : null,
        ]) : null,
      }
    }

    const slidePages: any[] = []
    s.slides.forEach((sl, ix) => {
      const base: any = {
        ...this.dProps(sl),
        slIx: ix,
        slId: sl.id,
        label: (TIPO_LABELS[sl.tipo] || sl.tipo) + ' ' + (ix + 1),
        kicker: sl.kicker, titulo: sl.titulo, texto: sl.texto,
        onCtx: (e: any) => this.openCtx(sl.id, e),
        edRevK: 'edk' + (s.edRev || 0), edRevT: 'edt' + (s.edRev || 0), edRevX: 'edx' + (s.edRev || 0),
        onEdK: (e: any) => this.edCommit(sl.id, 'kicker', e),
        onEdT: (e: any) => this.edCommit(sl.id, 'titulo', e),
        onEdX: (e: any) => this.edCommit(sl.id, 'texto', e),
        isHero: sl.tipo === 'hero', isQuienes: sl.tipo === 'quienes', isSplit: sl.tipo === 'split',
        isFullimg: sl.tipo === 'fullimg', isDark: sl.tipo === 'dark', isGallery: sl.tipo === 'gallery3',
        isText: sl.tipo === 'text', isPresu: sl.tipo === 'presupuesto', isCierre: sl.tipo === 'cierre',
        isLibre: sl.tipo === 'libre', isCols2: sl.tipo === 'columnas2', isTimeline: sl.tipo === 'timeline', isFicha: sl.tipo === 'ficha',
        ...(() => {
          if (sl.tipo !== 'collage') return { isCollage: false, clSelOn: false, clEmpty: false }
          const items = sl.collage || []
          const selIdx = (s.clSel && s.clSel.sid === sl.id) ? s.clSel.idx : -1
          const selIt = items[selIdx]
          const arOf = (it: CollageItem) => { const im2 = byId(it.img); return (im2 && this._imgAr && this._imgAr[im2.id]) || 0.72 }
          const cropOf = (it: CollageItem) => { const c = it.crop || {}; return { t: c.t || 0, r: c.r || 0, b: c.b || 0, l: c.l || 0 } }
          const geo = items.map((it) => {
            const cr = cropOf(it)
            const fw = Math.max(0.05, 1 - cr.l - cr.r), fh = Math.max(0.05, 1 - cr.t - cr.b)
            const h = it.w * arOf(it) * fh / fw
            return { x: it.x, y: it.y, w: it.w, h, rot: (it.rot || 0) * Math.PI / 180, hd: 0.5 * Math.hypot(it.w, h) }
          })
          const cropMode = !!s.clCrop
          const clEl = items.map((it, i) => {
            const im = byId(it.img)
            if (!im) return null
            const sel = i === selIdx
            const f = Math.max(0, Math.min(0.75, it.f == null ? 0.35 : it.f))
            const masks: string[] = []
            if (f > 0.02) {
              const gT = geo[i]
              for (let j = 0; j < i; j++) {
                const gL = geo[j]
                if (!byId(items[j].img)) continue
                const dx = gL.x - gT.x, dy = gL.y - gT.y
                if (Math.hypot(dx, dy) >= gT.hd + gL.hd) continue
                const lx = gT.w / 2 + Math.cos(gT.rot) * dx + Math.sin(gT.rot) * dy
                const ly = gT.h / 2 - Math.sin(gT.rot) * dx + Math.cos(gT.rot) * dy
                const p0 = Math.max(0, Math.round((1 - (0.25 + f)) * 100))
                const ea = (gL.w / 2 * 1.06).toFixed(1), eb = (gL.h / 2 * 1.06).toFixed(1)
                masks.push('radial-gradient(ellipse ' + ea + 'mm ' + eb + 'mm at ' + lx.toFixed(1) + 'mm ' + ly.toFixed(1) + 'mm, rgba(0,0,0,0) 0%, rgba(0,0,0,0) ' + p0 + '%, rgba(0,0,0,1) 100%)')
              }
            }
            const cr = cropOf(it)
            const fw = Math.max(0.05, 1 - cr.l - cr.r), fh = Math.max(0.05, 1 - cr.t - cr.b)
            const arI = arOf(it)
            const Wf = it.w / fw, Hf = Wf * arI
            let inner: any = R('div', { key: 'crop', style: { position: 'relative', width: '100%', height: (Hf * fh) + 'mm', overflow: 'hidden' } }, R('img', {
              key: 'im', src: im.src, alt: '', draggable: false,
              onLoad: (e: any) => { const nw = e.target.naturalWidth, nh = e.target.naturalHeight; if (nw && nh) { this._imgAr = this._imgAr || {}; if (Math.abs((this._imgAr[im.id] || 0) - nh / nw) > 1e-4) { this._imgAr[im.id] = nh / nw; this.forceUpdate() } } },
              style: { position: 'absolute', left: (-cr.l * Wf) + 'mm', top: (-cr.t * Hf) + 'mm', width: Wf + 'mm', height: 'auto', pointerEvents: 'none', userSelect: 'none', maxWidth: 'none' },
            }))
            masks.forEach((m, k) => { inner = R('div', { key: 'mw' + k, style: { WebkitMaskImage: m, maskImage: m } }, inner) })
            const hstyle: any = { position: 'absolute', width: '4.6mm', height: '4.6mm', background: '#FFFFFF', border: '0.6mm solid #D6197E', borderRadius: '50%', boxShadow: '0 1px 4px rgba(23,22,26,0.3)', zIndex: 3 }
            return R('div', {
              key: it.id,
              style: { position: 'absolute', left: it.x + 'mm', top: it.y + 'mm', width: it.w + 'mm', transform: 'translate(-50%,-50%) rotate(' + (it.rot || 0) + 'deg)', cursor: sel ? 'grab' : 'pointer', zIndex: 2 + i },
              onMouseDown: (e: any) => this.clStart(sl.id, i, 'move', e),
              onWheel: sel ? ((e: any) => this.clWheel(sl.id, i, e)) : undefined,
            }, [
              inner,
              sel ? R('div', { key: 'sel', 'data-ui': '1', style: { position: 'absolute', inset: 0, outline: '0.5mm dashed #D6197E', outlineOffset: '1mm', pointerEvents: 'none' } }) : null,
              ...(sel && !cropMode ? [
                { k: 'tl', st: { left: '-3.4mm', top: '-3.4mm' }, cur: 'nwse-resize' },
                { k: 'tr', st: { right: '-3.4mm', top: '-3.4mm' }, cur: 'nesw-resize' },
                { k: 'bl', st: { left: '-3.4mm', bottom: '-3.4mm' }, cur: 'nesw-resize' },
                { k: 'br', st: { right: '-3.4mm', bottom: '-3.4mm' }, cur: 'nwse-resize' },
              ].map((c) => R('div', { key: 'hs' + c.k, 'data-ui': '1', title: 'Escalar (arrastra) · rueda del ratón', onMouseDown: (e: any) => this.clStart(sl.id, i, 'scale', e, c.k), style: { ...hstyle, ...c.st, cursor: c.cur } })) : []),
              ...(sel && cropMode ? [
                { k: 't', st: { left: '50%', top: '-2.3mm', transform: 'translateX(-50%)' }, cur: 'ns-resize' },
                { k: 'b', st: { left: '50%', bottom: '-2.3mm', transform: 'translateX(-50%)' }, cur: 'ns-resize' },
                { k: 'l', st: { left: '-2.3mm', top: '50%', transform: 'translateY(-50%)' }, cur: 'ew-resize' },
                { k: 'r', st: { right: '-2.3mm', top: '50%', transform: 'translateY(-50%)' }, cur: 'ew-resize' },
              ].map((c) => R('div', { key: 'hc' + c.k, 'data-ui': '1', title: 'Recortar este borde (arrastra)', onMouseDown: (e: any) => this.clCropStart(sl.id, i, c.k, e), style: { ...hstyle, borderRadius: '1px', width: (c.k === 't' || c.k === 'b') ? '7mm' : '4.6mm', height: (c.k === 't' || c.k === 'b') ? '4.6mm' : '7mm', ...c.st, cursor: c.cur } })) : []),
              sel && !cropMode ? R('div', { key: 'hr', 'data-ui': '1', title: 'Girar (arrastra) · Mayús ajusta a 15° · Mayús+rueda', onMouseDown: (e: any) => this.clStart(sl.id, i, 'rot', e), style: { ...hstyle, left: '50%', top: '-9mm', transform: 'translateX(-50%)', cursor: 'crosshair' } }) : null,
              sel && !cropMode ? R('div', { key: 'hrl', 'data-ui': '1', style: { position: 'absolute', left: '50%', top: '-6mm', width: '0.4mm', height: '6mm', background: '#D6197E', transform: 'translateX(-50%)', pointerEvents: 'none' } }) : null,
            ])
          })
          return {
            isCollage: true, clEl, clEmpty: !items.length,
            clOver: (e: any) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' },
            clDropEv: (e: any) => this.clDrop(sl.id, e),
            clBgDown: (e: any) => { if (e.target === e.currentTarget && this.state.clSel) this.setState({ clSel: null }) },
            clSelOn: !!selIt,
            clF: selIt ? Math.round((selIt.f == null ? 0.35 : selIt.f) * 100) : 35,
            onClF: (e: any) => { this.logWheel(); this.clPatch(sl.id, selIdx, { f: (+e.target.value) / 100 }, false) },
            clCropBg: cropMode ? '#D6197E' : '#26252A', clCropBd: cropMode ? '#D6197E' : '#3A3840',
            onClCropToggle: () => this.setState({ clCrop: !this.state.clCrop }),
            clHasCrop: !!(selIt && selIt.crop && (selIt.crop.t || selIt.crop.r || selIt.crop.b || selIt.crop.l)),
            onClCropReset: () => { const it2 = items[selIdx]; if (!it2) return; const c2 = { t: 0, r: 0, b: 0, l: 0, ...(it2.crop || {}) }; const W2 = it2.w / Math.max(0.05, 1 - c2.l - c2.r); this.clPatch(sl.id, selIdx, { crop: undefined, w: W2 }, true) },
            clFront: () => { const arr = [...items]; if (selIdx < 0 || selIdx >= arr.length - 1) return; const [q] = arr.splice(selIdx, 1); arr.push(q); this.clSet(sl.id, arr, true); this.setState({ clSel: { sid: sl.id, idx: arr.length - 1 } }) },
            clBack: () => { const arr = [...items]; if (selIdx <= 0) return; const [q] = arr.splice(selIdx, 1); arr.unshift(q); this.clSet(sl.id, arr, true); this.setState({ clSel: { sid: sl.id, idx: 0 } }) },
            clDel: () => { this.clSet(sl.id, items.filter((_q, i) => i !== selIdx), true); this.setState({ clSel: null }) },
          }
        })(),
        cols2: (() => {
          if (sl.tipo !== 'columnas2') return []
          const blocks = String(sl.texto || '').split(/\n\s*\n/).slice(0, 2)
          while (blocks.length < 2) blocks.push('')
          return blocks.map((b, k) => {
            const lines = b.split('\n')
            const im = byId((sl.imgs || [])[k])
            const hl = !!(s.dragSlot && s.dragSlot.sid === sl.id && s.dragSlot.k === k)
            return {
              sub: (lines[0] || '').trim(), body: lines.slice(1).join('\n').trim(),
              imgEl: im ? R('div', { onDragOver: (e: any) => this.slotOverHi(sl.id, k, e), onDragLeave: () => this.slotLeaveHi(sl.id, k), onDrop: (e: any) => this.dropSlot(sl.id, k, e), style: { position: 'absolute', inset: 0, outline: hl ? '0.9mm dashed #D6197E' : 'none', outlineOffset: '-2mm', animation: hl ? 'slotpulse 0.9s ease-in-out infinite' : undefined } }, [
                R('img', { key: 'img', src: im.src, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' } }),
                hl ? R('div', { key: 'hlov', 'data-ui': '1', style: { position: 'absolute', inset: 0, background: 'rgba(214,25,126,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' } }, R('div', { style: { background: '#17161A', color: '#fff', borderRadius: '999px', padding: '2mm 4mm', fontFamily: MONO, fontSize: '7.5pt', letterSpacing: '0.06em', boxShadow: '0 4px 18px rgba(23,22,26,0.35)', animation: 'slotlabel 0.9s ease-in-out infinite' } }, 'Soltar para sustituir')) : null,
              ]) : null,
              hasImg: !!im, noImg: !im,
              over: (e: any) => this.slotOverHi(sl.id, k, e), leave: () => this.slotLeaveHi(sl.id, k), drop: (e: any) => this.dropSlot(sl.id, k, e),
              hlOl: hl ? '0.9mm dashed #D6197E' : 'none', hlAnim: hl ? 'slotpulse 0.9s ease-in-out infinite' : 'none',
            }
          })
        })(),
        pasos: (() => {
          if (sl.tipo !== 'timeline') return []
          return String(sl.texto || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 6).map((l, k) => { const i2 = l.indexOf(':'); return { n: String(k + 1).padStart(2, '0'), t: i2 > 0 ? l.slice(0, i2).trim() : l, d: i2 > 0 ? l.slice(i2 + 1).trim() : '' } })
        })(),
        fichaRows: (() => {
          if (sl.tipo !== 'ficha') return []
          return String(sl.texto || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 12).map((l) => { const i2 = l.indexOf(':'); return { k: i2 > 0 ? l.slice(0, i2).trim() : l, v: i2 > 0 ? l.slice(i2 + 1).trim() : '' } })
        })(),
        pageBg: sl.bg || ((sl.tipo === 'hero' || sl.tipo === 'dark') ? '#17161A' : '#FFFFFF'),
        splitDir: sl.side === 'right' ? 'row-reverse' : 'row',
        i1: mkImg(sl, 0), i2: mkImg(sl, 1), i3: mkImg(sl, 2),
        bloques: (sl.bloques || []).map((b) => {
          const im = byId(b.imgId || '')
          return {
            l: b.x + '%', t: b.y + '%', w: b.w + '%', h: b.h + '%',
            isText: b.kind === 'text', isImg: b.kind === 'image' && !!im, isLogo: b.kind === 'logo',
            bgc: b.kind === 'rect' ? b.color : (b.bg || 'transparent'),
            ff: b.mono ? MONO : SANS, fs: b.size + 'pt', fw: b.weight, col: b.color, ta: b.align,
            lh: b.lh, ls: b.ls + 'em', text: b.text,
            imgEl: im ? R('img', { src: im.src, alt: '', style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' } }) : null,
          }
        }),
      }
      if (sl.tipo === 'presupuesto') {
        if (pr.incluir === false || !pr.rows.length) return
        presuChunks.forEach((chunk, ci) => {
          slidePages.push({ ...base, label: 'Presupuesto ' + (ci + 1) + '/' + presuChunks.length, pRows: chunk, pTitulo: pr.titulo + (ci > 0 ? ' — continuación' : ''), pShowHead: ci === 0, pShowTotal: ci === presuChunks.length - 1 && hasTotal, pShowCond: ci === presuChunks.length - 1, pCont: ci < presuChunks.length - 1 })
        })
      } else slidePages.push(base)
    })
    slidePages.forEach((pg, i) => {
      pg.numTxt = String(i + 1).padStart(2, '0') + ' / ' + String(slidePages.length).padStart(2, '0')
      pg.showNum = !pg.isHero
      let hx = (pg.pageBg || '#FFFFFF').replace('#', '')
      if (hx.length === 3) hx = hx.split('').map((c: string) => c + c).join('')
      const lum2 = (0.2126 * (parseInt(hx.slice(0, 2), 16) || 255) + 0.7152 * (parseInt(hx.slice(2, 4), 16) || 255) + 0.0722 * (parseInt(hx.slice(4, 6), 16) || 255)) / 255
      pg.numFg = lum2 < 0.55 ? 'rgba(255,255,255,0.55)' : '#8A867F'
    })

    let fechaLarga = ''
    try { fechaLarga = new Date().toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }).toUpperCase() } catch (e) {}

    const TABS = [{ id: 'laminas', label: 'Láminas' }, { id: 'presupuesto', label: 'Presupuesto' }]
    const tabs = TABS.map((t) => ({ ...t, go: () => this.up({ tab: t.id }), bg: s.tab === t.id ? '#17161A' : 'transparent', fg: s.tab === t.id ? '#FFFFFF' : '#6E6B66', bd: s.tab === t.id ? '#17161A' : '#D8D5CE' }))

    return {
      accent,
      projName: s.projName,
      exportProject: this.exportProject, importProject: this.importProject,
      isBrief: s.fase === 'brief', isDoc: s.fase === 'doc', hasDoc: s.slides.length > 0,
      hayLaminas: s.fase === 'doc' && s.slides.length > 0,
      ...this.dGlobalProps(),
      verDoc: () => this.up({ fase: 'doc' }), irBrief: () => this.up({ fase: 'brief' }),
      docSub: [d.cliente, d.feria].filter(Boolean).join(' · ') || 'Propuesta de stand',
      tabs, isLaminas: s.tab === 'laminas', isPresu: s.tab === 'presupuesto',
      datosCortos, datosLargos,
      onImgs: this.onImgs, galeriaRows, hasImgs: s.imagenes.length > 0,
      generarDoc: this.generarDoc, generating: s.generating, notGenerating: !s.generating,
      error: s.error, notice: s.notice,
      presuStatus: pr.rows.length ? ('Presupuesto cargado: ' + pr.rows.length + ' partidas' + (hasTotal ? ' · total ' + presuTotal : '')) : '',
      hasPresu: pr.rows.length > 0, noPresu: pr.rows.length === 0, totalsRows,
      presuDescPct: String(pr.descPct || 0),
      onPresuDescPct: (e: any) => upPresu({ descPct: Math.max(0, Math.min(90, parseFloat(e.target.value) || 0)) }),
      presuConIva: !!pr.conIva, onPresuConIva: (e: any) => upPresu({ conIva: e.target.checked }),
      presuIvaPct: String(pr.ivaPct || 21), onPresuIvaPct: (e: any) => upPresu({ ivaPct: Math.max(0, Math.min(40, parseFloat(e.target.value) || 21)) }),
      presuColToggles: pr.cols.map((c, i) => ({ c, i })).filter((x) => x.i > 0).map((x) => ({
        label: x.c || ('Columna ' + (x.i + 1)), on: !hideSet.has(x.i),
        onToggle: (e: any) => { const cur = new Set(this.state.presupuesto.hideCols || []); if (e.target.checked) cur.delete(x.i); else cur.add(x.i); upPresu({ hideCols: [...cur] }) },
      })),
      hasColToggles: pr.cols.length > 1 && pr.rows.length > 0,
      presuIncluir: pr.incluir !== false,
      onPresuIncluir: (e: any) => {
        const on = e.target.checked
        let slides = this.state.slides
        if (on && !slides.some((x) => x.tipo === 'presupuesto')) {
          const id = 'sl' + this.state.seq
          const nuevo: Slide = { id, tipo: 'presupuesto', kicker: 'PRESUPUESTO', titulo: '', texto: '', imgs: [], side: 'left' }
          const ci = slides.findIndex((x) => x.tipo === 'cierre')
          slides = ci >= 0 ? [...slides.slice(0, ci), nuevo, ...slides.slice(ci)] : [...slides, nuevo]
          this.up({ seq: this.state.seq + 1, slides, presupuesto: { ...this.state.presupuesto, incluir: true } })
        } else this.up({ presupuesto: { ...this.state.presupuesto, incluir: on } })
      },
      presuTitulo: pr.titulo, onPresuTitulo: (e: any) => upPresu({ titulo: e.target.value }),
      presuNum: pr.num || '', onPresuNum: (e: any) => upPresu({ num: e.target.value }),
      presuFecha: pr.fecha || '', onPresuFecha: (e: any) => upPresu({ fecha: e.target.value }),
      presuEmisor: pr.emisor || '', onPresuEmisor: (e: any) => upPresu({ emisor: e.target.value }),
      presuReceptor: pr.receptor || '', onPresuReceptor: (e: any) => upPresu({ receptor: e.target.value }),
      presuNumTxt: pr.num || '—', presuFechaTxt, presuEmisorTxt: pr.emisor || '—', presuReceptorTxt: pr.receptor || d.cliente || '—',
      presuCols, presuRows,
      modalPresu: s.modalPresu,
      abrirModalPresu: () => this.setState({ modalPresu: true }),
      cerrarModalPresu: () => this.setState({ modalPresu: false, dragIdx: null, overIdx: null }),
      trapClick: (e: any) => e.stopPropagation(),
      presuResumen: (() => { const caps = pr.rows.filter((r) => capRow(r)).length; const lineas = pr.rows.filter((r) => !capRow(r) && !subRow(r)).length; return lineas + (lineas === 1 ? ' línea' : ' líneas') + (caps ? ' · ' + caps + (caps === 1 ? ' capítulo' : ' capítulos') : '') })(),
      rowsEdit: pr.rows.map((r, ri) => {
        const cap = capRow(r), sub = !cap && subRow(r)
        const over = s.overIdx === ri && s.dragIdx !== null && s.dragIdx !== ri
        return {
          isCap: cap, notCap: !cap, tag: cap ? 'CAP' : (sub ? 'SUBT' : ''),
          tagBg: cap ? '#17161A' : '#E4E1DA', tagFg: cap ? '#FFFFFF' : '#55524D',
          bg: cap ? '#ECEAE5' : (sub ? '#FAF9F7' : '#FFFFFF'), bd: cap ? '#D8D5CE' : '#EAE8E2',
          ml: effInCap(r, ri) ? '26px' : '0px', fw: sub ? 700 : 400,
          dropLine: over ? '2px solid #D6197E' : '2px solid transparent',
          first: r[0] || '', onFirst: (e: any) => upPresu({ rows: pr.rows.map((rr, j) => j === ri ? rr.map((cc, k) => k === 0 ? e.target.value : cc) : rr) }),
          cells: r.map((c, ci) => ({ value: c, onChange: (e: any) => upPresu({ rows: this.state.presupuesto.rows.map((rr, j) => j === ri ? rr.map((cc, k) => k === ci ? e.target.value : cc) : rr) }) })),
          onDragStart: (e: any) => { e.dataTransfer.effectAllowed = 'move'; this.setState({ dragIdx: ri }) },
          onDragOver: (e: any) => { e.preventDefault(); if (s.overIdx !== ri) this.setState({ overIdx: ri }) },
          onDrop: (e: any) => { e.preventDefault(); this.presuMoveRow(this.state.dragIdx, ri) },
          onDragEnd: () => this.setState({ dragIdx: null, overIdx: null }),
          onInsert: () => this.presuInsertRow(ri + 1, 'item'),
          onDel: () => upPresu({ rows: pr.rows.filter((_rr, j) => j !== ri), lv: this.presuLvArr().filter((_q, j) => j !== ri) }),
        }
      }),
      dragActive: s.dragIdx !== null,
      outBd: s.overOut ? '#D6197E' : '#E7C6D8', outBg: s.overOut ? 'rgba(214,25,126,0.12)' : 'rgba(214,25,126,0.04)',
      outDragOver: (e: any) => { e.preventDefault(); if (!s.overOut) this.setState({ overOut: true, overIdx: null }) },
      outDragLeave: () => this.setState({ overOut: false }),
      outDrop: (e: any) => { e.preventDefault(); this.presuSetLv(this.state.dragIdx, 0) },
      endDropLine: (s.overIdx === pr.rows.length && s.dragIdx !== null) ? '2px solid #D6197E' : '2px solid transparent',
      endDragOver: (e: any) => { e.preventDefault(); if (s.overIdx !== pr.rows.length) this.setState({ overIdx: pr.rows.length }) },
      endDrop: (e: any) => { e.preventDefault(); this.presuMoveRow(this.state.dragIdx, pr.rows.length) },
      addCapitulo: () => this.presuInsertRow(undefined, 'cap'),
      addFila: () => this.presuInsertRow(undefined, 'item'),
      addSubtotal: () => this.presuInsertRow(undefined, 'sub'),
      presuPageCols, presuTotal, hasTotal,
      condiciones: pr.condiciones, onCondiciones: (e: any) => upPresu({ condiciones: e.target.value }),
      onPresuFile: this.onPresuFile,
      paste: s.paste, onPaste: (e: any) => this.up({ paste: e.target.value }), crearDesdePaste: this.crearDesdePaste,
      adaptarIA: this.adaptarIA, iaLabel: s.presuIA ? 'Adaptando…' : 'Adaptar con IA',
      pdfBusy: s.pdfBusy, pdfIdle: !s.pdfBusy,
      presuPrompt: s.presuPrompt, onPresuPrompt: (e: any) => this.setState({ presuPrompt: e.target.value }),
      pedirPresu: this.pedirPresu, presuEditBusy: s.presuEdit, presuEditIdle: !s.presuEdit,
      tipoOptions, imgOptions, slideRows, addSlide,
      libOptions: this.libList().map((l) => ({ v: l.id, label: l.name + ' · ' + (TIPO_LABELS[l.tipo] || l.tipo) })),
      libHay: this.libList().length > 0, libSel: s.libSel || '',
      onLibSel: (e: any) => this.setState({ libSel: e.target.value }),
      libInsertar: () => this.libInsert(this.state.libSel || ''),
      libBorrar: () => { if (this.state.libSel) this.libDel(this.state.libSel) },
      iaPrompt: s.iaPrompt, onIaPrompt: (e: any) => this.setState({ iaPrompt: e.target.value }),
      onAdjAdd: this.adjAdd,
      iaAdjChips: s.iaAdj.map((a) => ({ name: (a.kind === 'img' ? '🖼 ' : '📄 ') + a.name, onDel: () => this.setState({ iaAdj: this.state.iaAdj.filter((x) => x.id !== a.id) }) })),
      hasAdj: s.iaAdj.length > 0,
      micGlobal: () => this.dictar('global'), micGlobalBg: s.micOn === 'global' ? '#D6197E' : 'transparent', micGlobalFg: s.micOn === 'global' ? '#FFFFFF' : '#B0447E',
      micPresu: () => this.dictar('presu'), micPresuBg: s.micOn === 'presu' ? '#D6197E' : 'transparent', micPresuFg: s.micOn === 'presu' ? '#FFFFFF' : '#B0447E',
      pedirCambiosGlobal: () => this.pedirCambios(null), iaEditing: s.iaBusyId === 'global', iaNotEditing: s.iaBusyId !== 'global', iaError: s.iaError,
      slidePages, fechaLarga,
      grid: s.vista === 'grid',
      goDoc: () => this.setState({ vista: 'doc' }),
      goGrid: () => this.setState({ vista: 'grid' }),
      zoom: s.zoom, onZoom: (e: any) => this.up({ zoom: +e.target.value }), zoomPct: Math.round(s.zoom * 100) + '%',
      onUndo: this.undo, onRedo: this.redo,
      saveLabel: s.saving ? 'Guardando…' : 'Guardado ✓', saveCol: s.saving ? '#B07A1F' : '#1F8A5B',
      noticeUndo: !!s.noticeUndo, noticeUndoDo: () => { this.setState({ notice: '', noticeUndo: false }); this.undo() },
      clearNotice: () => this.setState({ notice: '', noticeUndo: false }),
      ctxOn: !!s.ctxMenu,
      ctxX: (s.ctxMenu ? Math.min(s.ctxMenu.x, (window.innerWidth || 1200) - 210) : 0) + 'px',
      ctxY: (s.ctxMenu ? Math.min(s.ctxMenu.y, (window.innerHeight || 800) - 230) : 0) + 'px',
      ctxClose: () => this.setState({ ctxMenu: null }),
      ctxDup: () => this.ctxDo('dup'), ctxLib: () => this.ctxDo('lib'), ctxUp: () => this.ctxDo('up'), ctxDown: () => this.ctxDo('down'), ctxDel: () => this.ctxDo('del'),
      tipDibujo: !!s.dTool && !localStorage.getItem('ready-tip-dibujo'),
      tipDibujoOk: () => { try { localStorage.setItem('ready-tip-dibujo', '1') } catch (e) {} this.forceUpdate() },
      edKey1: (e: any) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur() } else if (e.key === 'Escape') e.target.blur() },
      edKeyN: (e: any) => { if (e.key === 'Escape') e.target.blur() },
      undoCol: this._undo.length ? '#17161A' : '#C9C5BC', redoCol: this._redo.length ? '#17161A' : '#C9C5BC',
      exportPdf: this.exportPdfFile,
      pdfExporting: s.pdfExporting || '',
      compartir: this.compartir,
      imgToolbar: (() => { if (!s.imgSel) return false; const sl = s.slides.find((x) => x.id === s.imgSel!.sid); return !!(sl && (sl.imgs || [])[s.imgSel!.k]) })(),
      imgScale: s.imgSel ? this.getTr(s.imgSel.sid, s.imgSel.k).s : 1,
      onImgScale: (e: any) => { if (s.imgSel) this.setTr(s.imgSel.sid, s.imgSel.k, { s: +e.target.value }, true) },
      imgPick: s.imgSel ? ((s.slides.find((x) => x.id === s.imgSel!.sid) || ({} as any)).imgs || [])[s.imgSel.k] || '' : '',
      onImgPick: (e: any) => {
        if (!s.imgSel) return
        const sl = this.state.slides.find((x) => x.id === s.imgSel!.sid)
        if (!sl) return
        const imgs = [...(sl.imgs || [])]
        while (imgs.length <= s.imgSel.k) imgs.push('')
        imgs[s.imgSel.k] = e.target.value
        this.updSlide(sl.id, { imgs, tr: { ...(sl.tr || {}), [s.imgSel.k]: { s: 1, ox: 50, oy: 50 } } })
      },
      imgMask: s.imgSel ? this.getTr(s.imgSel.sid, s.imgSel.k).mask : 'none',
      onImgMask: (e: any) => { if (s.imgSel) this.setTr(s.imgSel.sid, s.imgSel.k, { mask: e.target.value }, true) },
      imgFx: s.imgSel ? this.getTr(s.imgSel.sid, s.imgSel.k).fx : 'none',
      onImgFx: (e: any) => { if (s.imgSel) this.setTr(s.imgSel.sid, s.imgSel.k, { fx: e.target.value }, true) },
      maskOptions: [
        { v: 'none', label: 'Máscara: ninguna' }, { v: 'fade-r', label: 'Fusión a la derecha' }, { v: 'fade-l', label: 'Fusión a la izquierda' },
        { v: 'fade-t', label: 'Fusión arriba' }, { v: 'fade-b', label: 'Fusión abajo' }, { v: 'fade-edges', label: 'Fusión en los bordes' },
      ],
      fxOptions: [
        { v: 'none', label: 'Efecto: ninguno' }, { v: 'bn', label: 'Blanco y negro' }, { v: 'bn-contraste', label: 'B/N contraste' },
        { v: 'calido', label: 'Cálido' }, { v: 'suave', label: 'Suave' }, { v: 'oscuro', label: 'Oscurecer' },
      ],
      imgReset: () => { if (s.imgSel) this.setTr(s.imgSel.sid, s.imgSel.k, { ...this.TR0 }, true) },
      imgClose: () => this.setState({ imgSel: null }),
      deselectImg: () => { if (s.imgSel) this.setState({ imgSel: null }) },
    }
  }

  render() {
    const v = this.renderVals()
    return R('div', { style: { minHeight: '100vh' } },
      R('style', { dangerouslySetInnerHTML: { __html: GLOBAL_CSS } }),
      v.isBrief ? this.renderBrief(v) : null,
      v.isDoc ? this.renderDoc(v) : null,
    )
  }

  // ---- editable text helper (contentEditable directly on the lámina) ----
  edDiv(k: string, onBlur: any, onKey: any, style: any, text: any) {
    return R('div', { key: k, className: 'venta-ed', contentEditable: true, suppressContentEditableWarning: true, spellCheck: false, onBlur, onKeyDown: onKey, title: 'Clic para editar el texto directamente', style }, text || '')
  }

  renderBrief(v: any) {
    const spark = <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ flex: 'none' }}><path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2z" /></svg>
    const monoLabel: React.CSSProperties = { fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8A867F' }
    const sectionHead: React.CSSProperties = { fontFamily: MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#D6197E', fontWeight: 600 }
    const card: React.CSSProperties = { background: '#FFFFFF', border: '1px solid #E0DED8', borderRadius: 14, padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }
    return (
      <div style={{ flex: 1, overflowY: 'auto', background: '#E8E6E1', padding: '44px 24px', display: 'flex', justifyContent: 'center', color: '#17161A', fontFamily: SANS }}>
        <div style={{ width: '100%', maxWidth: 880, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <img src="/assets/logo.png" alt="Ready Eventos" style={{ width: 52, height: 'auto' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em' }}>Documento de venta</div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: '#8A867F', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Brief → la IA compone la presentación → tú la editas</div>
            </div>
            <Link to="/" style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #D8D5CE', color: '#6E6B66', fontSize: 12, fontWeight: 600, textDecoration: 'none', background: '#F7F6F3' }}>← Proyectos</Link>
            <Link to={'/planos/' + this.props.projectId} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #D8D5CE', color: '#6E6B66', fontSize: 12, fontWeight: 600, textDecoration: 'none', background: '#F7F6F3' }}>Memoria y planos</Link>
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center', background: '#FFFFFF', border: '1px solid #E0DED8', borderRadius: 12, padding: '10px 12px' }}>
            <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8A867F', flex: 'none' }}>Proyecto</span>
            <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: '#17161A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.projName}</div>
            <button onClick={v.exportProject} title="Exportar proyecto (.json)" style={{ border: '1px solid #DCD9D2', background: '#fff', borderRadius: 7, padding: '0 10px', height: 28, fontSize: 11, fontWeight: 600, cursor: 'pointer', flex: 'none' }}>Exportar</button>
            <label title="Importar proyecto" style={{ border: '1px solid #DCD9D2', background: '#fff', borderRadius: 7, padding: '0 10px', height: 28, fontSize: 11, fontWeight: 600, cursor: 'pointer', flex: 'none', display: 'flex', alignItems: 'center' }}>
              Importar
              <input type="file" accept=".json" onChange={v.importProject} style={{ display: 'none' }} />
            </label>
          </div>

          {v.hasDoc && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', border: '1px solid #D6197E', borderRadius: 10, background: '#FBF1F6' }}>
              <div style={{ flex: 1, fontSize: 13, color: '#5A3A4C' }}>Ya hay un documento generado. Puedes seguir editándolo o volver a generarlo con los datos de este brief.</div>
              <button onClick={v.verDoc} style={{ border: 'none', background: '#17161A', color: '#fff', borderRadius: 8, padding: '9px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', flex: 'none' }}>Ver documento</button>
            </div>
          )}

          <div style={card}>
            <div style={sectionHead}>1 · Datos del proyecto</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {v.datosCortos.map((dc0: any, i: number) => (
                <label key={i} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span style={monoLabel}>{dc0.label}</span>
                  <input value={dc0.value} onChange={dc0.onChange} placeholder={dc0.ph} style={{ padding: '10px 11px', border: '1px solid #DCD9D2', borderRadius: 7, fontSize: 13, background: '#fff', color: '#17161A', outline: 'none', width: '100%' }} />
                </label>
              ))}
            </div>
            {v.datosLargos.map((dl0: any, i: number) => (
              <label key={i} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={monoLabel}>{dl0.label}</span>
                <textarea value={dl0.value} onChange={dl0.onChange} placeholder={dl0.ph} style={{ minHeight: 72, resize: 'vertical', padding: '10px 11px', border: '1px solid #DCD9D2', borderRadius: 7, fontSize: 12.5, lineHeight: 1.55, background: '#fff', color: '#17161A', outline: 'none', width: '100%' }} />
              </label>
            ))}
          </div>

          <div style={card}>
            <div style={sectionHead}>2 · Imágenes (concepto, 3D, infografías, producto)</div>
            <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: 20, border: '1.5px dashed #C9C5BC', borderRadius: 10, background: '#FAF9F7', cursor: 'pointer', textAlign: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Añadir imágenes</span>
              <span style={{ fontFamily: MONO, fontSize: 9.5, color: '#8A867F' }}>puedes seleccionar varias a la vez</span>
              <input type="file" accept="image/*" multiple onChange={v.onImgs} style={{ display: 'none' }} />
            </label>
            {v.hasImgs && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                {v.galeriaRows.map((gr: any, i: number) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid #E0DED8', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                    <div style={{ position: 'relative', height: 110 }}>
                      {gr.el}
                      <button onClick={gr.onDelete} title={gr.delPend ? 'Confirmar eliminación' : 'Eliminar imagen (pide confirmación)'} style={{ position: 'absolute', top: 6, right: 6, background: gr.delPend ? '#C03A2B' : 'rgba(23,22,26,0.75)', color: '#fff', border: 'none', borderRadius: 5, minWidth: 22, height: 22, fontSize: gr.delPend ? 10 : 13, fontWeight: gr.delPend ? 700 : 400, cursor: 'pointer', lineHeight: 1, padding: gr.delPend ? '0 6px' : 0 }}>{gr.delPend ? '¿Eliminar?' : '×'}</button>
                    </div>
                    <input value={gr.desc} onChange={gr.onDesc} placeholder="¿Qué es? (la IA la colocará según esto)" style={{ margin: '0 8px 8px', padding: '7px 8px', border: '1px solid #DCD9D2', borderRadius: 6, fontSize: 11.5, background: '#fff', outline: 'none' }} />
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 11, color: '#8A867F', lineHeight: 1.5 }}>Describe cada imagen brevemente: la IA elige en qué lámina va cada una según su descripción.</div>
          </div>

          <div style={card}>
            <div style={sectionHead}>3 · Presupuesto (opcional)</div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
              <label style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, padding: 12, border: '1.5px dashed #C9C5BC', borderRadius: 8, background: '#FAF9F7', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, textAlign: 'center' }}>
                {v.pdfBusy && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 12, height: 12, border: '2px solid rgba(214,25,126,0.3)', borderTopColor: '#D6197E', borderRadius: '50%', display: 'inline-block', animation: 'gcspin 0.8s linear infinite' }} /><span>Analizando el PDF con IA…</span></span>
                )}
                {v.pdfIdle && (<><span>Subir Excel o PDF</span><span style={{ fontFamily: MONO, fontSize: 9, color: '#8A867F', fontWeight: 400 }}>.xlsx · .csv · .pdf (la IA lo analiza y lo rediseña)</span></>)}
                <input type="file" accept=".xlsx,.csv,.txt,.pdf" onChange={v.onPresuFile} style={{ display: 'none' }} />
              </label>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <textarea value={v.paste} onChange={v.onPaste} placeholder="…o pega aquí celdas copiadas de Excel" style={{ flex: 1, minHeight: 48, resize: 'vertical', padding: '8px 9px', border: '1px solid #DCD9D2', borderRadius: 7, fontSize: 11, fontFamily: MONO, background: '#fff', outline: 'none' }} />
                <button onClick={v.crearDesdePaste} style={{ border: '1px solid #DCD9D2', background: '#fff', borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Cargar lo pegado</button>
              </div>
            </div>
            {v.presuStatus && <div style={{ fontFamily: MONO, fontSize: 10.5, color: '#17161A', background: '#F2F0EC', borderRadius: 6, padding: '8px 10px' }}>{v.presuStatus}</div>}
            {v.notice && <div style={{ border: '1px solid #E7C6D8', background: '#FBF1F6', borderRadius: 8, padding: '11px 13px', fontSize: 12, color: '#5A3A4C' }}>{v.notice}</div>}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 40 }}>
            <button onClick={v.generarDoc} disabled={v.generating} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, border: 'none', background: '#D6197E', color: '#fff', borderRadius: 12, padding: 17, fontSize: 15, fontWeight: 800, cursor: 'pointer', letterSpacing: '0.01em' }}>
              {v.generating && <><span style={{ width: 14, height: 14, border: '2.5px solid rgba(255,255,255,0.35)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'gcspin 0.8s linear infinite' }} /><span>Componiendo el documento…</span></>}
              {v.notGenerating && <>{spark}<span>Generar documento con IA</span></>}
            </button>
            {v.error && <div style={{ border: '1px solid #E7C6D8', background: '#FBF1F6', borderRadius: 8, padding: '11px 13px', fontSize: 12, color: '#5A3A4C' }}>{v.error}</div>}
            <div style={{ fontSize: 11, color: '#8A867F', textAlign: 'center' }}>La IA estructura las láminas, coloca tus imágenes y reescribe los textos con retórica arquitectónica y neuromarketing. Después podrás editarlo todo.</div>
          </div>
        </div>
      </div>
    )
  }

  renderDoc(v: any) {
    return (
      <div style={{ display: 'flex', flexDirection: 'row', height: '100vh', overflow: 'hidden', background: '#E8E6E1', color: '#17161A', fontFamily: SANS }}>
        {this.renderSidebar(v)}
        {this.renderMain(v)}
      </div>
    )
  }

  renderSidebar(v: any) {
    const spark11 = <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style={{ flex: 'none' }}><path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2z" /></svg>
    const mic = <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v4" /></svg>
    const monoTiny: React.CSSProperties = { fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8A867F' }
    return (
      <aside data-ui="1" style={{ width: 356, flex: 'none', display: 'flex', flexDirection: 'column', background: '#F7F6F3', borderRight: '1px solid #E0DED8' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 18px 12px' }}>
          <img src="/assets/logo.png" alt="Logo" style={{ width: 36, height: 'auto' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em' }}>Documento de venta</div>
            <div style={{ fontFamily: MONO, fontSize: 9, color: '#8A867F', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{v.docSub}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '0 16px 10px', alignItems: 'center' }}>
          <Link to="/" title="Volver al listado de proyectos" style={{ flex: 'none', padding: '6px 10px', border: '1px solid #DCD9D2', borderRadius: 7, fontSize: 11, fontWeight: 600, color: '#6E6B66', textDecoration: 'none', background: '#fff' }}>← Proyectos</Link>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: '#17161A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.projName}>{v.projName}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, padding: '0 16px 12px', flexWrap: 'wrap' }}>
          <button onClick={v.irBrief} style={{ padding: '7px 12px', borderRadius: 999, fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: MONO, border: '1px solid #D8D5CE', background: 'transparent', color: '#6E6B66' }}>← Brief</button>
          {v.tabs.map((tb: any) => (
            <button key={tb.id} onClick={tb.go} style={{ padding: '7px 12px', borderRadius: 999, fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: MONO, border: '1px solid ' + tb.bd, background: tb.bg, color: tb.fg }}>{tb.label}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 18px 34px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {v.isLaminas && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, border: '1px solid #D6197E', borderRadius: 10, background: '#FBF1F6' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#D6197E', fontWeight: 600 }}>{spark11}<span>Cambios en todo el documento</span></div>
                <textarea value={v.iaPrompt} onChange={v.onIaPrompt} placeholder="p. ej. «tono más cercano en todo el documento», «textos más cortos», «añade una lámina sobre sostenibilidad antes del presupuesto»…" style={{ minHeight: 76, resize: 'vertical', padding: '9px 10px', border: '1px solid #E7C6D8', borderRadius: 6, fontSize: 12, lineHeight: 1.5, background: '#fff', color: '#17161A', outline: 'none', width: '100%' }} />
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label title="Adjuntar imágenes o documentos para la IA" style={{ border: '1px solid #E7C6D8', background: '#fff', borderRadius: 6, padding: '5px 9px', fontSize: 10.5, fontWeight: 600, color: '#B0447E', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M21 12.5l-8.5 8.5a6 6 0 0 1-8.5-8.5L12.5 4a4 4 0 0 1 5.7 5.7L9.7 18a2 2 0 0 1-2.8-2.8l7.8-7.8" /></svg>
                    <span>Adjuntar</span>
                    <input type="file" accept="image/*,.pdf,.txt,.md,.csv,.xlsx" multiple onChange={v.onAdjAdd} style={{ display: 'none' }} />
                  </label>
                  <button onClick={v.micGlobal} title="Dictar por voz" style={{ border: '1px solid #E7C6D8', background: v.micGlobalBg, color: v.micGlobalFg, borderRadius: 6, width: 26, height: 26, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{mic}</button>
                  {v.iaAdjChips.map((aj: any, i: number) => (
                    <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fff', border: '1px solid #E7C6D8', borderRadius: 999, padding: '3px 8px', fontSize: 10, color: '#5A3A4C', maxWidth: 160 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{aj.name}</span>
                      <button onClick={aj.onDel} style={{ border: 'none', background: 'none', color: '#B4B0A8', fontSize: 11, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                </div>
                {v.hasAdj && <div style={{ fontSize: 10, color: '#8A867F', lineHeight: 1.4 }}>Los adjuntos se incluyen en la próxima petición a la IA (documento, lámina o presupuesto) y se limpian al aplicarse.</div>}
                <button onClick={v.pedirCambiosGlobal} disabled={v.iaEditing} style={{ border: 'none', background: '#D6197E', color: '#fff', borderRadius: 6, padding: '8px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%' }}>
                  {v.iaEditing && <><span style={{ width: 10, height: 10, border: '2px solid rgba(255,255,255,0.35)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'gcspin 0.8s linear infinite' }} /><span>Aplicando…</span></>}
                  {v.iaNotEditing && <>{spark11}<span>Aplicar</span></>}
                </button>
                {v.iaError && <div style={{ fontSize: 11.5, color: '#5A3A4C', lineHeight: 1.5 }}>{v.iaError}</div>}
              </div>

              {v.slideRows.map((sr: any) => this.renderSlideRow(v, sr))}

              {v.libHay && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select value={v.libSel} onChange={v.onLibSel} title="Láminas guardadas con ★ — disponibles en todos los proyectos" style={{ flex: 1, minWidth: 0, padding: '8px 8px', border: '1px solid #DCD9D2', borderRadius: 6, fontSize: 11.5, background: '#FAF9F7' }}>
                    <option value="">Biblioteca de láminas…</option>
                    {v.libOptions.map((lo: any) => <option key={lo.v} value={lo.v}>{lo.label}</option>)}
                  </select>
                  <button onClick={v.libInsertar} title="Insertar la lámina elegida al final del documento" style={{ border: 'none', background: '#17161A', color: '#fff', borderRadius: 6, padding: '8px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', flex: 'none' }}>Insertar</button>
                  <button onClick={v.libBorrar} title="Eliminar la lámina elegida de la biblioteca" style={{ border: '1px solid #DCD9D2', background: '#fff', color: '#B4B0A8', borderRadius: 6, width: 30, height: 30, fontSize: 14, cursor: 'pointer', flex: 'none' }}>×</button>
                </div>
              )}
              <button onClick={v.addSlide} style={{ border: '1.5px dashed #C9C5BC', background: 'none', borderRadius: 8, padding: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#6E6B66' }}>+ Añadir lámina</button>
              <div style={{ fontSize: 11, color: '#8A867F', lineHeight: 1.5 }}>Para cambiar las imágenes disponibles o regenerar todo el documento, vuelve al brief.</div>
            </div>
          )}

          {v.isPresu && this.renderPresuPanel(v, monoTiny, spark11, mic)}
        </div>
      </aside>
    )
  }

  renderSlideRow(v: any, sr: any) {
    const mic = <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v4" /></svg>
    const spark11 = <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style={{ flex: 'none' }}><path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2z" /></svg>
    const smallBtn: React.CSSProperties = { border: '1px solid #DCD9D2', background: '#fff', borderRadius: 7, width: 30, height: 30, fontSize: 12, cursor: 'pointer', color: '#6E6B66' }
    return (
      <div key={sr.n} draggable onContextMenu={sr.onCtx} onDragStart={sr.onDragStart} onDragOver={sr.onDragOver} onDrop={sr.onDrop} onDragEnd={sr.onDragEnd} style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 12, border: '1px solid #E0DED8', borderTop: sr.dropLine, borderRadius: 10, background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span title="Arrastra para reordenar" style={{ cursor: 'grab', color: '#B4B0A8', fontSize: 12, flex: 'none', userSelect: 'none' }}>⠿</span>
          <span style={{ fontFamily: MONO, fontSize: 10, color: '#8A867F', flex: 'none' }}>{sr.n}</span>
          <select value={sr.tipo} onChange={sr.onTipo} style={{ flex: 1, minWidth: 0, padding: '6px 7px', border: '1px solid #DCD9D2', borderRadius: 6, fontSize: 11.5, background: '#fff' }}>
            {v.tipoOptions.map((to0: any) => <option key={to0.v} value={to0.v}>{to0.label}</option>)}
          </select>
          <button onClick={sr.onUp} title="Subir" style={smallBtn}>↑</button>
          <button onClick={sr.onDown} title="Bajar" style={smallBtn}>↓</button>
          <button onClick={sr.onDup} title="Duplicar lámina" style={{ ...smallBtn, fontSize: 11 }}>⧉</button>
          <button onClick={sr.onLibSave} title="Guardar esta lámina en la biblioteca (reutilizable en todos los proyectos)" style={{ ...smallBtn, color: '#B07A1F' }}>★</button>
          <button onClick={sr.onDelete} title="Eliminar lámina (pide confirmación)" style={{ border: 'none', background: sr.delBg, color: sr.delFg, fontSize: sr.delFs, fontWeight: 700, borderRadius: 6, cursor: 'pointer', padding: sr.delPad }}>{sr.delLabel}</button>
        </div>
        {sr.hasTexts && (
          <>
            <input value={sr.kicker} onChange={sr.onKicker} placeholder="Kicker (p. ej. 01 · CONCEPTO)" style={{ padding: '7px 8px', border: '1px solid #DCD9D2', borderRadius: 6, fontSize: 10.5, fontFamily: MONO, letterSpacing: '0.06em', background: '#fff', width: '100%' }} />
            <input value={sr.titulo} onChange={sr.onTitulo} placeholder="Título" style={{ padding: '8px 9px', border: '1px solid #DCD9D2', borderRadius: 6, fontSize: 12.5, fontWeight: 700, background: '#fff', width: '100%' }} />
            <textarea value={sr.texto} onChange={sr.onTexto} placeholder="Texto" style={{ minHeight: 76, resize: 'vertical', padding: '8px 9px', border: '1px solid #DCD9D2', borderRadius: 6, fontSize: 12, lineHeight: 1.55, background: '#fff', outline: 'none', width: '100%' }} />
            {sr.textHint && <div style={{ fontSize: 10, color: '#8A867F', lineHeight: 1.45 }}>{sr.textHint}</div>}
          </>
        )}
        {sr.hasImgSel && sr.imgSels.map((is0: any, i: number) => (
          <select key={i} value={is0.v} onChange={is0.onChange} style={{ padding: '6px 7px', border: '1px solid #DCD9D2', borderRadius: 6, fontSize: 11.5, background: '#FAF9F7', width: '100%' }}>
            {v.imgOptions.map((io0: any) => <option key={io0.v} value={io0.v}>{io0.label}</option>)}
          </select>
        ))}
        {sr.isSplit && (
          <select value={sr.side} onChange={sr.onSide} style={{ padding: '6px 7px', border: '1px solid #DCD9D2', borderRadius: 6, fontSize: 11.5, background: '#fff', width: '100%' }}>
            <option value="left">Imagen a la izquierda</option>
            <option value="right">Imagen a la derecha</option>
          </select>
        )}
        {sr.isLibre && <div style={{ fontSize: 11, color: '#8A867F', lineHeight: 1.5 }}>Lámina de diseño libre compuesta por la IA — pídele los ajustes en el cuadro de abajo.</div>}
        {sr.isCollage && (
          <>
            <div style={{ fontSize: 11, color: '#8A867F', lineHeight: 1.5 }}>Arrastra imágenes directamente sobre la lámina, o añádelas desde la galería:</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={sr.clPickV} onChange={sr.onClPick} style={{ flex: 1, minWidth: 0, padding: '6px 7px', border: '1px solid #DCD9D2', borderRadius: 6, fontSize: 11.5, background: '#FAF9F7' }}>
                {v.imgOptions.map((ioc: any) => <option key={ioc.v} value={ioc.v}>{ioc.label}</option>)}
              </select>
              <button onClick={sr.onClAdd} style={{ border: 'none', background: '#17161A', color: '#fff', borderRadius: 6, padding: '0 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', flex: 'none' }}>Añadir</button>
            </div>
          </>
        )}
        <div style={{ display: 'flex', gap: 6, alignItems: 'stretch', borderTop: '1px dashed #E7C6D8', paddingTop: 8 }}>
          <textarea value={sr.iaVal} onChange={sr.onIaVal} placeholder="Pedir cambios de esta lámina a la IA…" style={{ flex: 1, minWidth: 0, minHeight: 36, resize: 'vertical', padding: '7px 8px', border: '1px solid #E7C6D8', borderRadius: 6, fontSize: 11.5, lineHeight: 1.45, background: '#FBF1F6', color: '#17161A', outline: 'none' }} />
          <button onClick={sr.onMic} title="Dictar por voz" style={{ border: '1px solid #E7C6D8', background: sr.micBg, color: sr.micFg, borderRadius: 6, width: 26, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{mic}</button>
          <button onClick={sr.onPedirIa} disabled={sr.iaBusy} title="Aplicar cambios con IA a esta lámina" style={{ border: 'none', background: '#D6197E', color: '#fff', borderRadius: 6, padding: '0 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, flex: 'none' }}>
            {sr.iaBusy && <span style={{ width: 10, height: 10, border: '2px solid rgba(255,255,255,0.35)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'gcspin 0.8s linear infinite' }} />}
            {sr.iaIdle && spark11}
          </button>
        </div>
      </div>
    )
  }

  renderPresuPanel(v: any, monoTiny: React.CSSProperties, spark11: any, mic: any) {
    const card: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 9, padding: 12, border: '1px solid #E0DED8', borderRadius: 10, background: '#fff' }
    const fieldLabel: React.CSSProperties = { fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8A867F' }
    const inp: React.CSSProperties = { padding: '7px 8px', border: '1px solid #DCD9D2', borderRadius: 6, fontSize: 12, background: '#fff', width: '100%' }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {v.hasPresu && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, border: '1px solid #E0DED8', borderRadius: 10, background: '#fff', cursor: 'pointer' }}>
            <input type="checkbox" checked={v.presuIncluir} onChange={v.onPresuIncluir} style={{ accentColor: '#D6197E', width: 16, height: 16, cursor: 'pointer', flex: 'none' }} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Incluir el presupuesto en el documento</span>
          </label>
        )}
        {v.hasColToggles && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, border: '1px solid #E0DED8', borderRadius: 10, background: '#fff' }}>
            <div style={monoTiny}>Columnas visibles</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {v.presuColToggles.map((ct: any, i: number) => (
                <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={ct.on} onChange={ct.onToggle} style={{ accentColor: '#D6197E', width: 14, height: 14, cursor: 'pointer' }} />
                  <span>{ct.label}</span>
                </label>
              ))}
            </div>
            <div style={{ fontSize: 10.5, color: '#8A867F', lineHeight: 1.5 }}>Las columnas ocultas desaparecen de las partidas; los subtotales conservan su importe.</div>
          </div>
        )}
        {v.hasPresu && (
          <div style={card}>
            <div style={monoTiny}>Descuento e IVA</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={fieldLabel}>Descuento %</span>
                <input type="number" min={0} max={90} step={0.5} value={v.presuDescPct} onChange={v.onPresuDescPct} style={inp} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={fieldLabel}>IVA %</span>
                <input type="number" min={0} max={40} step={1} value={v.presuIvaPct} onChange={v.onPresuIvaPct} style={inp} />
              </label>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
              <input type="checkbox" checked={v.presuConIva} onChange={v.onPresuConIva} style={{ accentColor: '#D6197E', width: 15, height: 15, cursor: 'pointer' }} />
              <span>Aplicar IVA al total</span>
            </label>
            <div style={{ fontSize: 10.5, color: '#8A867F', lineHeight: 1.5 }}>Base, descuento e IVA se calculan y desglosan automáticamente sobre el total.</div>
          </div>
        )}
        {v.hasPresu && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, border: '1px solid #D6197E', borderRadius: 10, background: '#FBF1F6' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#D6197E', fontWeight: 600 }}>{spark11}<span>Cambios y cálculos con IA</span></div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
              <textarea value={v.presuPrompt} onChange={v.onPresuPrompt} placeholder="p. ej. «calcula la columna importe = uds × precio», «aplica un 10% de descuento a la rotulación», «agrupa las partidas por capítulos», «redondea los importes»…" style={{ flex: 1, minWidth: 0, minHeight: 66, resize: 'vertical', padding: '9px 10px', border: '1px solid #E7C6D8', borderRadius: 6, fontSize: 12, lineHeight: 1.5, background: '#fff', color: '#17161A', outline: 'none' }} />
              <button onClick={v.micPresu} title="Dictar por voz" style={{ border: '1px solid #E7C6D8', background: v.micPresuBg, color: v.micPresuFg, borderRadius: 6, width: 26, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{mic}</button>
            </div>
            <button onClick={v.pedirPresu} disabled={v.presuEditBusy} style={{ border: 'none', background: '#D6197E', color: '#fff', borderRadius: 6, padding: '8px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%' }}>
              {v.presuEditBusy && <><span style={{ width: 10, height: 10, border: '2px solid rgba(255,255,255,0.35)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'gcspin 0.8s linear infinite' }} /><span>Aplicando…</span></>}
              {v.presuEditIdle && <>{spark11}<span>Aplicar</span></>}
            </button>
          </div>
        )}
        {v.hasPresu && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, border: '1px solid #E0DED8', borderRadius: 10, background: '#fff' }}>
            <input value={v.presuTitulo} onChange={v.onPresuTitulo} style={{ padding: '8px 9px', border: '1px solid #DCD9D2', borderRadius: 6, fontSize: 12.5, fontWeight: 700, background: '#fff', width: '100%' }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={fieldLabel}>Nº presupuesto</span>
                <input value={v.presuNum} onChange={v.onPresuNum} placeholder="P-2026-001" style={{ ...inp, fontFamily: MONO }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={fieldLabel}>Fecha</span>
                <input type="date" value={v.presuFecha} onChange={v.onPresuFecha} style={inp} />
              </label>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={fieldLabel}>Datos del emisor</span>
              <textarea value={v.presuEmisor} onChange={v.onPresuEmisor} style={{ minHeight: 66, resize: 'vertical', padding: '7px 8px', border: '1px solid #DCD9D2', borderRadius: 6, fontSize: 11.5, lineHeight: 1.5, background: '#fff', outline: 'none', width: '100%' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={fieldLabel}>Datos del cliente (receptor)</span>
              <textarea value={v.presuReceptor} onChange={v.onPresuReceptor} placeholder={'Razón social\nCIF\nDirección\nContacto'} style={{ minHeight: 66, resize: 'vertical', padding: '7px 8px', border: '1px solid #DCD9D2', borderRadius: 6, fontSize: 11.5, lineHeight: 1.5, background: '#fff', outline: 'none', width: '100%' }} />
            </label>
            <button onClick={v.abrirModalPresu} style={{ border: '1px solid #17161A', background: '#17161A', color: '#fff', borderRadius: 8, padding: '11px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%' }}>
              <span>Editar partidas y líneas</span>
              <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 400, color: '#C9C5CE' }}>{v.presuResumen}</span>
            </button>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={v.adaptarIA} style={{ border: 'none', background: '#17161A', color: '#fff', borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>{spark11}<span>{v.iaLabel}</span></button>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ ...fieldLabel, fontSize: 9.5 }}>Condiciones</span>
              <textarea value={v.condiciones} onChange={v.onCondiciones} style={{ minHeight: 56, resize: 'vertical', padding: '8px 9px', border: '1px solid #DCD9D2', borderRadius: 6, fontSize: 11.5, lineHeight: 1.5, background: '#fff', outline: 'none', width: '100%' }} />
            </label>
          </div>
        )}
        {v.noPresu && <div style={{ fontSize: 12, color: '#6E6B66', lineHeight: 1.6 }}>No hay presupuesto cargado. Vuelve al brief para subir el Excel o PDF, y añade después una lámina de tipo «Presupuesto».</div>}
      </div>
    )
  }

  renderMain(v: any) {
    const iconBtn: React.CSSProperties = { border: '1px solid #DCD9D2', background: '#fff', borderRadius: 7, width: 30, height: 30, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }
    return (
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div data-ui="1" style={{ minHeight: 58, flex: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', padding: '8px 60px 8px 22px', background: '#F7F6F3', borderBottom: '1px solid #E0DED8' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 'none' }}>
            <Link to="/" style={{ fontFamily: MONO, fontSize: 10, color: '#8A867F', textDecoration: 'none' }}>Proyectos</Link>
            <span style={{ color: '#C9C5BC', fontSize: 11 }}>›</span>
            <span title={v.projName} style={{ fontSize: 11.5, fontWeight: 700, color: '#17161A', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.projName}</span>
            <span style={{ color: '#C9C5BC', fontSize: 11 }}>›</span>
          </div>
          <div style={{ display: 'flex', gap: 2, background: '#ECEAE5', borderRadius: 8, padding: 3 }}>
            <span style={{ padding: '6px 12px', borderRadius: 6, background: '#17161A', color: '#fff', fontSize: 11, fontWeight: 700 }}>Documento de venta</span>
            <Link to={'/planos/' + this.props.projectId} style={{ padding: '6px 12px', borderRadius: 6, color: '#6E6B66', fontSize: 11, fontWeight: 600, textDecoration: 'none' }}>Memoria y planos</Link>
          </div>
          <div style={{ flex: 1 }} />
          <span style={{ fontFamily: MONO, fontSize: 9.5, color: v.saveCol, flex: 'none' }}>{v.saveLabel}</span>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button onClick={v.onUndo} title="Deshacer (Ctrl+Z)" style={{ ...iconBtn, color: v.undoCol }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg></button>
            <button onClick={v.onRedo} title="Rehacer (Ctrl+Y)" style={{ ...iconBtn, color: v.redoCol }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg></button>
            <button onClick={() => this.setState({ modalVers: true })} title="Versiones del documento (guardar y restaurar)" style={{ ...iconBtn, color: '#55524D' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 3" /></svg></button>
          </div>
          <div style={{ display: 'flex', gap: 2, background: '#ECEAE5', borderRadius: 8, padding: 3, flex: 'none' }}>
            <button onClick={v.goDoc} title="Vista de documento" style={{ border: 'none', borderRadius: 6, padding: '6px 11px', fontSize: 11, fontWeight: 700, cursor: 'pointer', background: v.grid ? 'transparent' : '#17161A', color: v.grid ? '#6E6B66' : '#fff' }}>Documento</button>
            <button onClick={v.goGrid} title="Vista de cuadrícula — arrastra para reordenar las láminas" style={{ border: 'none', borderRadius: 6, padding: '6px 11px', fontSize: 11, fontWeight: 700, cursor: 'pointer', background: v.grid ? '#17161A' : 'transparent', color: v.grid ? '#fff' : '#6E6B66' }}>Cuadrícula</button>
          </div>
          {!v.grid && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: MONO, fontSize: 9.5, color: '#8A867F' }}>ZOOM</span>
              <input type="range" min={0.25} max={1.4} step={0.05} value={v.zoom} onChange={v.onZoom} style={{ width: 110, accentColor: '#17161A' }} />
              <span style={{ fontFamily: MONO, fontSize: 10, color: '#17161A', width: 36 }}>{v.zoomPct}</span>
            </label>
          )}
          <button onClick={v.compartir} title="Enlace de solo lectura para el cliente (PDF, caduca a los 60 días)" style={{ background: '#fff', color: '#17161A', border: '1px solid #DCD9D2', borderRadius: 8, padding: '10px 14px', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>
            Compartir
          </button>
          <button onClick={v.exportPdf} style={{ background: v.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer', minWidth: 118 }}>{v.pdfExporting || 'Exportar PDF'}</button>
        </div>

        {v.hayLaminas && !v.grid && this.renderDrawToolbar(v)}
        {v.hayLaminas && !v.grid && <RevisionBar projectId={this.props.projectId} app="venta" />}

        <div onClick={v.deselectImg} style={{ flex: 1, overflow: 'auto', padding: 36, background: '#E8E6E1' }}>
          <div className="venta-zoomwrap" style={{ width: v.grid ? 'auto' : 'max-content', minWidth: '100%', margin: '0 auto', zoom: v.grid ? 0.16 : v.zoom } as any}>
            <div style={{ display: 'flex', flexDirection: v.grid ? 'row' : 'column', flexWrap: v.grid ? 'wrap' : 'nowrap', gap: v.grid ? 150 : 0, alignItems: v.grid ? 'flex-start' : 'center', justifyContent: 'center' }}>
              {v.slidePages.map((sl: any, i: number) => this.renderSlidePage(v, sl, i))}
              {v.grid && v.slidePages.length > 1 && (
                <div
                  data-ui="1"
                  onDragOver={(e: any) => { e.preventDefault(); if (this.state.gridOver !== '__end__') this.setState({ gridOver: '__end__' }) }}
                  onDragLeave={() => { if (this.state.gridOver === '__end__') this.setState({ gridOver: null }) }}
                  onDrop={(e: any) => { e.preventDefault(); this.gridReorder(null) }}
                  style={{ width: '297mm', height: '210mm', flex: 'none', border: '8px dashed ' + (this.state.gridOver === '__end__' ? '#D6197E' : '#C9C5BC'), borderRadius: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 64, color: this.state.gridOver === '__end__' ? '#D6197E' : '#8A867F', background: this.state.gridOver === '__end__' ? 'rgba(214,25,126,0.06)' : 'transparent' }}
                >
                  Mover al final
                </div>
              )}
            </div>
          </div>
        </div>

        {v.notice && (
          <div data-ui="1" style={{ position: 'fixed', left: 22, bottom: 22, zIndex: 96, background: '#17161A', color: '#fff', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 14px 44px rgba(23,22,26,0.4)', maxWidth: 440 }}>
            <span style={{ fontSize: 12.5, lineHeight: 1.5 }}>{v.notice}</span>
            {v.noticeUndo && <button onClick={v.noticeUndoDo} style={{ border: '1px solid #3A3840', background: '#26252A', color: '#F5A6CF', borderRadius: 7, padding: '6px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', flex: 'none' }}>Deshacer</button>}
            <button onClick={v.clearNotice} style={{ border: 'none', background: 'none', color: '#8A867F', fontSize: 15, cursor: 'pointer', padding: '2px 4px', flex: 'none' }}>×</button>
          </div>
        )}

        {v.ctxOn && (
          <>
            <div data-ui="1" onClick={v.ctxClose} onContextMenu={v.ctxClose} style={{ position: 'fixed', inset: 0, zIndex: 97 }} />
            <div data-ui="1" style={{ position: 'fixed', left: v.ctxX, top: v.ctxY, zIndex: 98, background: '#FFFFFF', border: '1px solid #E0DED8', borderRadius: 10, boxShadow: '0 18px 50px rgba(23,22,26,0.22)', padding: 6, display: 'flex', flexDirection: 'column', minWidth: 190 }}>
              <button className="venta-ctxbtn" onClick={v.ctxDup} style={{ border: 'none', background: 'none', textAlign: 'left', padding: '9px 12px', fontSize: 12.5, color: '#17161A', borderRadius: 7, cursor: 'pointer' }}>⧉&nbsp;&nbsp;Duplicar lámina</button>
              <button className="venta-ctxbtn" onClick={v.ctxLib} style={{ border: 'none', background: 'none', textAlign: 'left', padding: '9px 12px', fontSize: 12.5, color: '#17161A', borderRadius: 7, cursor: 'pointer' }}>★&nbsp;&nbsp;Guardar en biblioteca</button>
              <button className="venta-ctxbtn" onClick={v.ctxUp} style={{ border: 'none', background: 'none', textAlign: 'left', padding: '9px 12px', fontSize: 12.5, color: '#17161A', borderRadius: 7, cursor: 'pointer' }}>↑&nbsp;&nbsp;Mover antes</button>
              <button className="venta-ctxbtn" onClick={v.ctxDown} style={{ border: 'none', background: 'none', textAlign: 'left', padding: '9px 12px', fontSize: 12.5, color: '#17161A', borderRadius: 7, cursor: 'pointer' }}>↓&nbsp;&nbsp;Mover después</button>
              <div style={{ height: 1, background: '#EDEBE6', margin: '4px 8px' }} />
              <button className="venta-ctxbtn-del" onClick={v.ctxDel} style={{ border: 'none', background: 'none', textAlign: 'left', padding: '9px 12px', fontSize: 12.5, color: '#C03A2B', borderRadius: 7, cursor: 'pointer' }}>×&nbsp;&nbsp;Eliminar (con Deshacer)</button>
            </div>
          </>
        )}

        {v.modalPresu && this.renderPresuModal(v)}
        {v.imgToolbar && this.renderImgToolbar(v)}
        {this.state.modalShare && this.renderShareModal()}
        {this.state.modalVers && (
          <VersionesModal
            app="venta"
            projectId={this.props.projectId}
            getPayload={() => this.buildPayload(false)}
            onClose={() => this.setState({ modalVers: false })}
          />
        )}
      </main>
    )
  }

  renderShareModal() {
    const s = this.state
    const cerrar = () => this.setState({ modalShare: false })
    return (
      <div data-ui="1" onClick={cerrar} style={{ position: 'fixed', inset: 0, zIndex: 95, background: 'rgba(23,22,26,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 26, width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 24px 70px rgba(23,22,26,0.35)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 800, flex: 1 }}>Compartir con el cliente</div>
            <button onClick={cerrar} style={{ border: 'none', background: 'none', fontSize: 18, color: '#8A867F', cursor: 'pointer' }}>×</button>
          </div>
          {s.shareBusy && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#6E6B66', fontSize: 12.5 }}>
              <span style={{ width: 15, height: 15, border: '3px solid rgba(214,25,126,0.25)', borderTopColor: '#D6197E', borderRadius: '50%', display: 'inline-block', animation: 'gcspin 0.8s linear infinite' }} />
              Generando el PDF y creando el enlace… {s.pdfExporting}
            </div>
          )}
          {!s.shareBusy && s.shareUrl && (
            <>
              <div style={{ fontSize: 12.5, color: '#1F8A5B', fontWeight: 700 }}>
                ✓ Enlace creado{s.shareCopied ? ' y copiado al portapapeles' : ''} — caduca en 60 días
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input readOnly value={s.shareUrl} onFocus={(e) => e.target.select()} style={{ flex: 1, minWidth: 0, padding: '9px 11px', border: '1px solid #DCD9D2', borderRadius: 8, fontSize: 11, fontFamily: MONO, background: '#FDFDFC' }} />
                <button onClick={() => { navigator.clipboard?.writeText(s.shareUrl!).then(() => this.setState({ shareCopied: true })) }} style={{ border: 'none', background: '#17161A', color: '#fff', borderRadius: 8, padding: '9px 13px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', flex: 'none' }}>
                  {s.shareCopied ? 'Copiado ✓' : 'Copiar'}
                </button>
              </div>
              <div style={{ fontSize: 11.5, color: '#8A867F', lineHeight: 1.6 }}>
                Cualquiera con el enlace ve el documento en PDF, sin poder editarlo. El PDF es una foto de este momento: si cambias el documento, genera un enlace nuevo.
              </div>
            </>
          )}
          {(s.shareList || []).length > 0 && (
            <div style={{ borderTop: '1px solid #ECEAE5', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
              <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8A867F' }}>Enlaces activos de este proyecto</div>
              {(s.shareList || []).map((sh) => (
                <div key={sh.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <a href={sh.url} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 0, fontSize: 11, color: '#B0447E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sh.name}</a>
                  <button onClick={() => this.revocarShare(sh.name)} title="Revocar: el enlace dejará de funcionar" style={{ border: '1px solid #DCD9D2', background: '#fff', borderRadius: 6, padding: '4px 9px', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', color: '#C03A2B', flex: 'none' }}>Revocar</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  renderDrawToolbar(v: any) {
    const eyeSvg = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m2 22 1-1h3l9-9" /><path d="M3 21v-3l9-9" /><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" /></svg>
    const sw24: React.CSSProperties = { border: '1px solid #DCD9D2', background: '#fff', borderRadius: 6, width: 24, height: 24, cursor: 'pointer', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, color: '#55524D' }
    const star: React.CSSProperties = { border: '1px solid #DCD9D2', background: '#fff', color: '#B07A1F', borderRadius: 6, width: 24, height: 24, fontSize: 12, cursor: 'pointer', flex: 'none', lineHeight: 1 }
    return (
      <>
        <div data-ui="1" style={{ minHeight: 42, flex: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, padding: '6px 22px', background: '#FBFAF9', borderBottom: '1px solid #E0DED8' }}>
          <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8A867F', marginRight: 6 }}>Dibujo</span>
          {v.gTools.map((gt: any, i: number) => (
            <button key={i} onClick={gt.onClick} title={gt.title} style={{ display: 'flex', alignItems: 'center', gap: 5, border: '1px solid ' + gt.bd, background: gt.bg, color: gt.fg, borderRadius: 6, padding: '5px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>{gt.icon}<span>{gt.label}</span></button>
          ))}
          {v.gStyleOn && (
            <>
              <span style={{ width: 1, height: 22, background: '#E0DED8', margin: '0 6px', flex: 'none' }} />
              <input type="color" value={v.sColHex} onChange={v.sOnColHex} title="Color del trazo/texto (RGB/HEX)" style={{ width: 30, height: 24, border: '1px solid #DCD9D2', borderRadius: 6, background: '#fff', padding: 1, cursor: 'pointer', flex: 'none' }} />
              <button onClick={v.sColEye} title="Cuentagotas" style={sw24}>{eyeSvg}</button>
              {v.sFavs.map((sf: any, i: number) => <button key={i} onClick={sf.onPick} onDoubleClick={sf.onDrop} title="Color favorito — clic: aplicar · doble clic: quitar" style={{ width: 17, height: 17, borderRadius: '50%', border: '2px solid ' + sf.bd, background: sf.c, cursor: 'pointer', padding: 0, flex: 'none' }} />)}
              <button onClick={v.sFavAdd} title="Guardar el color actual como favorito" style={star}>★</button>
              {v.gStrokeOn && (
                <>
                  <select value={v.gW} onChange={v.gOnW} title="Grosor de línea (mm)" style={{ padding: '4px 6px', border: '1px solid #DCD9D2', borderRadius: 6, fontSize: 10.5, background: '#fff', marginLeft: 4 }}>
                    <option value="0.3">Fina</option><option value="0.6">Media</option><option value="1">Gruesa</option><option value="1.8">Muy gruesa</option>
                  </select>
                  <select value={v.gDash} onChange={v.gOnDash} title="Tipo de línea" style={{ padding: '4px 6px', border: '1px solid #DCD9D2', borderRadius: 6, fontSize: 10.5, background: '#fff' }}>
                    <option value="solid">Continua ———</option><option value="dash">Discontinua – – –</option><option value="dot">Punteada · · · ·</option>
                  </select>
                </>
              )}
              {v.gFillOn && (
                <>
                  <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#B4B0A8', marginLeft: 4 }}>Relleno</span>
                  <button onClick={v.gFillNone} title="Sin relleno" style={{ ...sw24, background: v.gNoneBg, color: v.gNoneFg, fontSize: 11, lineHeight: 1 }}>∅</button>
                  <input type="color" value={v.gFillHex} onChange={v.gOnFillHex} title="Relleno" style={{ width: 30, height: 24, border: '1px solid #DCD9D2', borderRadius: 6, background: '#fff', padding: 1, cursor: 'pointer', flex: 'none' }} />
                  <button onClick={v.gFillEye} title="Cuentagotas" style={sw24}>{eyeSvg}</button>
                  {v.favColors.map((fv: any, i: number) => <button key={i} onClick={fv.onPick} onDoubleClick={fv.onDrop} title="Color favorito" style={{ width: 17, height: 17, borderRadius: 5, border: '2px solid ' + fv.bd, background: fv.c, cursor: 'pointer', padding: 0, flex: 'none' }} />)}
                  <button onClick={v.favAdd} title="Guardar el color actual como favorito" style={star}>★</button>
                  <button onClick={v.gOnBorder} title="Borde de la figura" style={{ border: '1px solid #DCD9D2', background: v.gBorderBg, color: v.gBorderFg, borderRadius: 6, padding: '4px 9px', fontSize: 10.5, fontWeight: 600, cursor: 'pointer', flex: 'none' }}>Borde</button>
                </>
              )}
              {v.gTextOn && (
                <>
                  <button onClick={v.gOnBold} title="Negrita" style={{ ...sw24, background: v.gBoldBg, color: v.gBoldFg, fontSize: 11, fontWeight: 800 }}>B</button>
                  <select value={v.gAlign} onChange={v.gOnAlign} title="Alineación" style={{ padding: '4px 6px', border: '1px solid #DCD9D2', borderRadius: 6, fontSize: 10.5, background: '#fff' }}>
                    <option value="left">Izquierda</option><option value="center">Centrado</option><option value="right">Derecha</option>
                  </select>
                  <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#B4B0A8', marginLeft: 4 }}>Fondo</span>
                  <button onClick={v.gFillNone} title="Sin relleno de fondo" style={{ ...sw24, background: v.gNoneBg, color: v.gNoneFg, fontSize: 11, lineHeight: 1 }}>∅</button>
                  <input type="color" value={v.gFillHex} onChange={v.gOnFillHex} title="Fondo del cuadro de texto" style={{ width: 30, height: 24, border: '1px solid #DCD9D2', borderRadius: 6, background: '#fff', padding: 1, cursor: 'pointer', flex: 'none' }} />
                  <button onClick={v.gFillEye} title="Cuentagotas" style={sw24}>{eyeSvg}</button>
                  {v.favColors.map((fv2: any, i: number) => <button key={i} onClick={fv2.onPick} onDoubleClick={fv2.onDrop} title="Color favorito" style={{ width: 17, height: 17, borderRadius: 5, border: '2px solid ' + fv2.bd, background: fv2.c, cursor: 'pointer', padding: 0, flex: 'none' }} />)}
                  <button onClick={v.favAdd} title="Guardar el color actual como favorito" style={star}>★</button>
                  <button onClick={v.gOnTBorder} title="Borde del cuadro de texto" style={{ border: '1px solid #DCD9D2', background: v.gTBorderBg, color: v.gTBorderFg, borderRadius: 6, padding: '4px 9px', fontSize: 10.5, fontWeight: 600, cursor: 'pointer', flex: 'none' }}>Borde</button>
                </>
              )}
            </>
          )}
          {v.gSelText && (
            <>
              <input value={v.gText} onChange={v.gOnText} placeholder="Texto (\n = salto de línea)" style={{ width: 220, padding: '6px 9px', border: '1px solid #DCD9D2', borderRadius: 6, fontSize: 11.5, background: '#fff', color: '#17161A', outline: 'none', marginLeft: 8 }} />
              <select value={v.gFs} onChange={v.gOnFs} title="Tamaño del texto" style={{ padding: '5px 7px', border: '1px solid #DCD9D2', borderRadius: 6, fontSize: 10.5, background: '#fff' }}>
                <option value="4">4 mm</option><option value="6">6 mm</option><option value="9">9 mm</option><option value="14">14 mm</option>
              </select>
            </>
          )}
          {v.gSelOn && <button onClick={v.gDel} title="Eliminar la forma seleccionada (Supr)" style={{ border: '1px solid #DCD9D2', background: '#fff', color: '#C03A2B', borderRadius: 6, padding: '5px 11px', fontSize: 11, fontWeight: 600, cursor: 'pointer', marginLeft: 4 }}>Eliminar</button>}
          <span style={{ flex: 1, minWidth: 0 }} />
          <span style={{ fontFamily: MONO, fontSize: 9.5, color: '#B4B0A8', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.gHint}</span>
        </div>
        {v.tipDibujo && (
          <div data-ui="1" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 22px', background: '#FBF1F6', borderBottom: '1px solid #E7C6D8' }}>
            <span style={{ fontSize: 12, color: '#5A3A4C', lineHeight: 1.5 }}>💡 Primera vez con el dibujo: elige una herramienta y <strong>arrastra directamente sobre cualquier lámina</strong>. Clic en una forma la selecciona (arrastra para mover, Supr la borra) y con Esc sales de la herramienta.</span>
            <button onClick={v.tipDibujoOk} style={{ border: 'none', background: '#D6197E', color: '#fff', borderRadius: 6, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', flex: 'none' }}>Entendido</button>
          </div>
        )}
      </>
    )
  }

  renderImgToolbar(v: any) {
    const sel: React.CSSProperties = { maxWidth: 150, padding: '6px 8px', border: '1px solid #3A3840', borderRadius: 6, fontSize: 11, background: '#26252A', color: '#fff' }
    return (
      <div data-ui="1" style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: '#17161A', color: '#fff', borderRadius: 12, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 14, zIndex: 60, boxShadow: '0 14px 34px rgba(0,0,0,0.35)' }}>
        <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.06em', color: '#C9C5CE', whiteSpace: 'nowrap' }}>IMAGEN · arrastra para recolocar · rueda para escalar</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontFamily: MONO, fontSize: 9, color: '#8A867F' }}>ESCALA</span>
          <input type="range" min={1} max={4} step={0.02} value={v.imgScale} onChange={v.onImgScale} style={{ width: 110, accentColor: '#D6197E' }} />
        </label>
        <select value={v.imgMask} onChange={v.onImgMask} style={sel}>{v.maskOptions.map((mko: any) => <option key={mko.v} value={mko.v}>{mko.label}</option>)}</select>
        <select value={v.imgFx} onChange={v.onImgFx} style={{ ...sel, maxWidth: 130 }}>{v.fxOptions.map((fxo: any) => <option key={fxo.v} value={fxo.v}>{fxo.label}</option>)}</select>
        <select value={v.imgPick} onChange={v.onImgPick} style={sel}>{v.imgOptions.map((ipo: any) => <option key={ipo.v} value={ipo.v}>{ipo.label}</option>)}</select>
        <button onClick={v.imgReset} style={{ border: '1px solid #3A3840', background: 'none', color: '#C9C5CE', borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Restablecer</button>
        <button onClick={v.imgClose} style={{ border: 'none', background: 'none', color: '#8A867F', fontSize: 16, cursor: 'pointer', padding: '0 2px' }}>×</button>
      </div>
    )
  }

  renderPresuModal(v: any) {
    const colInp: React.CSSProperties = { flex: 1, minWidth: 0, padding: '7px 8px', border: '1px solid #DCD9D2', borderRadius: 6, fontSize: 10, fontFamily: MONO, textTransform: 'uppercase', letterSpacing: '0.05em', background: '#FFFFFF', color: '#6E6B66', fontWeight: 600 }
    return (
      <div data-ui="1" onClick={v.cerrarModalPresu} style={{ position: 'fixed', inset: 0, background: 'rgba(23,22,26,0.55)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 30 }}>
        <div onClick={v.trapClick} style={{ background: '#F7F6F3', borderRadius: 16, width: '100%', maxWidth: 940, maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,0.4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '1px solid #E0DED8', background: '#fff' }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Partidas y líneas del presupuesto</div>
            <div style={{ fontFamily: MONO, fontSize: 9.5, color: '#8A867F' }}>{v.presuResumen} · arrastra las filas para reordenarlas o reagruparlas</div>
            <div style={{ flex: 1 }} />
            <button onClick={v.cerrarModalPresu} style={{ border: 'none', background: '#17161A', color: '#fff', borderRadius: 8, padding: '9px 16px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Hecho</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 16px 12px' }}>
            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 36 }}>
              {v.dragActive && (
                <div onDragOver={v.outDragOver} onDragLeave={v.outDragLeave} onDrop={v.outDrop} title="Suelta aquí para sacar la línea del capítulo" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 30, zIndex: 6, border: '2px dashed ' + v.outBd, borderRadius: 8, background: v.outBg, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontFamily: MONO, fontSize: 8.5, letterSpacing: '0.14em', color: '#B0447E', whiteSpace: 'nowrap', pointerEvents: 'none' }}>← SACAR DE CAPÍTULO</span>
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '0 0 6px' }}>
                <span style={{ width: 26, flex: 'none' }} />
                {v.presuCols.map((pc: any, i: number) => <input key={i} value={pc.value} onChange={pc.onChange} style={colInp} />)}
                <span style={{ width: 56, flex: 'none' }} />
              </div>
              {v.rowsEdit.map((re0: any, ri: number) => (
                <div key={ri} draggable onDragStart={re0.onDragStart} onDragOver={re0.onDragOver} onDrop={re0.onDrop} onDragEnd={re0.onDragEnd} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px 4px', marginLeft: re0.ml, borderRadius: 8, background: re0.bg, border: '1px solid ' + re0.bd, borderTop: re0.dropLine }}>
                  <span title="Arrastra para mover" style={{ width: 20, flex: 'none', cursor: 'grab', color: '#B4B0A8', fontSize: 13, textAlign: 'center', userSelect: 'none', letterSpacing: '-1px' }}>⠿</span>
                  {re0.tag && <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: '0.08em', color: re0.tagFg, background: re0.tagBg, borderRadius: 4, padding: '2.5px 6px', flex: 'none' }}>{re0.tag}</span>}
                  {re0.isCap && <input value={re0.first} onChange={re0.onFirst} placeholder="Nombre del capítulo" style={{ flex: 1, minWidth: 0, padding: '7px 9px', border: '1px solid #C9C5BC', borderRadius: 6, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', background: '#fff' }} />}
                  {re0.notCap && re0.cells.map((rc0: any, ci: number) => <input key={ci} value={rc0.value} onChange={rc0.onChange} style={{ flex: 1, minWidth: 0, padding: '7px 8px', border: '1px solid #DCD9D2', borderRadius: 6, fontSize: 12, background: '#fff', fontWeight: re0.fw }} />)}
                  <button onClick={re0.onInsert} title="Insertar línea debajo" style={{ border: '1px solid #DCD9D2', background: '#fff', borderRadius: 5, width: 24, height: 24, fontSize: 13, cursor: 'pointer', color: '#6E6B66', flex: 'none', lineHeight: 1 }}>+</button>
                  <button onClick={re0.onDel} title="Eliminar" style={{ border: 'none', background: 'none', color: '#B4B0A8', fontSize: 15, cursor: 'pointer', padding: 0, width: 22, flex: 'none' }}>×</button>
                </div>
              ))}
              <div onDragOver={v.endDragOver} onDrop={v.endDrop} style={{ height: 26, borderTop: v.endDropLine }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, padding: '14px 20px', borderTop: '1px solid #E0DED8', background: '#fff', flexWrap: 'wrap' }}>
            <button onClick={v.addCapitulo} style={{ border: 'none', background: '#17161A', color: '#fff', borderRadius: 7, padding: '8px 13px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>+ Capítulo</button>
            <button onClick={v.addFila} style={{ border: '1px solid #DCD9D2', background: '#fff', borderRadius: 7, padding: '8px 13px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>+ Línea</button>
            <button onClick={v.addSubtotal} style={{ border: '1px solid #DCD9D2', background: '#fff', borderRadius: 7, padding: '8px 13px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>+ Subtotal</button>
            <div style={{ flex: 1 }} />
            <div style={{ fontFamily: MONO, fontSize: 10, color: '#8A867F', alignSelf: 'center' }}>TOTAL · <span style={{ color: '#17161A', fontWeight: 600 }}>{v.presuTotal}</span></div>
          </div>
        </div>
      </div>
    )
  }

  renderSlidePage(v: any, sl: any, idx: number) {
    const accent = v.accent
    const dot = <div style={{ width: '2.6mm', height: '2.6mm', background: accent }} />
    const edK = (style: any) => this.edDiv(sl.edRevK, sl.onEdK, v.edKey1, style, sl.kicker)
    const edT = (style: any) => this.edDiv(sl.edRevT, sl.onEdT, v.edKey1, style, sl.titulo)
    const edX = (style: any) => this.edDiv(sl.edRevX, sl.onEdX, v.edKeyN, style, sl.texto)
    const kickMono: React.CSSProperties = { fontFamily: MONO, fontSize: '8pt', letterSpacing: '0.2em', color: '#8A867F', textTransform: 'uppercase' }
    const slot = (im: any, label: string, dark?: boolean) => im.has ? im.el : (
      <div className="venta-ph" onDragOver={im.over} onDragLeave={im.leave} onDrop={im.drop} title="Suelta aquí una imagen" style={{ position: 'absolute', inset: 0, outline: im.hlOl, outlineOffset: '-2mm', animation: im.hlAnim, background: dark ? 'repeating-linear-gradient(45deg,#2A2930 0 10px,#232229 10px 20px)' : 'repeating-linear-gradient(45deg,#F2F0EC 0 10px,#E9E6E0 10px 20px)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: '9pt', color: '#8A867F' }}>{label}</div>
    )
    return (
      <div key={idx} className="venta-page" data-page="1" data-rev-page={sl.slId} data-screen-label={sl.label} onContextMenu={sl.onCtx} style={{ width: '297mm', height: '210mm', flex: 'none', background: sl.pageBg, boxShadow: '0 24px 60px rgba(23,22,26,0.16)', marginBottom: v.grid ? 0 : 36, position: 'relative', overflow: 'hidden' }}>
        {sl.dSvg}
        <RevisionLayer app="venta" projectId={this.props.projectId} pageId={sl.slId} pageLabel={sl.label} />
        {v.grid && (
          <div
            data-ui="1"
            draggable
            onDragStart={(e: any) => { e.dataTransfer.effectAllowed = 'move'; this._gridDrag = sl.slId }}
            onDragOver={(e: any) => { e.preventDefault(); if (this.state.gridOver !== sl.slId) this.setState({ gridOver: sl.slId }) }}
            onDragLeave={() => { if (this.state.gridOver === sl.slId) this.setState({ gridOver: null }) }}
            onDrop={(e: any) => { e.preventDefault(); this.gridReorder(sl.slId) }}
            onDragEnd={() => { this._gridDrag = null; this.setState({ gridOver: null }) }}
            onDoubleClick={v.goDoc}
            title="Arrastra para reordenar · doble clic para editar"
            style={{ position: 'absolute', inset: 0, zIndex: 60, cursor: 'grab', background: this.state.gridOver === sl.slId ? 'rgba(214,25,126,0.12)' : 'transparent', outline: this.state.gridOver === sl.slId ? '18px solid #D6197E' : 'none', outlineOffset: '-18px' }}
          />
        )}

        {sl.isHero && (
          <div style={{ position: 'absolute', inset: 0 }}>
            {sl.i1.has ? sl.i1.el : <div className="venta-ph" onDragOver={sl.i1.over} onDragLeave={sl.i1.leave} onDrop={sl.i1.drop} title="Suelta aquí una imagen" style={{ position: 'absolute', inset: 0, outline: sl.i1.hlOl, outlineOffset: '-2mm', animation: sl.i1.hlAnim, background: 'repeating-linear-gradient(45deg,#2A2930 0 10px,#232229 10px 20px)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: '10pt', color: '#8A867F' }}>imagen principal — render del stand</div>}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(115deg, ' + accent + 'CC 0%, ' + accent + '66 38%, rgba(23,22,26,0.25) 75%, rgba(23,22,26,0.55) 100%)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '52%', background: 'linear-gradient(to top, rgba(23,22,26,0.82), rgba(23,22,26,0))', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', left: '12mm', right: '12mm', bottom: '12mm', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '10mm' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4mm', maxWidth: '200mm' }}>
                {edK({ fontFamily: MONO, fontSize: '8.5pt', letterSpacing: '0.2em', color: '#FFFFFF', opacity: 0.85, textTransform: 'uppercase' })}
                <div style={{ width: '22mm', height: '2.2mm', background: accent }} />
                {edT({ fontSize: '29pt', fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.02em', color: '#FFFFFF' })}
                {edX({ fontFamily: MONO, fontSize: '8pt', letterSpacing: '0.1em', color: '#FFFFFF', opacity: 0.75 })}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3mm', flex: 'none' }}>
                <img src="/assets/logo.png" alt="Ready Eventos" style={{ height: '20mm', width: 'auto' }} />
                <div style={{ fontFamily: MONO, fontSize: '8pt', color: '#FFFFFF', opacity: 0.75 }}>{v.fechaLarga}</div>
              </div>
            </div>
          </div>
        )}

        {sl.isQuienes && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
            <div style={{ width: '55%', padding: '16mm 14mm 16mm 16mm', display: 'flex', flexDirection: 'column', gap: '7mm' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '3mm' }}>{dot}{edK(kickMono)}</div>
              {edT({ fontSize: '23pt', fontWeight: 800, lineHeight: 1.08, letterSpacing: '-0.02em' })}
              {edX({ fontSize: '11pt', lineHeight: 1.65, color: '#3A3840', maxWidth: '120mm', whiteSpace: 'pre-wrap' })}
              <div style={{ flex: 1 }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6mm', borderTop: '0.4mm solid #17161A', paddingTop: '6mm' }}>
                {[['01', 'Diseños ad-hoc', 'Soluciones a medida de cada cliente, cada marca y cada feria.'], ['02', 'Experiencia', 'Larga trayectoria en espacios expositivos, laborales y residenciales.'], ['03', 'Grupo IGC', 'Solidez, eficiencia y calidad garantizadas en cada montaje.']].map((c, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '2mm' }}>
                    <div style={{ fontFamily: MONO, fontSize: '6.5pt', letterSpacing: '0.14em', color: accent }}>{c[0]}</div>
                    <div style={{ fontSize: '10.5pt', fontWeight: 700 }}>{c[1]}</div>
                    <div style={{ fontSize: '8.5pt', lineHeight: 1.55, color: '#6E6B66' }}>{c[2]}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ width: '45%', position: 'relative' }}>{slot(sl.i1, 'foto de un montaje')}</div>
          </div>
        )}

        {sl.isCollage && (
          <>
            <div onDragOver={sl.clOver} onDrop={sl.clDropEv} onMouseDown={sl.clBgDown} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
              {sl.clEl}
              {sl.clEmpty && (
                <div data-ui="1" style={{ position: 'absolute', inset: '14mm', border: '0.6mm dashed #C9C5BC', borderRadius: '3mm', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4mm', pointerEvents: 'none' }}>
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#B4B0A8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></svg>
                  <div style={{ fontFamily: MONO, fontSize: '9.5pt', color: '#8A867F' }}>Arrastra imágenes aquí para componer el collage</div>
                  <div style={{ fontSize: '8.5pt', color: '#B4B0A8' }}>mover: arrastrar · escalar: tirador esquina o rueda · girar: tirador superior · fusión: control inferior</div>
                </div>
              )}
            </div>
            {sl.clSelOn && (
              <div data-ui="1" onMouseDown={v.trapClick} style={{ position: 'absolute', left: '50%', bottom: '5mm', transform: 'translateX(-50%)', zIndex: 60, display: 'flex', alignItems: 'center', gap: 10, background: '#17161A', color: '#fff', borderRadius: 10, padding: '8px 14px', boxShadow: '0 10px 30px rgba(23,22,26,0.4)' }}>
                <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', color: '#C9C5CE', whiteSpace: 'nowrap' }}>FUSIÓN</span>
                <input type="range" min={0} max={75} value={sl.clF} onChange={sl.onClF} title="Grado de fusión de los bordes" style={{ width: 110, accentColor: '#D6197E' }} />
                <span style={{ width: 1, height: 16, background: '#3A3840' }} />
                <button onClick={sl.onClCropToggle} title="Recortar" style={{ border: '1px solid ' + sl.clCropBd, background: sl.clCropBg, color: '#fff', borderRadius: 6, padding: '4px 9px', fontSize: 10.5, fontWeight: 600, cursor: 'pointer' }}>Recortar</button>
                {sl.clHasCrop && <button onClick={sl.onClCropReset} title="Quitar el recorte" style={{ border: '1px solid #3A3840', background: '#26252A', color: '#C9C5CE', borderRadius: 6, padding: '4px 9px', fontSize: 10.5, fontWeight: 600, cursor: 'pointer' }}>Quitar recorte</button>}
                <span style={{ width: 1, height: 16, background: '#3A3840' }} />
                <button onClick={sl.clFront} title="Traer al frente" style={{ border: '1px solid #3A3840', background: '#26252A', color: '#EDEBF0', borderRadius: 6, padding: '4px 9px', fontSize: 10.5, fontWeight: 600, cursor: 'pointer' }}>Delante</button>
                <button onClick={sl.clBack} title="Enviar al fondo" style={{ border: '1px solid #3A3840', background: '#26252A', color: '#EDEBF0', borderRadius: 6, padding: '4px 9px', fontSize: 10.5, fontWeight: 600, cursor: 'pointer' }}>Detrás</button>
                <button onClick={sl.clDel} title="Eliminar imagen del collage" style={{ border: '1px solid #3A3840', background: '#26252A', color: '#F09A9A', borderRadius: 6, padding: '4px 9px', fontSize: 10.5, fontWeight: 600, cursor: 'pointer' }}>Eliminar</button>
              </div>
            )}
          </>
        )}

        {sl.isSplit && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: sl.splitDir }}>
            <div style={{ width: '58%', position: 'relative' }}>{slot(sl.i1, 'imagen')}</div>
            <div style={{ width: '42%', padding: '16mm', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '6mm' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '3mm' }}>{dot}{edK(kickMono)}</div>
              {edT({ fontSize: '20pt', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em' })}
              {edX({ fontSize: '10.5pt', lineHeight: 1.7, color: '#3A3840', whiteSpace: 'pre-wrap' })}
            </div>
          </div>
        )}

        {sl.isFullimg && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ height: '66%', position: 'relative' }}>{slot(sl.i1, 'imagen a toda página')}</div>
            <div style={{ flex: 1, display: 'flex', padding: '9mm 16mm 12mm', gap: '12mm', alignItems: 'flex-start' }}>
              <div style={{ width: '36%', display: 'flex', flexDirection: 'column', gap: '3.5mm' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '3mm' }}>{dot}{edK(kickMono)}</div>
                {edT({ fontSize: '16pt', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em' })}
              </div>
              {edX({ flex: 1, fontSize: '10pt', lineHeight: 1.7, color: '#3A3840', whiteSpace: 'pre-wrap' })}
            </div>
          </div>
        )}

        {sl.isDark && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', background: '#17161A' }}>
            <div style={{ width: '48%', padding: '16mm', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '6mm' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '3mm' }}>{dot}{edK({ ...kickMono, color: '#9B97A3' })}</div>
              {edT({ fontSize: '20pt', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em', color: '#FFFFFF' })}
              {edX({ fontSize: '10.5pt', lineHeight: 1.7, color: '#C9C5CE', whiteSpace: 'pre-wrap' })}
            </div>
            <div style={{ width: '52%', position: 'relative' }}>{slot(sl.i1, 'imagen', true)}</div>
          </div>
        )}

        {sl.isGallery && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', padding: '14mm 16mm', gap: '8mm' }}>
            <div style={{ display: 'flex', gap: '12mm', alignItems: 'flex-end' }}>
              <div style={{ width: '40%', display: 'flex', flexDirection: 'column', gap: '4mm' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '3mm' }}>{dot}{edK(kickMono)}</div>
                {edT({ fontSize: '18pt', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em' })}
              </div>
              {edX({ flex: 1, fontSize: '10pt', lineHeight: 1.65, color: '#3A3840', whiteSpace: 'pre-wrap' })}
            </div>
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6mm' }}>
              {[sl.i1, sl.i2, sl.i3].map((im: any, i: number) => <div key={i} style={{ position: 'relative' }}>{slot(im, 'imagen ' + (i + 1))}</div>)}
            </div>
          </div>
        )}

        {sl.isText && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8mm', padding: '20mm 30mm' }}>
            {edK({ fontFamily: MONO, fontSize: '8pt', letterSpacing: '0.2em', color: '#8A867F', textTransform: 'uppercase' })}
            <div style={{ width: '22mm', height: '2.2mm', background: accent }} />
            {edT({ fontSize: '23pt', fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.02em', textAlign: 'center', maxWidth: '210mm' })}
            {edX({ fontSize: '11pt', lineHeight: 1.7, color: '#3A3840', textAlign: 'center', maxWidth: '180mm', whiteSpace: 'pre-wrap' })}
          </div>
        )}

        {sl.isPresu && this.renderPresuSlide(v, sl)}

        {sl.isCols2 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', padding: '14mm 16mm', gap: '7mm' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3.5mm' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '3mm' }}>{dot}{edK(kickMono)}</div>
              {edT({ fontSize: '18pt', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em' })}
            </div>
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10mm' }}>
              {sl.cols2.map((c2: any, i: number) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4mm', minHeight: 0 }}>
                  <div style={{ height: '58mm', flex: 'none', position: 'relative', overflow: 'hidden', background: '#F2F0EC' }}>
                    {c2.hasImg ? c2.imgEl : <div onDragOver={c2.over} onDragLeave={c2.leave} onDrop={c2.drop} title="Suelta aquí una imagen" style={{ position: 'absolute', inset: 0, outline: c2.hlOl, outlineOffset: '-2mm', animation: c2.hlAnim, background: 'repeating-linear-gradient(45deg,#F2F0EC 0 10px,#E9E6E0 10px 20px)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: '8.5pt', color: '#8A867F' }}>imagen</div>}
                  </div>
                  <div style={{ fontSize: '12pt', fontWeight: 700, borderBottom: '0.35mm solid #17161A', paddingBottom: '2mm' }}>{c2.sub}</div>
                  <div style={{ fontSize: '9.5pt', lineHeight: 1.65, color: '#3A3840', whiteSpace: 'pre-wrap' }}>{c2.body}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {sl.isTimeline && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', padding: '14mm 16mm', gap: '10mm' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3.5mm' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '3mm' }}>{dot}{edK(kickMono)}</div>
              {edT({ fontSize: '18pt', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em' })}
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
              <div style={{ width: '100%', position: 'relative', display: 'flex', gap: '6mm' }}>
                <div style={{ position: 'absolute', left: 0, right: 0, top: '5.4mm', height: '0.5mm', background: '#E4E1DA' }} />
                {sl.pasos.map((ps: any, i: number) => (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '3mm', position: 'relative' }}>
                    <div style={{ width: '11mm', height: '11mm', borderRadius: '50%', background: accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: '9pt', fontWeight: 600, flex: 'none' }}>{ps.n}</div>
                    <div style={{ fontSize: '11pt', fontWeight: 700, lineHeight: 1.25 }}>{ps.t}</div>
                    <div style={{ fontSize: '8.5pt', lineHeight: 1.55, color: '#6E6B66' }}>{ps.d}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {sl.isFicha && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
            <div style={{ width: '55%', padding: '14mm 12mm 14mm 16mm', display: 'flex', flexDirection: 'column', gap: '6mm' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '3mm' }}>{dot}{edK(kickMono)}</div>
              {edT({ fontSize: '18pt', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em' })}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                {sl.fichaRows.map((fr: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: '6mm', padding: '2.6mm 0', borderBottom: '0.2mm solid #E4E1DA' }}>
                    <span style={{ fontFamily: MONO, fontSize: '7pt', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#6E6B66', width: '42mm', flex: 'none' }}>{fr.k}</span>
                    <span style={{ fontSize: '10.5pt', fontWeight: 600 }}>{fr.v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ width: '45%', position: 'relative' }}>{slot(sl.i1, 'imagen del stand')}</div>
          </div>
        )}

        {sl.isLibre && (
          <div style={{ position: 'absolute', inset: 0 }}>
            {sl.bloques.map((bk: any, i: number) => (
              <div key={i} style={{ position: 'absolute', left: bk.l, top: bk.t, width: bk.w, height: bk.h, background: bk.bgc, overflow: 'hidden' }}>
                {bk.isText && <div style={{ width: '100%', fontFamily: bk.ff, fontSize: bk.fs, fontWeight: bk.fw, color: bk.col, textAlign: bk.ta, lineHeight: bk.lh, letterSpacing: bk.ls, whiteSpace: 'pre-wrap' }}>{bk.text}</div>}
                {bk.isImg && bk.imgEl}
                {bk.isLogo && <div style={{ width: '100%', height: '100%', background: '#FFFFFF', borderRadius: '2mm', padding: '2mm 3mm', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><img src="/assets/logo.png" alt="Ready Eventos" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /></div>}
              </div>
            ))}
          </div>
        )}

        {sl.isCierre && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '9mm', padding: '20mm' }}>
            <div style={{ width: '22mm', height: '2.2mm', background: accent }} />
            {edT({ fontSize: '26pt', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em', textAlign: 'center', maxWidth: '200mm' })}
            {edX({ fontSize: '10.5pt', lineHeight: 1.7, color: '#3A3840', textAlign: 'center', maxWidth: '170mm', whiteSpace: 'pre-wrap' })}
            <div style={{ fontFamily: MONO, fontSize: '8.5pt', letterSpacing: '0.08em', color: '#6E6B66', textAlign: 'center', lineHeight: 2 }}>Calle Soria, 34 · 28864 Ajalvir (Madrid)<br />+34 677 437 113 · ready@readyeventos.com · readyeventos.com</div>
            <img src="/assets/logo.png" alt="Ready Eventos" style={{ height: '16mm', width: 'auto', marginTop: '2mm' }} />
          </div>
        )}

        {sl.showNum && <div style={{ position: 'absolute', right: '10mm', bottom: '6.5mm', zIndex: 5, fontFamily: MONO, fontSize: '7pt', letterSpacing: '0.14em', color: sl.numFg }}>{sl.numTxt}</div>}
      </div>
    )
  }

  renderPresuSlide(v: any, sl: any) {
    const accent = v.accent
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', padding: '14mm 16mm', gap: '6mm' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '3mm' }}>
          <div style={{ width: '2.6mm', height: '2.6mm', background: accent }} />
          {this.edDiv(sl.edRevK, sl.onEdK, v.edKey1, { fontFamily: MONO, fontSize: '8pt', letterSpacing: '0.2em', color: '#8A867F', textTransform: 'uppercase' }, sl.kicker)}
        </div>
        <div style={{ fontSize: '18pt', fontWeight: 800, letterSpacing: '-0.02em' }}>{sl.pTitulo}</div>
        {sl.pShowHead && (
          <div style={{ display: 'grid', gridTemplateColumns: '36mm 1fr 1fr 52mm', gap: 0, background: '#F4F3F0', borderRadius: '2mm', overflow: 'hidden' }}>
            <div style={{ padding: '3mm', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><img src="/assets/logo.png" alt="Ready Eventos" style={{ maxHeight: '19mm', maxWidth: '100%', width: 'auto', objectFit: 'contain' }} /></div>
            <div style={{ padding: '3.5mm 4.5mm', display: 'flex', flexDirection: 'column', gap: '1.6mm' }}>
              <span style={{ fontFamily: MONO, fontSize: '5.5pt', letterSpacing: '0.16em', color: '#6E6B66' }}>EMISOR</span>
              <span style={{ fontSize: '8pt', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{v.presuEmisorTxt}</span>
            </div>
            <div style={{ padding: '3.5mm 4.5mm', borderLeft: '0.5mm solid #FFFFFF', display: 'flex', flexDirection: 'column', gap: '1.6mm' }}>
              <span style={{ fontFamily: MONO, fontSize: '5.5pt', letterSpacing: '0.16em', color: '#6E6B66' }}>CLIENTE</span>
              <span style={{ fontSize: '8pt', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{v.presuReceptorTxt}</span>
            </div>
            <div style={{ borderLeft: '0.5mm solid #FFFFFF', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '3.5mm 4.5mm', display: 'flex', flexDirection: 'column', gap: '1.4mm', borderBottom: '0.5mm solid #FFFFFF', flex: 1 }}>
                <span style={{ fontFamily: MONO, fontSize: '5.5pt', letterSpacing: '0.16em', color: '#6E6B66' }}>Nº PRESUPUESTO</span>
                <span style={{ fontSize: '11pt', fontWeight: 800, color: accent }}>{v.presuNumTxt}</span>
              </div>
              <div style={{ padding: '3.5mm 4.5mm', display: 'flex', flexDirection: 'column', gap: '1.4mm' }}>
                <span style={{ fontFamily: MONO, fontSize: '5.5pt', letterSpacing: '0.16em', color: '#6E6B66' }}>FECHA</span>
                <span style={{ fontSize: '9pt', fontWeight: 600 }}>{v.presuFechaTxt}</span>
              </div>
            </div>
          </div>
        )}
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>{v.presuPageCols.map((ppc: any, i: number) => <th key={i} style={{ textAlign: ppc.ta, fontFamily: MONO, fontSize: '7pt', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#6E6B66', borderBottom: '0.5mm solid #17161A', padding: '2.4mm 2mm', fontWeight: 600 }}>{ppc.label}</th>)}</tr>
          </thead>
          <tbody>
            {sl.pRows.map((ppr: any, ri: number) => (
              <tr key={ri}>{ppr.cells.map((ppd: any, ci: number) => <td key={ci} style={{ textAlign: ppd.ta, borderTop: ppd.bt, borderBottom: ppd.bb, padding: ppd.pad, fontSize: ppd.fs, fontWeight: ppd.fw, textTransform: ppd.tt, letterSpacing: ppd.ls, fontFamily: ppd.ff, background: ppd.bg }}>{ppd.v}</td>)}</tr>
            ))}
          </tbody>
        </table>
        {sl.pShowTotal && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '1.6mm', borderTop: '0.5mm solid #17161A', paddingTop: '3mm' }}>
            {v.totalsRows.map((tr9: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: '8mm' }}>
                <span style={{ fontFamily: MONO, fontSize: '7pt', letterSpacing: '0.14em', color: '#6E6B66' }}>{tr9.k}</span>
                <span style={{ fontSize: '10pt', fontWeight: 600, minWidth: '34mm', textAlign: 'right' }}>{tr9.v}</span>
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8mm' }}>
              <span style={{ fontFamily: MONO, fontSize: '8pt', letterSpacing: '0.16em', color: '#6E6B66' }}>TOTAL</span>
              <span style={{ fontSize: '16pt', fontWeight: 800, color: accent, minWidth: '34mm', textAlign: 'right' }}>{v.presuTotal}</span>
            </div>
          </div>
        )}
        <div style={{ flex: 1 }} />
        {sl.pShowCond && <div style={{ fontFamily: MONO, fontSize: '7pt', lineHeight: 1.6, color: '#8A867F', whiteSpace: 'pre-wrap' }}>{v.condiciones}</div>}
        {sl.pCont && <div style={{ fontFamily: MONO, fontSize: '7pt', letterSpacing: '0.14em', color: '#8A867F', textAlign: 'right' }}>CONTINÚA EN LA PÁGINA SIGUIENTE →</div>}
      </div>
    )
  }
}
