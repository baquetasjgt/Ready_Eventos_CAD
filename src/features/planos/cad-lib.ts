// cad-lib.ts — Parser DXF (ASCII), generador SVG y plano de ejemplo.
// Ported verbatim from project/cad-lib.js, with types added on the public API.
// Entidades internas (broad, dynamic — typed as `any` internally):
//  {k:'l',x1,y1,x2,y2} línea · {k:'p',pts:[[x,y,bulge]],closed,fill} polilínea
//  {k:'c',cx,cy,r} círculo · {k:'a',cx,cy,r,a1,a2} arco (grados, CCW)
//  {k:'t',x,y,h,rot,text,ha,att,mtext} texto · {k:'pt',x,y} punto

export const UNIT_MM: Record<string, number> = { m: 1000, cm: 10, mm: 1 }

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  w: number
  h: number
}
export interface LayerStyle {
  color: number
  lw: number
  off: boolean
}
export interface ModelText {
  t: string
  x: number
  y: number
  h: number
}
export interface Model {
  ents: any[]
  bounds: Bounds
  layers: string[]
  texts: ModelText[]
  unitsGuess: string
  n: number
  layerStyles?: Record<string, LayerStyle>
}
export interface Frame extends Bounds {
  size: string
  orient: string
  escala: number
  inside: number
  named: boolean
}
export interface Region {
  minX: number
  minY: number
  maxX: number
  maxY: number
}
export interface BuildSVGOpts {
  region?: Region | null
  stroke?: number
  color?: string
  font?: string
  useLayers?: boolean
  layerStyles?: Record<string, LayerStyle>
  mmToDU?: number
}

function cleanText(t: any): string {
  return String(t)
    .replace(/%%[dD]/g, '°')
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[pP]/g, '±')
    .replace(/%%%/g, '%')
}
function cleanMText(t: any): string {
  const SENT = String.fromCharCode(1)
  return String(t)
    .replace(/\\\\/g, SENT)
    .replace(/\\P/g, '\n')
    .replace(/\\~/g, ' ')
    .replace(/\\[ACcFfHhTtQqWwOoLlKkSpX][^;{}]{0,60};/g, '')
    .replace(/[{}]/g, '')
    .replace(new RegExp(SENT, 'g'), '\\')
    .replace(/%%[dD]/g, '\u00b0')
    .replace(/%%[cC]/g, '\u00d8')
    .replace(/%%[pP]/g, '\u00b1')
}

// ---- matrices 2D {a,b,c,d,e,f} ----
function mul(m: any, n: any) {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  }
}
function apply(m: any, x: number, y: number) {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]
}
function isIdent(m: any) {
  return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0
}

function arcToPts(cx: number, cy: number, r: number, a1: number, a2: number) {
  let s = (a1 * Math.PI) / 180,
    t = (a2 * Math.PI) / 180
  while (t <= s) t += Math.PI * 2
  const n = Math.max(8, Math.ceil((t - s) / (Math.PI / 16)))
  const pts: number[][] = []
  for (let q = 0; q <= n; q++) {
    const u = s + ((t - s) * q) / n
    pts.push([cx + r * Math.cos(u), cy + r * Math.sin(u), 0])
  }
  return pts
}

function transformEnt(e: any, m: any): any {
  if (isIdent(m)) return e
  const det = m.a * m.d - m.b * m.c
  const sc = Math.sqrt(Math.abs(det)) || 1
  const rotM = (Math.atan2(m.b, m.a) * 180) / Math.PI
  switch (e.k) {
    case 'l': {
      const p1 = apply(m, e.x1, e.y1),
        p2 = apply(m, e.x2, e.y2)
      return { ...e, x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] }
    }
    case 'p': {
      const pts = e.pts.map((p: any) => {
        const q = apply(m, p[0], p[1])
        return [q[0], q[1], det < 0 ? -(p[2] || 0) : p[2] || 0]
      })
      return { ...e, pts }
    }
    case 'c': {
      const c0 = apply(m, e.cx, e.cy)
      return { ...e, cx: c0[0], cy: c0[1], r: e.r * sc }
    }
    case 'a': {
      const pts = arcToPts(e.cx, e.cy, e.r, e.a1, e.a2).map((p) => {
        const q = apply(m, p[0], p[1])
        return [q[0], q[1], 0]
      })
      return { ...e, k: 'p', pts, closed: false }
    }
    case 't': {
      const p = apply(m, e.x, e.y)
      return { ...e, x: p[0], y: p[1], h: e.h * sc, rot: (e.rot || 0) + rotM }
    }
    case 'pt': {
      const p = apply(m, e.x, e.y)
      return { ...e, x: p[0], y: p[1] }
    }
    default:
      return e
  }
}

