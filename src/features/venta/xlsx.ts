// Minimal .xlsx (zip+xml) and CSV/TSV reader for budget tables, ported to TS
// from the prototype's xlsx-lite.js. PDF text extraction is delegated to the
// shared src/lib/pdf.ts (pdfText) by the caller.

async function inflateRaw(u8: Uint8Array): Promise<Uint8Array> {
  const ds = new (window as any).DecompressionStream('deflate-raw')
  const stream = new Blob([u8 as any]).stream().pipeThrough(ds)
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}
const u16 = (u8: Uint8Array, o: number) => u8[o] | (u8[o + 1] << 8)
const u32 = (u8: Uint8Array, o: number) =>
  (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0

interface ZipEntry {
  method: number
  csize: number
  lho: number
}

async function readZip(buf: ArrayBuffer) {
  const u8 = new Uint8Array(buf)
  let eocd = -1
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65536); i--) {
    if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('archivo ZIP no válido')
  const count = u16(u8, eocd + 10)
  let off = u32(u8, eocd + 16)
  const files: Record<string, ZipEntry> = {}
  for (let k = 0; k < count; k++) {
    if (u32(u8, off) !== 0x02014b50) break
    const method = u16(u8, off + 10)
    const csize = u32(u8, off + 20)
    const nlen = u16(u8, off + 28),
      elen = u16(u8, off + 30),
      clen = u16(u8, off + 32)
    const lho = u32(u8, off + 42)
    const name = new TextDecoder().decode(u8.slice(off + 46, off + 46 + nlen))
    files[name] = { method, csize, lho }
    off += 46 + nlen + elen + clen
  }
  async function read(name: string): Promise<string | null> {
    const f = files[name]
    if (!f) return null
    const o = f.lho
    if (u32(u8, o) !== 0x04034b50) return null
    const nlen = u16(u8, o + 26),
      elen = u16(u8, o + 28)
    const start = o + 30 + nlen + elen
    const data = u8.slice(start, start + f.csize)
    const out = f.method === 8 ? await inflateRaw(data) : data
    return new TextDecoder().decode(out)
  }
  return { names: Object.keys(files), read }
}

function colIndex(ref: string): number {
  let c = 0
  for (const ch of ref) {
    const v = ch.charCodeAt(0)
    if (v >= 65 && v <= 90) c = c * 26 + (v - 64)
    else break
  }
  return c - 1
}

export async function parseXLSX(buf: ArrayBuffer): Promise<string[][]> {
  const zip = await readZip(buf)
  const shared: string[] = []
  const ss = await zip.read('xl/sharedStrings.xml')
  if (ss) {
    const doc = new DOMParser().parseFromString(ss, 'application/xml')
    for (const si of Array.from(doc.getElementsByTagName('si'))) {
      let t = ''
      for (const tn of Array.from(si.getElementsByTagName('t'))) t += tn.textContent
      shared.push(t)
    }
  }
  const sheetName =
    zip.names.find((n) => n === 'xl/worksheets/sheet1.xml') ||
    zip.names.find((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
  const xml = sheetName ? await zip.read(sheetName) : null
  if (!xml) throw new Error('no se encontró la hoja de cálculo dentro del .xlsx')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const rows: string[][] = []
  for (const rowEl of Array.from(doc.getElementsByTagName('row'))) {
    const cells: string[] = []
    for (const c of Array.from(rowEl.getElementsByTagName('c'))) {
      const ref = c.getAttribute('r') || ''
      const t = c.getAttribute('t')
      let val = ''
      if (t === 'inlineStr') {
        const is = c.getElementsByTagName('t')[0]
        val = is ? is.textContent || '' : ''
      } else {
        const v = c.getElementsByTagName('v')[0]
        if (v) {
          val = v.textContent || ''
          if (t === 's') val = shared[+val] || ''
        }
      }
      const ci = ref ? colIndex(ref.replace(/\d+/g, '')) : cells.length
      while (cells.length < ci) cells.push('')
      cells.push(String(val))
    }
    if (cells.some((x) => x !== '')) rows.push(cells)
  }
  return rows
}

export function parseDelimited(text: string): string[][] {
  const lines = String(text)
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim() !== '')
  if (!lines.length) return []
  const delim = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ','
  return lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, '')))
}

export function rowsToTable(rows: string[][]): { cols: string[]; rows: string[][] } {
  if (!rows.length) return { cols: ['Concepto', 'Valor'], rows: [] }
  const width = Math.max(...rows.map((r) => r.length))
  const norm = rows.map((r) => {
    const q = [...r]
    while (q.length < width) q.push('')
    return q
  })
  const first = norm[0]
  const headerish =
    first.some((c) => c !== '') && first.every((c) => c === '' || !/^[\d.,€$%\s-]+$/.test(c))
  const cols = first.map((c, i) => (headerish && c ? c : 'Col ' + (i + 1)))
  const body = headerish ? norm.slice(1) : norm
  return { cols, rows: body }
}

export function num(v: unknown): number {
  let s = String(v).trim().replace(/[€$\s]/g, '')
  if (!s) return NaN
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  const n = parseFloat(s)
  return isFinite(n) ? n : NaN
}

export function fmtEUR(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

export function sumLastCol(rows: string[][]): number {
  let sum = 0,
    count = 0
  for (const r of rows) {
    for (let i = r.length - 1; i >= 0; i--) {
      const n = num(r[i])
      if (!isNaN(n)) {
        sum += n
        count++
        break
      }
    }
  }
  return count ? sum : NaN
}
