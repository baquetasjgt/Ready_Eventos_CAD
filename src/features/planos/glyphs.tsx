import React from 'react'

// Leyenda symbol library (ported from the prototype GLYPH map + glyphEl).
export const LEYSYMS = [
  'linea',
  'linea-discontinua',
  'linea-gruesa',
  'doble-linea',
  'rect',
  'rectfill',
  'rayado',
  'circulo',
  'circulo-relleno',
  'punto',
  'triangulo',
  'cruz',
  'enchufe',
  'acometida',
  'caja-electrica',
  'foco',
]

export const SIM_OPTIONS: { v: string; label: string }[] = [
  { v: 'linea', label: 'Línea' },
  { v: 'linea-discontinua', label: 'Línea discontinua' },
  { v: 'linea-gruesa', label: 'Línea gruesa' },
  { v: 'doble-linea', label: 'Doble línea' },
  { v: 'rect', label: 'Rectángulo' },
  { v: 'rectfill', label: 'Rect. relleno' },
  { v: 'rayado', label: 'Rayado' },
  { v: 'circulo', label: 'Círculo' },
  { v: 'circulo-relleno', label: 'Círculo relleno' },
  { v: 'punto', label: 'Punto' },
  { v: 'triangulo', label: 'Triángulo' },
  { v: 'cruz', label: 'Cruz' },
  { v: 'enchufe', label: 'Enchufe (toma)' },
  { v: 'acometida', label: 'Acometida —M→' },
  { v: 'caja-electrica', label: 'Caja eléctrica' },
  { v: 'foco', label: 'Foco' },
]

const NOG = { gbgi: 'none', gclip: 'none' }
export interface GlyphBox {
  gw: string
  gh: string
  gbg: string
  gbd: string
  gbr: string
  gbgi: string
  gclip: string
}
export const GLYPH: Record<string, GlyphBox> = {
  linea: { ...NOG, gw: '5mm', gh: '0.5mm', gbg: '#17161A', gbd: 'none', gbr: '0' },
  'linea-discontinua': {
    ...NOG,
    gw: '5mm',
    gh: '0.5mm',
    gbg: 'transparent',
    gbd: 'none',
    gbr: '0',
    gbgi: 'repeating-linear-gradient(90deg,#17161A 0 0.9mm,transparent 0.9mm 1.7mm)',
  },
  'linea-gruesa': { ...NOG, gw: '5mm', gh: '1.1mm', gbg: '#17161A', gbd: 'none', gbr: '0' },
  'doble-linea': {
    ...NOG,
    gw: '5mm',
    gh: '1.4mm',
    gbg: 'transparent',
    gbd: 'none',
    gbr: '0',
    gbgi: 'linear-gradient(#17161A 0 22%,transparent 22% 78%,#17161A 78%)',
  },
  rect: { ...NOG, gw: '4.2mm', gh: '2.6mm', gbg: 'transparent', gbd: '0.3mm solid #17161A', gbr: '0' },
  rectfill: { ...NOG, gw: '4.2mm', gh: '2.6mm', gbg: '#17161A', gbd: 'none', gbr: '0' },
  rayado: {
    ...NOG,
    gw: '4.2mm',
    gh: '2.6mm',
    gbg: 'transparent',
    gbd: '0.25mm solid #17161A',
    gbr: '0',
    gbgi: 'repeating-linear-gradient(45deg,#17161A 0 0.3mm,transparent 0.3mm 1.1mm)',
  },
  circulo: {
    ...NOG,
    gw: '2.8mm',
    gh: '2.8mm',
    gbg: 'transparent',
    gbd: '0.3mm solid #17161A',
    gbr: '50%',
  },
  'circulo-relleno': { ...NOG, gw: '2.8mm', gh: '2.8mm', gbg: '#17161A', gbd: 'none', gbr: '50%' },
  punto: { ...NOG, gw: '1.6mm', gh: '1.6mm', gbg: '#17161A', gbd: 'none', gbr: '50%' },
  triangulo: {
    ...NOG,
    gw: '3mm',
    gh: '2.6mm',
    gbg: '#17161A',
    gbd: 'none',
    gbr: '0',
    gclip: 'polygon(50% 0, 100% 100%, 0 100%)',
  },
  cruz: {
    ...NOG,
    gw: '2.8mm',
    gh: '2.8mm',
    gbg: 'transparent',
    gbd: 'none',
    gbr: '0',
    gbgi:
      'linear-gradient(45deg,transparent 42%,#17161A 42% 58%,transparent 58%), linear-gradient(135deg,transparent 42%,#17161A 42% 58%,transparent 58%)',
  },
}

// Vector symbols redrawn as inline SVG (enchufe, acometida, caja eléctrica, foco).
export function glyphEl(sym: string): React.ReactElement | null {
  const st: React.SVGProps<any> = {
    stroke: '#17161A',
    strokeWidth: 1.1,
    fill: 'none',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }
  const S = (kids: React.ReactNode) => (
    <svg viewBox="0 0 20 12" style={{ width: '6.4mm', height: '3.8mm', display: 'block' }}>
      {kids}
    </svg>
  )
  if (sym === 'enchufe')
    return S([
      <line key="a" x1={10} y1={11.4} x2={10} y2={7.2} {...st} />,
      <circle key="b" cx={10} cy={5.7} r={1.5} {...st} />,
      <line key="c" x1={9.2} y1={4.4} x2={6.2} y2={0.9} {...st} />,
      <line key="d" x1={10.8} y1={4.4} x2={13.8} y2={0.9} {...st} />,
    ])
  if (sym === 'acometida')
    return S([
      <line key="a" x1={0.6} y1={6} x2={4.6} y2={6} {...st} />,
      <polyline key="m" points="4.6,9 4.6,3 8.2,7.4 11.8,3 11.8,9" {...st} />,
      <line key="b" x1={11.8} y1={6} x2={17.2} y2={6} {...st} />,
      <polyline key="f" points="15.2,3.4 18.4,6 15.2,8.6" {...st} />,
    ])
  if (sym === 'caja-electrica')
    return S([
      <rect key="r" x={3.5} y={1} width={13} height={10} {...st} />,
      <path key="t" d="M3.5 1 L16.5 1 L3.5 11 Z" fill="#D42B1E" stroke="none" />,
    ])
  if (sym === 'foco')
    return S([
      <rect key="r" x={3} y={1} width={14} height={10} {...st} />,
      <circle key="c" cx={10} cy={6} r={4.6} {...st} />,
    ])
  return null
}