// ---- parser DXF ----
export function parseDXF(text: string): Model {
  const lines = text.split(/\r\n|\r|\n/)
  const pairs: [number, string][] = []
  for (let k = 0; k + 1 < lines.length; k += 2) {
    const c = parseInt(lines[k], 10)
    if (Number.isNaN(c)) continue
    pairs.push([c, lines[k + 1]])
  }
  const blocks: Record<string, any> = {}
  const rawEnts: any[] = []
  const layerTable: Record<string, LayerStyle> = {}
  let units = 0

  const get = (seq: any[], code: number) => {
    for (const p of seq) if (p[0] === code) return p[1]
  }
  const getAll = (seq: any[], code: number) => {
    const r: any[] = []
    for (const p of seq) if (p[0] === code) r.push(p[1])
    return r
  }

  function collect(start: number) {
    const type = String(pairs[start][1]).trim()
    let j = start + 1
    const seq: any[] = []
    while (j < pairs.length && pairs[j][0] !== 0) {
      seq.push(pairs[j])
      j++
    }
    return { type, seq, end: j }
  }

  function attachStyle(b: any, seq: any[]) {
    const cv = get(seq, 62)
    if (cv !== undefined) {
      const ci = parseInt(cv, 10)
      if (ci > 0 && ci < 256) b.col = ci
    }
    const tv = get(seq, 420)
    if (tv !== undefined) {
      const t = parseInt(tv, 10)
      if (isFinite(t) && t >= 0) b.tc = t
    }
    const lv = get(seq, 370)
    if (lv !== undefined) {
      const lw = parseInt(lv, 10)
      if (lw > 0) b.lw = lw
    }
  }

  function buildEntity(type: string, seq: any[]): any {
    const layer = String(get(seq, 8) || '0').trim()
    if (/^defpoints$/i.test(layer)) return null
    const f = (c: number) => parseFloat(get(seq, c))
    switch (type) {
      case 'LINE': {
        const e = { k: 'l', layer, x1: f(10), y1: f(20), x2: f(11), y2: f(21) }
        return [e.x1, e.y1, e.x2, e.y2].every(isFinite) ? e : null
      }
      case 'LWPOLYLINE': {
        const pts: number[][] = []
        let cur: number[] | null = null
        const closed = (parseInt(get(seq, 70) || '0', 10) & 1) === 1
        for (const [c, v] of seq) {
          if (c === 10) {
            cur = [parseFloat(v), 0, 0]
            pts.push(cur)
          } else if (c === 20 && cur) cur[1] = parseFloat(v)
          else if (c === 42 && cur) cur[2] = parseFloat(v) || 0
        }
        const ok = pts.filter((p) => isFinite(p[0]) && isFinite(p[1]))
        return ok.length > 1 ? { k: 'p', layer, pts: ok, closed } : null
      }
      case 'CIRCLE': {
        const e = { k: 'c', layer, cx: f(10), cy: f(20), r: f(40) }
        return [e.cx, e.cy, e.r].every(isFinite) && e.r > 0 ? e : null
      }
      case 'ARC': {
        const e = { k: 'a', layer, cx: f(10), cy: f(20), r: f(40), a1: f(50), a2: f(51) }
        return [e.cx, e.cy, e.r, e.a1, e.a2].every(isFinite) && e.r > 0 ? e : null
      }
      case 'ELLIPSE': {
        const cx = f(10),
          cy = f(20),
          mx = f(11),
          my = f(21),
          ratio = f(40)
        if (![cx, cy, mx, my, ratio].every(isFinite)) return null
        let u1 = f(41),
          u2 = f(42)
        if (!isFinite(u1)) u1 = 0
        if (!isFinite(u2)) u2 = Math.PI * 2
        if (u2 <= u1) u2 += Math.PI * 2
        const L = Math.hypot(mx, my),
          ang = Math.atan2(my, mx)
        const pts: number[][] = []
        const n = 48
        for (let q = 0; q <= n; q++) {
          const u = u1 + ((u2 - u1) * q) / n
          const px = Math.cos(u) * L,
            py = Math.sin(u) * L * ratio
          pts.push([
            cx + px * Math.cos(ang) - py * Math.sin(ang),
            cy + px * Math.sin(ang) + py * Math.cos(ang),
            0,
          ])
        }
        return { k: 'p', layer, pts, closed: Math.abs(u2 - u1 - Math.PI * 2) < 1e-6 }
      }
      case 'SPLINE': {
        const cx0 = getAll(seq, 10).map(parseFloat),
          cy0 = getAll(seq, 20).map(parseFloat)
        const fx = getAll(seq, 11).map(parseFloat),
          fy = getAll(seq, 21).map(parseFloat)
        const px = fx.length > 1 ? fx : cx0,
          py = fy.length > 1 ? fy : cy0
        if (px.length < 2) return null
        const pts = px
          .map((x: number, q: number) => [x, py[q], 0])
          .filter((p: number[]) => isFinite(p[0]) && isFinite(p[1]))
        return pts.length > 1 ? { k: 'p', layer, pts, closed: false } : null
      }
      case 'TEXT':
      case 'ATTRIB': {
        const raw = (get(seq, 1) || '').trim()
        if (!raw) return null
        let x = f(10),
          y = f(20)
        const ha = parseInt(get(seq, 72) || '0', 10),
          va = parseInt(get(seq, 73) || '0', 10)
        if ((ha || va) && isFinite(f(11))) {
          x = f(11)
          y = f(21)
        }
        if (![x, y].every(isFinite)) return null
        return { k: 't', layer, x, y, h: f(40) || 1, rot: f(50) || 0, text: cleanText(raw), ha }
      }
      case 'MTEXT': {
        let txt = getAll(seq, 3).join('') + (get(seq, 1) || '')
        txt = cleanMText(txt)
        if (!txt.trim()) return null
        const x = f(10),
          y = f(20)
        if (![x, y].every(isFinite)) return null
        return {
          k: 't',
          layer,
          x,
          y,
          h: f(40) || 1,
          rot: f(50) || 0,
          text: txt,
          mtext: true,
          att: parseInt(get(seq, 71) || '1', 10),
        }
      }
      case 'POINT': {
        const x = f(10),
          y = f(20)
        return [x, y].every(isFinite) ? { k: 'pt', layer, x, y } : null
      }
      case 'SOLID':
      case '3DFACE': {
        const q = [
          [f(10), f(20)],
          [f(11), f(21)],
          [f(13), f(23)],
          [f(12), f(22)],
        ].filter((p) => p.every(isFinite))
        return q.length > 2
          ? { k: 'p', layer, pts: q.map((p) => [p[0], p[1], 0]), closed: true, fill: type === 'SOLID' }
          : null
      }
      case 'INSERT': {
        const name = String(get(seq, 2) || '').trim()
        if (!name) return null
        const sx = isFinite(f(41)) ? f(41) : 1
        return {
          k: 'i',
          layer,
          name,
          x: f(10) || 0,
          y: f(20) || 0,
          sx,
          sy: isFinite(f(42)) ? f(42) : sx,
          rot: f(50) || 0,
        }
      }
      case 'DIMENSION': {
        const bn = String(get(seq, 2) || '').trim()
        const ox = isFinite(f(12)) ? f(12) : 0,
          oy = isFinite(f(22)) ? f(22) : 0
        return bn ? { k: 'i', layer, name: bn, x: ox, y: oy, sx: 1, sy: 1, rot: 0 } : null
      }
      case 'MULTILEADER':
      case 'MLEADER': {
        let txt = getAll(seq, 304)
          .filter((v: any) => !/^LEADER_LINE\{$/.test(String(v).trim()))
          .join('')
        txt = cleanMText(txt.replace(/\^J/g, '\n'))
        if (!txt.trim()) return null
        let x = f(12),
          y = f(22)
        if (![x, y].every(isFinite)) {
          x = f(10)
          y = f(20)
        }
        if (![x, y].every(isFinite)) return null
        const h41 = f(41),
          h140 = f(140)
        const h = isFinite(h41) && h41 > 0 ? h41 : isFinite(h140) && h140 > 0 ? h140 : 1
        const out: any[] = [{ k: 't', layer, x, y, h, rot: 0, text: txt, mtext: true, att: 1 }]
        const pts: number[][] = []
        let mode = '',
          px: number | null = null,
          lx: number | null = null,
          lastPt: number[] | null = null,
          dgx: number | null = null,
          dgy: number | null = null,
          dgLen: number | null = null
        for (const [c, v] of seq) {
          const sv = String(v).trim()
          if (c === 302 && sv === 'LEADER{') {
            mode = 'leader'
            continue
          }
          if (c === 304 && sv === 'LEADER_LINE{') {
            mode = 'line'
            px = null
            continue
          }
          if (c === 305 && sv === '}') {
            mode = 'leader'
            px = null
            continue
          }
          if (c === 303 && sv === '}') {
            mode = ''
            continue
          }
          if (mode === 'line') {
            if (c === 10) px = parseFloat(v)
            else if (c === 20 && px !== null && isFinite(px) && isFinite(parseFloat(v))) {
              pts.push([px, parseFloat(v), 0])
              px = null
            }
          } else if (mode === 'leader') {
            if (c === 10) lx = parseFloat(v)
            else if (c === 20 && lx !== null && isFinite(lx) && isFinite(parseFloat(v))) {
              lastPt = [lx, parseFloat(v)]
              lx = null
            } else if (c === 11) dgx = parseFloat(v)
            else if (c === 21) dgy = parseFloat(v)
            else if (c === 40 && dgLen === null) dgLen = parseFloat(v)
          }
        }
        if (lastPt) pts.push([lastPt[0], lastPt[1], 0])
        if (
          lastPt &&
          dgx !== null &&
          dgy !== null &&
          dgLen !== null &&
          isFinite(dgx) &&
          isFinite(dgy) &&
          isFinite(dgLen) &&
          dgLen > 0
        ) {
          pts.push([lastPt[0] + dgx * dgLen, lastPt[1] + dgy * dgLen, 0])
        }
        if (pts.length > 1) out.push({ k: 'p', layer, pts, closed: false })
        return out
      }
      default:
        return null
    }
  }

  function readPolyline(first: any) {
    const closed = (parseInt(get(first.seq, 70) || '0', 10) & 1) === 1
    const layer = String(get(first.seq, 8) || '0').trim()
    let i2 = first.end
    const pts: number[][] = []
    while (i2 < pairs.length) {
      if (pairs[i2][0] !== 0) {
        i2++
        continue
      }
      const t = String(pairs[i2][1]).trim()
      if (t === 'VERTEX') {
        const v = collect(i2)
        const x = parseFloat(get(v.seq, 10)),
          y = parseFloat(get(v.seq, 20))
        const b = parseFloat(get(v.seq, 42)) || 0
        if (isFinite(x) && isFinite(y)) pts.push([x, y, b])
        i2 = v.end
      } else if (t === 'SEQEND') {
        const s2 = collect(i2)
        i2 = s2.end
        break
      } else break
    }
    return {
      ent:
        pts.length > 1
          ? (() => {
              const ent: any = { k: 'p', layer, pts, closed }
              attachStyle(ent, first.seq)
              return ent
            })()
          : null,
      end: i2,
    }
  }

  let i = 0
  while (i < pairs.length) {
    const [c, v] = pairs[i]
    if (c === 0 && String(v).trim() === 'SECTION') {
      const name = pairs[i + 1] && pairs[i + 1][0] === 2 ? String(pairs[i + 1][1]).trim() : ''
      i += 2
      if (name === 'HEADER') {
        while (i < pairs.length && !(pairs[i][0] === 0 && String(pairs[i][1]).trim() === 'ENDSEC')) {
          if (
            pairs[i][0] === 9 &&
            String(pairs[i][1]).trim() === '$INSUNITS' &&
            pairs[i + 1] &&
            pairs[i + 1][0] === 70
          ) {
            units = parseInt(pairs[i + 1][1], 10) || 0
          }
          i++
        }
      } else if (name === 'TABLES') {
        while (i < pairs.length && !(pairs[i][0] === 0 && String(pairs[i][1]).trim() === 'ENDSEC')) {
          if (pairs[i][0] === 0 && String(pairs[i][1]).trim() === 'LAYER') {
            const h = collect(i)
            const nm = String(get(h.seq, 2) || '').trim()
            if (nm) {
              const col = parseInt(get(h.seq, 62) || '7', 10)
              const lw = parseInt(get(h.seq, 370) || '-3', 10)
              const flags = parseInt(get(h.seq, 70) || '0', 10)
              layerTable[nm] = { color: Math.abs(col) || 7, lw, off: col < 0 || !!(flags & 1) }
            }
            i = h.end
          } else i++
        }
      } else if (name === 'BLOCKS') {
        while (i < pairs.length && !(pairs[i][0] === 0 && String(pairs[i][1]).trim() === 'ENDSEC')) {
          if (pairs[i][0] === 0 && String(pairs[i][1]).trim() === 'BLOCK') {
            const h = collect(i)
            const bname = String(get(h.seq, 2) || '').trim()
            const bx = parseFloat(get(h.seq, 10)) || 0,
              by = parseFloat(get(h.seq, 20)) || 0
            i = h.end
            const bents: any[] = []
            while (
              i < pairs.length &&
              !(pairs[i][0] === 0 && String(pairs[i][1]).trim() === 'ENDBLK')
            ) {
              if (pairs[i][0] !== 0) {
                i++
                continue
              }
              const e = collect(i)
              if (e.type === 'POLYLINE') {
                const r = readPolyline(e)
                if (r.ent) bents.push(r.ent)
                i = r.end
              } else {
                const b = buildEntity(e.type, e.seq)
                if (Array.isArray(b))
                  b.forEach((bb: any) => {
                    attachStyle(bb, e.seq)
                    bents.push(bb)
                  })
                else if (b) {
                  attachStyle(b, e.seq)
                  bents.push(b)
                }
                i = e.end
              }
            }
            if (bname) blocks[bname] = { bx, by, ents: bents }
          } else i++
        }
      } else if (name === 'ENTITIES') {
        while (i < pairs.length && !(pairs[i][0] === 0 && String(pairs[i][1]).trim() === 'ENDSEC')) {
          if (pairs[i][0] !== 0) {
            i++
            continue
          }
          const e = collect(i)
          if (e.type === 'POLYLINE') {
            const r = readPolyline(e)
            if (r.ent) rawEnts.push(r.ent)
            i = r.end
          } else {
            const b = buildEntity(e.type, e.seq)
            if (Array.isArray(b))
              b.forEach((bb: any) => {
                attachStyle(bb, e.seq)
                rawEnts.push(bb)
              })
            else if (b) {
              attachStyle(b, e.seq)
              rawEnts.push(b)
            }
            i = e.end
          }
        }
      }
    } else i++
  }

  // aplanar INSERTs
  const IDENT = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
  const flat: any[] = []
  function emit(list: any[], m: any, depth: number) {
    for (const en of list) {
      if (en.k === 'i') {
        if (depth > 6) continue
        const b = blocks[en.name]
        if (!b) continue
        const rad = ((en.rot || 0) * Math.PI) / 180
        const cos = Math.cos(rad),
          sin = Math.sin(rad)
        const T1 = { a: 1, b: 0, c: 0, d: 1, e: en.x, f: en.y }
        const R = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }
        const S = { a: en.sx, b: 0, c: 0, d: en.sy, e: 0, f: 0 }
        const T0 = { a: 1, b: 0, c: 0, d: 1, e: -b.bx, f: -b.by }
        const local = mul(mul(mul(T1, R), S), T0)
        emit(b.ents, mul(m, local), depth + 1)
      } else {
        flat.push(transformEnt(en, m))
      }
    }
  }
  emit(rawEnts, IDENT, 0)

  const bounds = computeBounds(flat)
  const layers = [...new Set(flat.map((e) => e.layer).filter(Boolean))] as string[]
  const texts = flat
    .filter((e) => e.k === 't')
    .slice(0, 400)
    .map((e) => ({ t: e.text, x: e.x, y: e.y, h: e.h }))
  const dim = Math.max(bounds.w, bounds.h)
  const unitsGuess =
    ({ 4: 'mm', 5: 'cm', 6: 'm' } as Record<number, string>)[units] ||
    (dim > 2000 ? 'mm' : dim > 100 ? 'cm' : 'm')
  return { ents: flat, bounds, layers, texts, unitsGuess, n: flat.length, layerStyles: layerTable }
}

