// Shared persistence layer. The three apps (Inicio CRM, Documento de venta,
// Generador CAD) interoperate through these exact localStorage keys and the
// IndexedDB store, mirroring the original prototype so a project opened from
// Inicio lands in the right document already assigned.

export const KEYS = {
  projects: 'ready-projects-v1',
  clientes: 'ready-clientes-v1',
  ferias: 'ready-ferias-v1',
  proveedores: 'ready-proveedores-v1',
  // per-app project registries + per-project payloads
  planosList: 'gencad-projects',
  ventaList: 'gencad-venta-projects',
  planos: (id: string) => `gencad-p-${id}`,
  venta: (id: string) => `gencad-venta-p-${id}`,
} as const

// ---- Types ----
export interface Contacto {
  nombre: string
  cargo: string
  telefono: string
  email: string
}

export interface HistEntry {
  e: string
  t: number
}

export interface Project {
  id: string
  name: string
  estado: string
  clienteId?: string
  feriaId?: string
  provIds?: string[]
  created: number
  hist?: HistEntry[]
}

export interface Cliente {
  id: string
  nombre: string
  web: string
  // legacy single-contact fields (migrated to contactos)
  contacto?: string
  email?: string
  telefono?: string
  contactos?: Contacto[]
  notas: string
  created: number
}

export interface FeriaDoc {
  id: string
  name: string
  chars: number
}

export interface Feria {
  id: string
  nombre: string
  recinto: string
  fechas: string
  web: string
  contactos?: Contacto[]
  docs?: FeriaDoc[]
  created: number
}

export interface Proveedor {
  id: string
  nombre: string
  especialidad: string
  web: string
  notas: string
  contactos?: Contacto[]
  created: number
}

// ---- localStorage helpers ----
export function read<T = any>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}

// Optional write-through hook installed by the sync engine (src/lib/sync.ts).
// Lets local writes mirror to Supabase without the components knowing about it.
let writeHook: ((key: string, value: unknown) => void) | null = null
export function setWriteHook(fn: ((key: string, value: unknown) => void) | null): void {
  writeHook = fn
}

export function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota — ignore, matches prototype */
  }
  try {
    writeHook?.(key, value)
  } catch {
    /* sync errors must never break local writes */
  }
}

// Write to localStorage only, bypassing the sync hook. Used by the sync engine
// when hydrating local state from the cloud (so a pull doesn't echo back as a push).
export function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

// ---- IndexedDB for feria normativa PDFs ----
let idbP: Promise<IDBDatabase> | null = null
function idb(): Promise<IDBDatabase> {
  if (idbP) return idbP
  idbP = new Promise((res, rej) => {
    const rq = indexedDB.open('ready-crm-docs', 1)
    rq.onupgradeneeded = () => rq.result.createObjectStore('docs')
    rq.onsuccess = () => res(rq.result)
    rq.onerror = () => rej(rq.error)
  })
  return idbP
}

export interface StoredDoc {
  name: string
  blob: Blob
  text: string
}

export async function idbSet(key: string, val: StoredDoc): Promise<void> {
  try {
    const db = await idb()
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('docs', 'readwrite')
      tx.objectStore('docs').put(val, key)
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
    })
  } catch {
    /* ignore */
  }
}

export async function idbGet(key: string): Promise<StoredDoc | undefined> {
  try {
    const db = await idb()
    return await new Promise<StoredDoc | undefined>((res, rej) => {
      const rq = db.transaction('docs').objectStore('docs').get(key)
      rq.onsuccess = () => res(rq.result)
      rq.onerror = () => rej(rq.error)
    })
  } catch {
    return undefined
  }
}

export async function idbDel(key: string): Promise<void> {
  try {
    const db = await idb()
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('docs', 'readwrite')
      tx.objectStore('docs').delete(key)
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
    })
  } catch {
    /* ignore */
  }
}
