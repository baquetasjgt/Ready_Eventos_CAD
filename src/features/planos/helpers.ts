// Shared constants + small pure helpers for the Planos editor.
import type { CajStyle } from './types'

export const ACCENT = '#D6197E'
export const SANS = "'Archivo','Helvetica Neue',Helvetica,sans-serif"
export const MONO = "'JetBrains Mono',monospace"

export const GROSOR = 0.16 // línea base (mm en papel)
export const ESTILO_CAPAS = true // 'capas' (respetar colores/grosores del DXF) vs monocromo
export const CAJ_POS: 'inferior' | 'lateral' = 'inferior'
export const PLEGADO = false

export const ESCALAS = [
  10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 2000,
]
export const PAPER: Record<string, [number, number]> = {
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
  A1: [594, 841],
}
export const TIPOS = [
  'Planta general',
  'Alzado lateral 1',
  'Alzado lateral 2',
  'Plano de carpintería',
  'Plano de carpintería 2',
  'Plano de electricidad',
  'Plano de electricidad 2',
  'Plano de rotulación',
  'Plano de rotulación 2',
]

export function pad2(x: any): string {
  return String(x).padStart(2, '0')
}

export function fmtNum(n: number): string {
  const r = Math.round(n * 100) / 100
  return String(r).replace('.', ',')
}

export interface CajTheme {
  fs: number
  h: number
  bg: string
  fg: string
  fg2: string
  bd: string
}
export function cajTheme(cjs: CajStyle): CajTheme {
  const fs = +(cjs.fs || 7.5)
  const h = +(cjs.h || 26)
  const bg = cjs.bg || '#FFFFFF'
  let hx = bg.replace('#', '')
  if (hx.length === 3)
    hx = hx
      .split('')
      .map((c) => c + c)
      .join('')
  const r = parseInt(hx.slice(0, 2), 16) || 255,
    g = parseInt(hx.slice(2, 4), 16) || 255,
    b = parseInt(hx.slice(4, 6), 16) || 255
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  const dark = lum < 0.55
  return {
    fs,
    h,
    bg,
    fg: dark ? '#FFFFFF' : '#17161A',
    fg2: dark ? 'rgba(255,255,255,0.68)' : '#6E6B66',
    bd: dark ? 'rgba(255,255,255,0.85)' : '#17161A',
  }
}

// favoritos de color (compartidos entre proyectos)
const FAVKEY = 'ready-fav-colors'
export function getFavs(): string[] {
  try {
    const raw = localStorage.getItem(FAVKEY)
    let list =
      raw === null ? [] : JSON.parse(raw || '[]').filter((x: string) => /^#[0-9a-fA-F]{6}$/.test(x))
    if (!localStorage.getItem(FAVKEY + '-seeded')) {
      list = [...['#17161A', '#D6197E'].filter((c) => !list.includes(c)), ...list]
      localStorage.setItem(FAVKEY, JSON.stringify(list))
      localStorage.setItem(FAVKEY + '-seeded', '1')
    }
    return list.slice(0, 12)
  } catch (e) {
    return ['#17161A', '#D6197E']
  }
}
export function addFav(c: string) {
  if (!/^#[0-9a-fA-F]{6}$/.test(String(c || ''))) return
  const f = getFavs()
  if (f.includes(c)) return
  f.push(c)
  while (f.length > 12) f.shift()
  try {
    localStorage.setItem(FAVKEY, JSON.stringify(f))
  } catch (e) {}
}
export function delFav(c: string) {
  try {
    localStorage.setItem(FAVKEY, JSON.stringify(getFavs().filter((x) => x !== c)))
  } catch (e) {}
}

export function eyeDrop(cb: (hex: string) => void, onErr: (m: string) => void) {
  const ED = (window as any).EyeDropper
  if (!ED) {
    onErr('El cuentagotas necesita Chrome o Edge actualizados.')
    return
  }
  try {
    new ED()
      .open()
      .then((r: any) => cb(r.sRGBHex))
      .catch(() => {})
  } catch (e) {}
}

// bibliotecas locales (etiquetas / leyendas reutilizables)
export function getNoteLib(): string[] {
  try {
    return JSON.parse(localStorage.getItem('gencad-etiquetas-lib') || '[]')
  } catch (e) {
    return []
  }
}
export function saveNoteLib(lib: string[]) {
  try {
    localStorage.setItem('gencad-etiquetas-lib', JSON.stringify(lib))
  } catch (e) {}
}
export function getLeyLib(): any[] {
  try {
    return JSON.parse(localStorage.getItem('gencad-leyendas-lib') || '[]')
  } catch (e) {
    return []
  }
}
export function saveLeyLib(lib: any[]) {
  try {
    localStorage.setItem('gencad-leyendas-lib', JSON.stringify(lib))
  } catch (e) {}
}

// carga de un fichero de imagen a dataURL (con reescalado)
export async function fileToDataURL(file: File, maxDim = 1600): Promise<string> {
  const url = URL.createObjectURL(file)
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image()
    i.onload = () => res(i)
    i.onerror = () => rej(new Error('imagen no válida'))
    i.src = url
  })
  const sc = Math.min(1, maxDim / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(img.width * sc))
  c.height = Math.max(1, Math.round(img.height * sc))
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  URL.revokeObjectURL(url)
  return file.type === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.86)
}

export function dashOfMm(dash: string | undefined, du: (mm: number) => number): string | undefined {
  return dash === 'dash'
    ? `${du(2)} ${du(1.2)}`
    : dash === 'dot'
      ? `${du(0.35)} ${du(0.9)}`
      : undefined
}