// ---- bounds ----
export function computeBounds(ents: any[]): Bounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  const ext = (x: number, y: number) => {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  for (const e of ents) {
    if (e.k === 'l') {
      ext(e.x1, e.y1)
      ext(e.x2, e.y2)
    } else if (e.k === 'p') {
      for (const p of e.pts) ext(p[0], p[1])
    } else if (e.k === 'c' || e.k === 'a') {
      ext(e.cx - e.r, e.cy - e.r)
      ext(e.cx + e.r, e.cy + e.r)
    } else if (e.k === 't') {
      ext(e.x, e.y)
      ext(e.x + String(e.text || ' ').length * e.h * 0.62, e.y + e.h * 1.3)
    } else if (e.k === 'pt') ext(e.x, e.y)
  }
  if (!isFinite(minX)) {
    minX = 0
    minY = 0
    maxX = 1
    maxY = 1
  }
  return { minX, minY, maxX, maxY, w: maxX - minX || 1, h: maxY - minY || 1 }
}

// ---- detección de láminas dibujadas (marcos DIN-A) ----
function entCenter(e: any): number[] | null {
  if (e.k === 'l') return [(e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2]
  if (e.k === 'p') {
    let sx = 0,
      sy = 0
    for (const p of e.pts) {
      sx += p[0]
      sy += p[1]
    }
    return [sx / e.pts.length, sy / e.pts.length]
  }
  if (e.k === 'c' || e.k === 'a') return [e.cx, e.cy]
  if (e.k === 't' || e.k === 'pt') return [e.x, e.y]
  return null
}

function rectOf(e: any): Bounds | null {
  if (e.k !== 'p' || !e.closed) return null
  const pts = e.pts
  if (pts.length < 4 || pts.length > 5) return null
  if (pts.some((p: number[]) => p[2])) return null
  const xs = pts.map((p: number[]) => p[0]),
    ys = pts.map((p: number[]) => p[1])
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys)
  const w = maxX - minX,
    h = maxY - minY
  if (w <= 0 || h <= 0) return null
  const tol = Math.max(w, h) * 0.002
  const onCorner = pts.every(
    (p: number[]) =>
      (Math.abs(p[0] - minX) < tol || Math.abs(p[0] - maxX) < tol) &&
      (Math.abs(p[1] - minY) < tol || Math.abs(p[1] - maxY) < tol),
  )
  return onCorner ? { minX, minY, maxX, maxY, w, h } : null
}

