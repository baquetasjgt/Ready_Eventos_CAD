import React from 'react'
import { ACCENT } from './helpers'
import { fmtNum } from './helpers'
import type { Sheet } from './types'

// Ported from Component.mkOverlay — the interactive SVG that sits on top of the
// plan and renders croquis, rotulación zones, etiquetas (labels), selection
// highlights, marquee and pending-note guides.

export interface OverlayState {
  sketchSel: { shId: string; idx: number } | null
  sketchGhost: any
  zoneEdit: string | null
  zoneSel: { shId: string; idx: number } | null
  zoneGhost: any
  noteSel: { shId: string; idxs: number[] } | null
  noteAdding: boolean
  notePend: { shId: string; pt: number[] } | null
  hoverPt: { shId: string; p: number[] } | null
  marquee: any
  selEnt: { shId: string; dId: string; idx: number } | null
  tool: string | null
}

export interface OverlayHandlers {
  zoneClick: (ev: any) => void
  zoneDown: (ev: any) => void
  zoneUp: () => void
  zoneMove: (ev: any) => void
  planClick: (ev: any) => void
  planDown: (ev: any) => void
  planUp: () => void
  planMove: (ev: any) => void
}

export function renderOverlay(
  sh: Sheet,
  d: any,
  m: any,
  vb: { x: number; y: number; w: number; h: number },
  mm2du: number,
  active: boolean,
  s: OverlayState,
  h: OverlayHandlers,
): React.ReactElement {
  const acc = ACCENT
  const du = (mm: number) => mm * mm2du
  const F = (n: any) => +(+n).toFixed(4)
  const kids: React.ReactNode[] = []

  const skSelIdx = s.sketchSel && s.sketchSel.shId === sh.id ? s.sketchSel.idx : -1
  const arrowHead = (key: string, x1: number, y1: number, x2: number, y2: number, col: string, size: number) => {
    const ang = Math.atan2(y2 - y1, x2 - x1)
    const cs = Math.cos(ang),
      sn = Math.sin(ang)
    const bx = x2 - cs * size,
      by = y2 - sn * size
    return (
      <polygon
        key={key}
        points={`${F(x2)},${F(y2)} ${F(bx - sn * size * 0.42)},${F(by + cs * size * 0.42)} ${F(
          bx + sn * size * 0.42,
        )},${F(by - cs * size * 0.42)}`}
        fill={col}
        stroke="none"
      />
    )
  }
  const wrapLines = (raw: string, bw: number, fs: number) => {
    const out: string[] = []
    for (const para of String(raw || '').split('\n')) {
      const words = para.split(/\s+/).filter(Boolean)
      if (!words.length) {
        out.push('')
        continue
      }
      let cur = ''
      for (const w0 of words) {
        const cand = cur ? cur + ' ' + w0 : w0
        if (cand.length * fs * 0.55 > bw && cur) {
          out.push(cur)
          cur = w0
        } else cur = cand
      }
      out.push(cur)
    }
    return out
  }
  const textEl = (key: string, e: any, col: string, sel: boolean) => {
    const fs = e.h || du(3.5)
    const lines = e.bw ? wrapLines(e.text, e.bw, fs) : String(e.text || '').split('\n')
    const anchor = e.align === 'center' ? 'middle' : e.align === 'right' ? 'end' : 'start'
    const ax = e.bw ? (e.align === 'center' ? e.bw / 2 : e.align === 'right' ? e.bw : 0) : 0
    const g: React.ReactNode[] = []
    if (e.fill || e.border) {
      const lw = e.bw || Math.max(...lines.map((l) => l.length), 1) * fs * 0.58
      const pad = fs * 0.35
      g.push(
        <rect
          key="bg"
          x={F(e.x - pad)}
          y={F(e.y - (lines.length - 1) * fs * 1.25 - fs * 0.35 - pad)}
          width={F(lw + pad * 2)}
          height={F((lines.length - 1) * fs * 1.25 + fs * 1.25 + pad * 2)}
          fill={e.fill || 'none'}
          stroke={e.border ? col : 'none'}
          strokeWidth={du(0.25)}
        />,
      )
    }
    g.push(
      <text
        key="tx"
        transform={`translate(${F(e.x)} ${F(e.y)}) scale(1,-1)`}
        fontSize={fs}
        fontFamily="'Archivo',sans-serif"
        fontWeight={e.bold ? 800 : 600}
        fontStyle={e.italic ? 'italic' : 'normal'}
        textAnchor={anchor}
        fill={col}
        stroke="#FFFFFF"
        strokeWidth={fs * 0.12}
        paintOrder="stroke"
      >
        {lines.map((ln, li) => (
          <tspan key={li} x={F(ax)} dy={li === 0 ? 0 : fs * 1.25}>
            {ln || ' '}
          </tspan>
        ))}
      </text>,
    )
    if (sel && e.bw) {
      g.push(
        <rect
          key="bx"
          data-noprint="1"
          x={F(e.x)}
          y={F(e.y - (lines.length - 1) * fs * 1.25 - fs * 0.35)}
          width={F(e.bw)}
          height={F((lines.length - 1) * fs * 1.25 + fs * 1.25)}
          fill="none"
          stroke={col}
          strokeWidth={du(0.15)}
          strokeDasharray={`${du(1)} ${du(0.8)}`}
        />,
      )
    }
    return <g key={key}>{g}</g>
  }
  const dashOf = (e2: any) =>
    e2.dash === 'dash' ? `${du(2)} ${du(1.2)}` : e2.dash === 'dot' ? `${du(0.35)} ${du(0.9)}` : undefined
  const dimEl = (key: string, e: any, col: string) => {
    const dx = e.x2 - e.x1,
      dy = e.y2 - e.y1
    const L = Math.hypot(dx, dy) || 0.0001
    const ux = dx / L,
      uy = dy / L,
      nx = -uy,
      ny = ux
    const off = e.off || du(8)
    const d1x = e.x1 + nx * off,
      d1y = e.y1 + ny * off
    const d2x = e.x2 + nx * off,
      d2y = e.y2 + ny * off
    const sw = du(0.22),
      tick = du(0.9)
    const g: React.ReactNode[] = [
      <line key="e1" x1={F(e.x1)} y1={F(e.y1)} x2={F(d1x + nx * du(1))} y2={F(d1y + ny * du(1))} stroke={col} strokeWidth={sw} />,
      <line key="e2" x1={F(e.x2)} y1={F(e.y2)} x2={F(d2x + nx * du(1))} y2={F(d2y + ny * du(1))} stroke={col} strokeWidth={sw} />,
      <line key="dl" x1={F(d1x)} y1={F(d1y)} x2={F(d2x)} y2={F(d2y)} stroke={col} strokeWidth={sw} />,
      <line key="t1" x1={F(d1x - (ux + nx) * tick * 0.7)} y1={F(d1y - (uy + ny) * tick * 0.7)} x2={F(d1x + (ux + nx) * tick * 0.7)} y2={F(d1y + (uy + ny) * tick * 0.7)} stroke={col} strokeWidth={du(0.32)} />,
      <line key="t2" x1={F(d2x - (ux + nx) * tick * 0.7)} y1={F(d2y - (uy + ny) * tick * 0.7)} x2={F(d2x + (ux + nx) * tick * 0.7)} y2={F(d2y + (uy + ny) * tick * 0.7)} stroke={col} strokeWidth={du(0.32)} />,
    ]
    let rot = (Math.atan2(dy, dx) * 180) / Math.PI
    if (rot > 90.001 || rot < -90.001) rot += 180
    const mx = (d1x + d2x) / 2 + nx * du(1.1)
    const my = (d1y + d2y) / 2 + ny * du(1.1)
    g.push(
      <text
        key="tx"
        transform={`translate(${F(mx)} ${F(my)}) rotate(${F(rot)}) scale(1,-1)`}
        fontSize={du(2.6)}
        fontFamily="'JetBrains Mono',monospace"
        fontWeight={600}
        textAnchor="middle"
        fill={col}
        stroke="#FFFFFF"
        strokeWidth={du(0.35)}
        paintOrder="stroke"
      >
        {fmtNum(L) + ' ' + (d ? d.unit : 'm')}
      </text>,
    )
    return <g key={key}>{g}</g>
  }

  // ---- croquis (formas dibujadas a mano, imprimibles) ----
  ;(sh.croquis || []).forEach((e: any, i: number) => {
    const sel = i === skSelIdx
    const col = sel ? acc : e.color || '#17161A'
    const st: React.SVGProps<any> = {
      stroke: col,
      strokeWidth: du(e.grosor || 0.35),
      fill: 'none',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeDasharray: dashOf(e),
    }
    const stFill: React.SVGProps<any> = {
      ...st,
      fill: e.fill || 'none',
      stroke: e.noBorder ? (sel ? acc : 'none') : col,
      strokeDasharray: e.noBorder && sel ? `${du(1)} ${du(0.8)}` : dashOf(e),
      strokeWidth: e.noBorder && sel ? du(0.15) : du(e.grosor || 0.35),
    }
    if (e.k === 'l') kids.push(<line key={'ck' + i} x1={F(e.x1)} y1={F(e.y1)} x2={F(e.x2)} y2={F(e.y2)} {...st} />)
    else if (e.k === 'r') kids.push(<rect key={'ck' + i} x={F(e.x)} y={F(e.y)} width={F(e.w)} height={F(e.h)} {...stFill} />)
    else if (e.k === 'c') kids.push(<circle key={'ck' + i} cx={F(e.cx)} cy={F(e.cy)} r={F(e.r)} {...stFill} />)
    else if (e.k === 't') kids.push(textEl('ck' + i, e, col, sel))
    else if (e.k === 'a')
      kids.push(
        <g key={'ck' + i}>
          <line x1={F(e.x1)} y1={F(e.y1)} x2={F(e.x2)} y2={F(e.y2)} {...st} />
          {arrowHead('ah', e.x1, e.y1, e.x2, e.y2, col, du(2.2) * Math.max(1, ((e.grosor || 0.35) / 0.35) * 0.75))}
        </g>,
      )
    else if (e.k === 'd') kids.push(dimEl('ck' + i, e, col))
  })
  if (s.sketchGhost && s.sketchGhost.shId === sh.id) {
    const g0 = s.sketchGhost
    const gst: React.SVGProps<any> = {
      'data-noprint': '1' as any,
      stroke: acc,
      strokeWidth: du(0.3),
      fill: 'none',
      strokeDasharray: `${du(1)} ${du(0.7)}`,
    }
    if (g0.kind === 'l' || g0.kind === 'a')
      kids.push(<line key="ckg" x1={F(g0.x0)} y1={F(g0.y0)} x2={F(g0.x1)} y2={F(g0.y1)} {...gst} />)
    else if (g0.kind === 'd')
      kids.push(<g key="ckg" data-noprint="1">{dimEl('ckgd', { x1: g0.x0, y1: g0.y0, x2: g0.x1, y2: g0.y1, off: du(8) }, acc)}</g>)
    else if (g0.kind === 'r' || g0.kind === 't')
      kids.push(<rect key="ckg" x={F(Math.min(g0.x0, g0.x1))} y={F(Math.min(g0.y0, g0.y1))} width={F(Math.abs(g0.x1 - g0.x0))} height={F(Math.abs(g0.y1 - g0.y0))} {...gst} />)
    else if (g0.kind === 'c')
      kids.push(<circle key="ckg" cx={F(g0.x0)} cy={F(g0.y0)} r={F(Math.hypot(g0.x1 - g0.x0, g0.y1 - g0.y0) || 0.0001)} {...gst} />)
  }

  // ---- zonas de rotulación ----
  const zoneActive0 = s.zoneEdit === sh.id
  ;(sh.zonas || []).forEach((z: any, i: number) => {
    if (z.w === undefined) return
    const selZ = zoneActive0 && s.zoneSel && s.zoneSel.shId === sh.id && s.zoneSel.idx === i
    const cid = 'zclip-' + sh.id + '-' + i
    const parts: React.ReactNode[] = []
    if (z.src) {
      const par = z.fit === 'contain' ? 'xMidYMid meet' : z.fit === 'stretch' ? 'none' : 'xMidYMid slice'
      const rot = +z.rot || 0
      const img = (
        <image
          href={z.src}
          x={0}
          y={0}
          width={F(z.w)}
          height={F(z.h)}
          preserveAspectRatio={par}
          transform={rot ? `translate(${F(z.w / 2)} ${F(z.h / 2)}) rotate(${rot}) translate(${F(-z.w / 2)} ${F(-z.h / 2)})` : undefined}
        />
      )
      const flip = (
        <g key="f">
          <g transform={`translate(${F(z.x)} ${F(z.y + z.h)}) scale(1,-1)`}>{img}</g>
        </g>
      )
      let clip: React.ReactNode = null
      if (z.poly)
        clip = (
          <clipPath key="cp" id={cid}>
            <polygon points={z.poly.map((p: number[]) => `${F(p[0])},${F(p[1])}`).join(' ')} />
          </clipPath>
        )
      else if (z.circle)
        clip = (
          <clipPath key="cp" id={cid}>
            <ellipse cx={F(z.x + z.w / 2)} cy={F(z.y + z.h / 2)} rx={F(z.w / 2)} ry={F(z.h / 2)} />
          </clipPath>
        )
      parts.push(
        clip ? (
          <g key="im" clipPath={`url(#${cid})`}>
            {clip}
            {flip}
          </g>
        ) : (
          flip
        ),
      )
    } else if (zoneActive0) {
      parts.push(<rect key="ph" data-noprint="1" x={F(z.x)} y={F(z.y)} width={F(z.w)} height={F(z.h)} fill="rgba(214,25,126,0.05)" stroke="#B0447E" strokeWidth={du(0.2)} strokeDasharray={`${du(1)} ${du(0.7)}`} />)
      parts.push(
        <text key="nm" data-noprint="1" transform={`translate(${F(z.x + z.w / 2)} ${F(z.y + z.h / 2 - du(1))}) scale(1,-1)`} fontSize={du(2.2)} fontFamily="'JetBrains Mono',monospace" textAnchor="middle" fill="#B0447E">
          {(z.name || 'zona') + ' — sin gráfico'}
        </text>,
      )
    }
    if (selZ) {
      parts.push(<rect key="sel" data-noprint="1" x={F(z.x)} y={F(z.y)} width={F(z.w)} height={F(z.h)} fill="none" stroke={acc} strokeWidth={du(0.3)} />)
      parts.push(<rect key="h" data-noprint="1" x={F(z.x + z.w - du(1))} y={F(z.y - du(1))} width={F(du(2))} height={F(du(2))} fill="#FFFFFF" stroke={acc} strokeWidth={du(0.25)} cursor="nwse-resize" />)
    }
    if (parts.length) kids.push(<g key={'z' + i}>{parts}</g>)
  })
  if (s.zoneGhost && s.zoneGhost.shId === sh.id) {
    const zg = s.zoneGhost
    kids.push(<rect key="zg" data-noprint="1" x={F(Math.min(zg.x0, zg.x1))} y={F(Math.min(zg.y0, zg.y1))} width={F(Math.abs(zg.x1 - zg.x0))} height={F(Math.abs(zg.y1 - zg.y0))} fill="rgba(214,25,126,0.07)" stroke={acc} strokeWidth={du(0.2)} strokeDasharray={`${du(1)} ${du(0.7)}`} />)
  }

  // ---- etiquetas (notas) ----
  const fsMM = +(sh.notaFs || 2.4)
  let balN = 0
  ;(sh.notas || []).forEach((n: any, i: number) => {
    const st = n.style || 'dot'
    const selN = !!(s.noteSel && s.noteSel.shId === sh.id && (s.noteSel.idxs || []).includes(i))
    const col = selN ? acc : n.color || '#17161A'
    if (st === 'norte' || st === 'corte') {
      const ang = Math.atan2(n.y2 - n.y1, n.x2 - n.x1)
      const cs = Math.cos(ang),
        sn = Math.sin(ang)
      const g: React.ReactNode[] = []
      if (st === 'norte') {
        const r0 = du(3.2)
        g.push(<circle key="c" cx={F(n.x1)} cy={F(n.y1)} r={r0} fill="none" stroke={col} strokeWidth={du(0.25)} />)
        g.push(<line key="l" x1={F(n.x1 - cs * r0)} y1={F(n.y1 - sn * r0)} x2={F(n.x1 + cs * r0)} y2={F(n.y1 + sn * r0)} stroke={col} strokeWidth={du(0.22)} />)
        const bx0 = n.x1 + cs * (r0 - du(1.8)),
          by0 = n.y1 + sn * (r0 - du(1.8))
        g.push(<polygon key="ah" points={`${F(n.x1 + cs * r0)},${F(n.y1 + sn * r0)} ${F(bx0 - sn * du(0.7))},${F(by0 + cs * du(0.7))} ${F(bx0 + sn * du(0.7))},${F(by0 - cs * du(0.7))}`} fill={col} />)
        g.push(
          <text key="t" transform={`translate(${F(n.x1 + cs * (r0 + du(2.4)))} ${F(n.y1 + sn * (r0 + du(2.4)) - du(1))}) scale(1,-1)`} fontSize={du(2.6)} fontFamily="'Archivo',sans-serif" fontWeight={700} textAnchor="middle" fill={col} stroke="#FFFFFF" strokeWidth={du(0.4)} paintOrder="stroke">
            N
          </text>,
        )
      } else {
        const r0 = du(2.4)
        const letra = (String(n.text || '').trim().charAt(0) || 'A').toUpperCase()
        g.push(<circle key="c" cx={F(n.x1)} cy={F(n.y1)} r={r0} fill="#FFFFFF" stroke={col} strokeWidth={du(0.3)} />)
        g.push(
          <text key="lt" transform={`translate(${F(n.x1)} ${F(n.y1 - du(0.9))}) scale(1,-1)`} fontSize={du(2.3)} fontFamily="'Archivo',sans-serif" fontWeight={700} textAnchor="middle" fill={col}>
            {letra}
          </text>,
        )
        const tipx = n.x1 + cs * (r0 + du(4)),
          tipy = n.y1 + sn * (r0 + du(4))
        g.push(<line key="l" x1={F(n.x1 + cs * r0)} y1={F(n.y1 + sn * r0)} x2={F(tipx)} y2={F(tipy)} stroke={col} strokeWidth={du(0.5)} />)
        const bx0 = tipx - cs * du(1.6),
          by0 = tipy - sn * du(1.6)
        g.push(<polygon key="ah" points={`${F(tipx)},${F(tipy)} ${F(bx0 - sn * du(0.8))},${F(by0 + cs * du(0.8))} ${F(bx0 + sn * du(0.8))},${F(by0 - cs * du(0.8))}`} fill={col} />)
      }
      kids.push(<g key={'n' + i}>{g}</g>)
      return
    }
    if (st === 'balloon') {
      balN++
      const r0 = du(2.1)
      kids.push(
        <g key={'n' + i}>
          <circle cx={F(n.x1)} cy={F(n.y1)} r={r0} fill="#FFFFFF" stroke={col} strokeWidth={du(0.28)} />
          <text transform={`translate(${F(n.x1)} ${F(n.y1 - du(0.8))}) scale(1,-1)`} fontSize={du(2.1)} fontFamily="'JetBrains Mono',monospace" fontWeight={600} textAnchor="middle" fill={col}>
            {String(balN)}
          </text>
        </g>,
      )
      return
    }
    const right = n.x2 >= n.x1
    const txt = String(n.text || '').toUpperCase()
    const fs = du(+(n.fs || fsMM))
    const fontFam = n.font === 'mono' ? "'JetBrains Mono',monospace" : n.font === 'serif' ? "Georgia,'Times New Roman',serif" : "'Archivo','Helvetica Neue',Helvetica,sans-serif"
    const fw = n.bold ? 700 : 500
    const tail = Math.max(du(5), txt.length * fs * (n.bold ? 0.78 : 0.72) + du(2))
    const x3 = n.x2 + (right ? tail : -tail)
    const parts: React.ReactNode[] = []
    if (st !== 'none') {
      if (st === 'curve') {
        parts.push(<path key="l" d={`M ${F(n.x1)} ${F(n.y1)} Q ${F(n.x1)} ${F(n.y2)} ${F(n.x2)} ${F(n.y2)} L ${F(x3)} ${F(n.y2)}`} fill="none" stroke={col} strokeWidth={du(0.18)} />)
      } else {
        parts.push(<polyline key="l" points={`${F(n.x1)},${F(n.y1)} ${F(n.x2)},${F(n.y2)} ${F(x3)},${F(n.y2)}`} fill="none" stroke={col} strokeWidth={du(0.18)} strokeLinejoin="round" />)
      }
      if (st === 'arrow') {
        const ang = Math.atan2(n.y1 - n.y2, n.x1 - n.x2)
        const L = du(1.7),
          Wd = du(0.55)
        const bx0 = n.x1 - L * Math.cos(ang),
          by0 = n.y1 - L * Math.sin(ang)
        const px = -Math.sin(ang),
          py = Math.cos(ang)
        parts.push(<polygon key="ah" points={`${F(n.x1)},${F(n.y1)} ${F(bx0 + px * Wd)},${F(by0 + py * Wd)} ${F(bx0 - px * Wd)},${F(by0 - py * Wd)}`} fill={col} />)
      } else {
        parts.push(<circle key="d" cx={F(n.x1)} cy={F(n.y1)} r={du(0.5)} fill={col} />)
      }
    }
    parts.push(
      <text
        key="t"
        transform={`translate(${F(n.x2 + (right ? du(1) : -du(1)))} ${F(n.y2 + du(1.1))}) scale(1,-1)`}
        fontSize={fs}
        fontFamily={fontFam}
        fontWeight={fw}
        fontStyle={n.italic || !txt ? 'italic' : 'normal'}
        letterSpacing={n.font === 'mono' ? 0 : fs * 0.14}
        textAnchor={right ? 'start' : 'end'}
        fill={txt ? col : '#B4B0A8'}
        stroke="#FFFFFF"
        strokeWidth={fs * 0.18}
        paintOrder="stroke"
        strokeLinejoin="round"
        {...(txt ? {} : { 'data-noprint': '1' })}
      >
        {txt || 'escribe el texto…'}
      </text>,
    )
    kids.push(<g key={'n' + i}>{parts}</g>)
  })

  // ---- marquee ----
  if (s.marquee && s.marquee.shId === sh.id) {
    const q = s.marquee
    kids.push(<rect key="mq" data-noprint="1" x={F(Math.min(q.x0, q.x1))} y={F(Math.min(q.y0, q.y1))} width={F(Math.abs(q.x1 - q.x0))} height={F(Math.abs(q.y1 - q.y0))} fill="rgba(214,25,126,0.07)" stroke={acc} strokeWidth={du(0.18)} strokeDasharray={`${du(1)} ${du(0.7)}`} />)
  }
  // ---- pending note guide ----
  if (s.notePend && s.notePend.shId === sh.id) {
    const p = s.notePend.pt
    const hov = s.hoverPt && s.hoverPt.shId === sh.id ? s.hoverPt : null
    kids.push(
      <g key="np" data-noprint="1">
        <circle key="c" cx={F(p[0])} cy={F(p[1])} r={du(0.55)} fill={acc} />
        {hov && hov.p ? <line key="l" x1={F(p[0])} y1={F(p[1])} x2={F(hov.p[0])} y2={F(hov.p[1])} stroke={acc} strokeWidth={du(0.18)} /> : null}
      </g>,
    )
  }

  const zA = zoneActive0
  return (
    <svg
      viewBox={`${F(vb.x)} ${F(vb.y)} ${F(vb.w)} ${F(vb.h)}`}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 6,
        pointerEvents: active || zA ? 'auto' : 'none',
        cursor: zA ? 'crosshair' : active ? (s.noteAdding || String(s.tool || '').indexOf('draw-') === 0 ? 'crosshair' : 'default') : 'default',
      }}
      onClick={zA ? h.zoneClick : active ? h.planClick : undefined}
      onMouseDown={zA ? h.zoneDown : active ? h.planDown : undefined}
      onMouseUp={zA ? h.zoneUp : active ? h.planUp : undefined}
      onMouseMove={zA ? h.zoneMove : active ? h.planMove : undefined}
    >
      <g transform="scale(1,-1)">{kids}</g>
    </svg>
  )
}
