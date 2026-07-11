import type { Region } from './cad-lib'

export interface ProjectMeta {
  empresa: string
  proyecto: string
  subtitulo: string
  arquitecto: string
  contacto: string
  fecha: string
}

export interface Drawing {
  id: string
  name: string
  unit: string
  sample?: boolean
  pending?: boolean
  raw?: string
}

export interface CajField {
  id: string
  label: string
  src: string
  value: string
}

export interface Nota {
  x1: number
  y1: number
  x2: number
  y2: number
  text: string
  style: string
  color?: string
  fs?: number
  font?: string
  bold?: boolean
  italic?: boolean
}

export interface Zona {
  id: string
  name: string
  src: string
  fit: string
  rot: number
  x: number
  y: number
  w: number
  h: number
  poly?: number[][] | null
  circle?: boolean
}

export interface LeyItem {
  sym: string
  etiqueta: string
  cant?: string
}
export interface Leyenda {
  show: boolean
  titulo?: string
  tam?: number
  items: LeyItem[]
}

export interface Sheet {
  id: string
  drawingId: string
  num: string
  tipo: string
  escala: number
  size: string
  orient: string
  region?: Region | null
  auto?: boolean
  incluir?: boolean
  zonas?: Zona[]
  notas?: Nota[]
  croquis?: any[]
  leyenda?: Leyenda
  capasOcultas?: string[]
  notaFs?: number
}

export interface MemSection {
  titulo: string
  contenido: string
}
export interface Memoria {
  directrices: string
  sections: MemSection[]
  generating?: boolean
  error?: string
}

export interface TableT {
  id: string
  titulo: string
  cols: string[]
  rows: string[][]
}
export interface Anexo {
  id: string
  caption: string
  src?: string
}

export interface Secciones {
  portada: boolean
  indice: boolean
  memoria: boolean
  tablas: boolean
  anexos: boolean
}
export interface CajStyle {
  fs: number
  h: number
  bg: string
}
export interface CapasCfg {
  marcos: string
  rotulos: string
}

export interface Doc {
  project: ProjectMeta
  drawings: Drawing[]
  sheets: Sheet[]
  memoria: Memoria
  tables: TableT[]
  anexos: Anexo[]
  secciones: Secciones
  cajetin: CajField[]
  cajStyle: CajStyle
  capasCfg: CapasCfg
  seq: number
}

export interface DrawStyle {
  color: string
  grosor: number
  dash: string
  fs: number
  align: string
  bold: boolean
  fill: string
  noBorder: boolean
  tFill: string
  tBorder: boolean
}