const FRAME_LAYER_RE = /LAMINA|LÁMINA|MARCO|HOJA|SHEET|FORMATO|CAJETIN|CAJETÍN|NO.?PLOT/i
export const NOPLOT_RE = /NO.?PLOT|DEFPOINTS/i

export function detectFrames(
  model: Model,
  unit: string,
  frameTest?: (l: string) => boolean,
): Frame[] {
  const um = UNIT_MM[unit] || 1000
  const SIZES: Record<string, number[]> = {
    A4: [210, 297],
    A3: [297, 420],
    A2: [420, 594],
    A1: [594, 841],
  }
  const ESC = [10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000]
  const cands: Frame[] = []
  for (const e of model.ents) {
    const r = rectOf(e)
    if (!r) continue
    const ratio = Math.max(r.w, r.h) / Math.min(r.w, r.h)
    if (Math.abs(ratio - Math.SQRT2) > 0.03) continue
    let best: any = null
    outer: for (const size of Object.keys(SIZES)) {
      const dims = SIZES[size]
      for (const N of ESC) {
        const pw = (r.w * um) / N,
          ph = (r.h * um) / N
        if (Math.abs(pw - dims[0]) < dims[0] * 0.02 && Math.abs(ph - dims[1]) < dims[1] * 0.02) {
          best = { size, orient: 'p', escala: N }
          break outer
        }
        if (Math.abs(pw - dims[1]) < dims[1] * 0.02 && Math.abs(ph - dims[0]) < dims[0] * 0.02) {
          best = { size, orient: 'l', escala: N }
          break outer
        }
      }
    }
    if (!best) continue
    let inside = 0
    for (const o of model.ents) {
      if (o === e) continue
      const cc = entCenter(o)
      if (cc && cc[0] > r.minX && cc[0] < r.maxX && cc[1] > r.minY && cc[1] < r.maxY) inside++
    }
    const named = frameTest ? !!frameTest(e.layer || '') : FRAME_LAYER_RE.test(e.layer || '')
    if (!named && inside < 3) continue
    cands.push({ ...r, ...best, inside, named })
  }
  cands.sort((a, b) => a.minX - b.minX || a.minY - b.minY)
  const out: Frame[] = []
  for (const c of cands) {
    if (
      !out.some(
        (o) =>
          Math.abs(o.minX - c.minX) < c.w * 0.02 &&
          Math.abs(o.minY - c.minY) < c.h * 0.02 &&
          Math.abs(o.w - c.w) < c.w * 0.02,
      )
    )
      out.push(c)
  }
  return out
}

