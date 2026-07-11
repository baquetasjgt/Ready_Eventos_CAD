// Shared types for the Documento de venta editor.

export interface Imagen {
  id: string
  name: string
  desc: string
  src: string
}

export interface CollageItem {
  id: string
  img: string
  x: number
  y: number
  w: number
  rot?: number
  f?: number
  crop?: { t?: number; r?: number; b?: number; l?: number }
}

export interface Bloque {
  kind: 'text' | 'image' | 'rect' | 'logo'
  x: number
  y: number
  w: number
  h: number
  text?: string
  size?: number
  weight?: number
  color?: string
  bg?: string
  align?: string
  mono?: boolean
  lh?: number
  ls?: number
  imgId?: string
}

// A single drawn annotation (line/arrow/label/rect/circle/text) in mm on 297×210.
export interface Anota {
  k: 'l' | 'a' | 'n' | 'r' | 'c' | 't'
  x1?: number
  y1?: number
  x2?: number
  y2?: number
  x?: number
  y?: number
  w?: number
  h?: number
  cx?: number
  cy?: number
  r?: number
  bw?: number
  text?: string
  color?: string
  grosor?: number
  dash?: string
  align?: string
  bold?: boolean
  fill?: string
  border?: boolean
  noBorder?: boolean
}

export interface Slide {
  id: string
  tipo: string
  kicker?: string
  titulo?: string
  texto?: string
  imgs?: string[]
  side?: 'left' | 'right'
  bg?: string
  tr?: Record<number, { s?: number; ox?: number; oy?: number; mask?: string; fx?: string }>
  collage?: CollageItem[]
  bloques?: Bloque[]
  anota?: Anota[]
  planoRef?: unknown
}

export interface Presupuesto {
  titulo: string
  num: string
  fecha: string
  emisor: string
  receptor: string
  cols: string[]
  rows: string[][]
  condiciones: string
  descPct?: number
  ivaPct?: number
  conIva?: boolean
  hideCols?: number[]
  incluir?: boolean
  lv?: (number | undefined)[]
}

export interface VentaPayload {
  fase: string
  tab: string
  datos: Record<string, string>
  imagenes: { id: string; name: string; desc: string; src?: string }[]
  slides: Slide[]
  presupuesto: Presupuesto
  zoom?: number
  seq?: number
}