// ---- SVG ----
const ACI_EXACT: Record<number, string> = {
  1: '#FF0000',
  2: '#E0B000',
  3: '#00A650',
  4: '#00B0C8',
  5: '#0000FF',
  6: '#FF00FF',
  7: '#17161A',
  8: '#808080',
  9: '#C0C0C0',
  250: '#545454',
  251: '#767676',
  252: '#989898',
  253: '#BABABA',
  254: '#DCDCDC',
  255: '#17161A',
}
function aciToHex(c: number): string {
  if (ACI_EXACT[c]) return ACI_EXACT[c]
  if (c < 10 || c > 249) return '#17161A'
  const i = c - 10
  const h = Math.floor(i / 10) * 15
  const sub = i % 10
  const v = [1, 0.8, 0.6, 0.5, 0.3][sub >> 1]
  const sat = sub & 1 ? 0.5 : 1
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return v - v * sat * Math.max(0, Math.min(k, 4 - k, 1))
  }
  const to2 = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, '0')
  return '#' + to2(f(5)) + to2(f(3)) + to2(f(1))
}
function tcToHex(t: number): string {
  return '#' + (t & 0xffffff).toString(16).padStart(6, '0').toUpperCase()
}
function darkenIfPale(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16),
    g = parseInt(hex.slice(3, 5), 16),
    b = parseInt(hex.slice(5, 7), 16)
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return lum > 0.9 ? '#17161A' : hex
}

let _clipSeq = 0
export function buildSVG(ents: any[], bounds: Bounds, opts: BuildSVGOpts = {}): string {
  const region = opts.region || null
  const b: Bounds = region
    ? {
        minX: region.minX,
        minY: region.minY,
        maxX: region.maxX,
        maxY: region.maxY,
        w: region.maxX - region.minX || 1,
        h: region.maxY - region.minY || 1,
      }
    : bounds
  const sw = opts.stroke || b.w / 600
  const color = opts.color || '#17161A'
  const font = opts.font || "'Archivo','Helvetica Neue',Helvetica,sans-serif"
  const pad = region ? 0 : sw * 2 + Math.max(b.w, b.h) * 0.004
  const vb = `${b.minX - pad} ${-(b.maxY + pad)} ${b.w + pad * 2} ${b.h + pad * 2}`
  const frameTol = Math.max(b.w, b.h) * 0.01
  const isFrameRect = (e: any) => {
    if (!region) return false
    const r = rectOf(e)
    return (
      !!r &&
      Math.abs(r.minX - b.minX) < frameTol &&
      Math.abs(r.maxX - b.maxX) < frameTol &&
      Math.abs(r.minY - b.minY) < frameTol &&
      Math.abs(r.maxY - b.maxY) < frameTol
    )
  }
  const esc = (s: any) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const F = (n: any) => +(+n).toFixed(5)
  let body = ''
  for (const e of ents) {
    if (NOPLOT_RE.test(e.layer || '')) continue
    if (isFrameRect(e)) continue
    let eCol: string | null = null,
      eSw: number | null = null
    if (opts.useLayers) {
      const LS = (opts.layerStyles || {})[e.layer] || null
      if (LS && LS.off) continue
      if (e.tc != null) eCol = darkenIfPale(tcToHex(e.tc))
      else if (e.col) eCol = darkenIfPale(aciToHex(e.col))
      else if (LS && LS.color) eCol = darkenIfPale(aciToHex(LS.color))
      const lwv = e.lw && e.lw > 0 ? e.lw : LS && LS.lw > 0 ? LS.lw : 0
      if (lwv && opts.mmToDU) eSw = (lwv / 100) * opts.mmToDU
    }
    const sa = (eCol ? ` stroke="${eCol}"` : '') + (eSw ? ` stroke-width="${F(eSw)}"` : '')
    const fcol = eCol || color
    if (e.k === 'l')
      body += `<line x1="${F(e.x1)}" y1="${F(e.y1)}" x2="${F(e.x2)}" y2="${F(e.y2)}"${sa}/>`
    else if (e.k === 'c') body += `<circle cx="${F(e.cx)}" cy="${F(e.cy)}" r="${F(e.r)}"${sa}/>`
    else if (e.k === 'a') {
      const s0 = (e.a1 * Math.PI) / 180
      const x1 = e.cx + e.r * Math.cos(s0),
        y1 = e.cy + e.r * Math.sin(s0)
      const t0 = (e.a2 * Math.PI) / 180
      const x2 = e.cx + e.r * Math.cos(t0),
        y2 = e.cy + e.r * Math.sin(t0)
      let sweep = (e.a2 - e.a1) % 360
      if (sweep <= 0) sweep += 360
      const large = sweep > 180 ? 1 : 0
      body += `<path d="M ${F(x1)} ${F(y1)} A ${F(e.r)} ${F(e.r)} 0 ${large} 1 ${F(x2)} ${F(y2)}"${sa}/>`
    } else if (e.k === 'p') {
      const P = e.pts
      const segTo = (p0: number[], p1: number[]) => {
        const bl = p0[2] || 0
        if (!bl) return ` L ${F(p1[0])} ${F(p1[1])}`
        const th = 4 * Math.atan(bl)
        const chord = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        if (!chord) return ''
        const r = Math.abs(chord / (2 * Math.sin(th / 2)))
        const large = Math.abs(th) > Math.PI ? 1 : 0
        const sweep = bl > 0 ? 1 : 0
        return ` A ${F(r)} ${F(r)} 0 ${large} ${sweep} ${F(p1[0])} ${F(p1[1])}`
      }
      let d = `M ${F(P[0][0])} ${F(P[0][1])}`
      for (let q = 1; q < P.length; q++) d += segTo(P[q - 1], P[q])
      if (e.closed) d += segTo(P[P.length - 1], P[0]) + ' Z'
      body += `<path d="${d}"${e.fill ? ` fill="${fcol}" fill-opacity="0.1" stroke="none"` : sa}/>`
    } else if (e.k === 't') {
      const linesT = String(e.text).split('\n')
      const anchor = e.mtext
        ? [2, 5, 8].includes(e.att)
          ? 'middle'
          : [3, 6, 9].includes(e.att)
            ? 'end'
            : 'start'
        : e.ha === 1 || e.ha === 4
          ? 'middle'
          : e.ha === 2
            ? 'end'
            : 'start'
      const fs = e.h * 1.35
      const dy0 = e.mtext
        ? [4, 5, 6].includes(e.att)
          ? e.h * 0.4
          : [7, 8, 9].includes(e.att)
            ? -e.h * 0.25
            : e.h * 1.05
        : 0
      let tsp = ''
      linesT.forEach((ln: string, ix: number) => {
        tsp += `<tspan x="0" dy="${ix === 0 ? F(dy0) : F(e.h * 1.5)}">${esc(ln)}</tspan>`
      })
      body += `<text transform="translate(${F(e.x)} ${F(e.y)}) rotate(${F(
        e.rot || 0,
      )}) scale(1,-1)" font-size="${F(
        fs,
      )}" font-family="${font}" font-weight="500" letter-spacing="${F(
        e.h * 0.06,
      )}" text-anchor="${anchor}" fill="${fcol}" stroke="none">${tsp}</text>`
    } else if (e.k === 'pt') {
      body += `<circle cx="${F(e.x)}" cy="${F(e.y)}" r="${F(sw * 1.5)}" fill="${fcol}" stroke="none"/>`
    }
  }
  const inner = `<g transform="scale(1,-1)" fill="none" stroke="${color}" stroke-width="${F(
    sw,
  )}" stroke-linecap="round" stroke-linejoin="round">${body}</g>`
  if (region) {
    const cid = 'gcclip' + ++_clipSeq
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"><defs><clipPath id="${cid}"><rect x="${F(
      b.minX,
    )}" y="${F(-b.maxY)}" width="${F(b.w)}" height="${F(
      b.h,
    )}"/></clipPath></defs><g clip-path="url(#${cid})">${inner}</g></svg>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">${inner}</svg>`
}

// ---- plano de ejemplo: stand de feria 6×3 m, frente abierto (unidades: metros) ----
export function sampleModel(): Model {
  const E: any[] = []
  const L = (layer: string, x1: number, y1: number, x2: number, y2: number) =>
    E.push({ k: 'l', layer, x1, y1, x2, y2 })
  const Rr = (layer: string, x1: number, y1: number, x2: number, y2: number) =>
    E.push({
      k: 'p',
      layer,
      closed: true,
      pts: [
        [x1, y1, 0],
        [x2, y1, 0],
        [x2, y2, 0],
        [x1, y2, 0],
      ],
    })
  const C = (layer: string, cx: number, cy: number, r: number) => E.push({ k: 'c', layer, cx, cy, r })
  const A = (layer: string, cx: number, cy: number, r: number, a1: number, a2: number) =>
    E.push({ k: 'a', layer, cx, cy, r, a1, a2 })
  const T = (layer: string, x: number, y: number, h: number, text: string, rot?: number) =>
    E.push({ k: 't', layer, x, y, h, rot: rot || 0, text })

  Rr('MUROS', 0, 2.9, 6, 3.0)
  Rr('MUROS', 0, 0, 0.1, 2.9)
  Rr('MUROS', 5.9, 0, 6.0, 2.9)

  L('TARIMA', 0, 0, 6, 0)

  Rr('TABIQUES', 4.6, 1.6, 4.7, 2.9)
  Rr('TABIQUES', 4.7, 1.6, 5.0, 1.7)
  Rr('TABIQUES', 5.7, 1.6, 5.9, 1.7)
  L('CARPINTERIA', 5.0, 1.6, 5.0, 0.9)
  A('CARPINTERIA', 5.0, 1.6, 0.7, 270, 360)

  Rr('MOBILIARIO', 0.4, 0.2, 1.9, 0.7)
  C('MOBILIARIO', 3.2, 1.5, 0.4)
  C('MOBILIARIO', 2.6, 1.15, 0.15)
  C('MOBILIARIO', 3.8, 1.15, 0.15)
  C('MOBILIARIO', 3.2, 2.15, 0.15)
  Rr('MOBILIARIO', 2.2, 2.75, 3.4, 2.9)
  Rr('MOBILIARIO', 0.1, 1.2, 0.45, 2.6)
  Rr('MOBILIARIO', 4.75, 1.75, 5.35, 2.85)

  T('ROTULOS', 1.35, 1.7, 0.14, 'ZONA DE ATENCIÓN')
  T('ROTULOS', 1.55, 1.45, 0.1, '16,3 m²')
  T('ROTULOS', 4.78, 2.45, 0.11, 'ALMACÉN')
  T('ROTULOS', 4.78, 2.25, 0.09, '1,7 m²')
  T('ROTULOS', 0.55, 0.4, 0.09, 'MOSTRADOR')
  T('ROTULOS', 2.45, 2.55, 0.08, 'PANTALLA LED')
  T('ROTULOS', 2.1, 0.08, 0.09, 'TARIMA H = 100 mm')
  T('ROTULOS', 0.36, 1.45, 0.09, 'EXPOSITOR', 90)

  L('COTAS', 0, -0.5, 6, -0.5)
  L('COTAS', 0, -0.6, 0, -0.4)
  L('COTAS', 6, -0.6, 6, -0.4)
  T('COTAS', 2.83, -0.42, 0.14, '6,00')
  L('COTAS', 6.5, 0, 6.5, 3)
  L('COTAS', 6.4, 0, 6.6, 0)
  L('COTAS', 6.4, 3, 6.6, 3)
  T('COTAS', 6.62, 1.35, 0.14, '3,00', 90)

  const bounds = computeBounds(E)
  const layers = [...new Set(E.map((e) => e.layer))] as string[]
  const texts = E.filter((e) => e.k === 't').map((e) => ({ t: e.text, x: e.x, y: e.y, h: e.h }))
  return { ents: E, bounds, layers, texts, unitsGuess: 'm', n: E.length }
}
