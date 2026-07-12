// Sync engine: keeps the app's local storage (the working copy the CRM and the
// two editors already use) mirrored with Supabase — pull on login, push on
// change. The components stay unchanged; this layer bridges them to the cloud.

import { KEYS, read, writeLocal, setWriteHook } from './storage'
import { supabase, supabaseReady } from './supabase'

// ---- table <-> local mappers ----
const CLIENTE_COLS = ['id', 'nombre', 'web', 'contacto', 'email', 'telefono', 'contactos', 'notas', 'created']
const FERIA_COLS = ['id', 'nombre', 'recinto', 'fechas', 'web', 'contactos', 'created']
const PROV_COLS = ['id', 'nombre', 'especialidad', 'web', 'notas', 'contactos', 'created']

const pick = (obj: any, cols: string[]) => {
  const o: any = {}
  for (const c of cols) o[c] = obj?.[c] ?? (c === 'contactos' ? [] : c === 'created' ? null : '')
  return o
}

const proyectoToRow = (p: any) => ({
  id: p.id,
  name: p.name ?? '',
  estado: p.estado ?? 'Concepto presentado',
  cliente_id: p.clienteId || null,
  feria_id: p.feriaId || null,
  prov_ids: p.provIds || [],
  hist: p.hist || [],
  created: p.created ?? null,
})
const rowToProyecto = (r: any) => ({
  id: r.id,
  name: r.name ?? '',
  estado: r.estado ?? 'Concepto presentado',
  clienteId: r.cliente_id || '',
  feriaId: r.feria_id || '',
  provIds: r.prov_ids || [],
  hist: r.hist || [],
  created: r.created ?? undefined,
})

interface ListSpec {
  key: string
  table: string
  toRow: (x: any) => any
  fromRow: (x: any, prevById: Record<string, any>) => any
}
const notaToRow = (n: any) => ({
  id: n.id, project_id: n.projectId || '', autor: n.autor || '', texto: n.texto || '',
  created: n.created ?? null, edited: n.edited ?? null,
})
const rowToNota = (r: any) => ({
  id: r.id, projectId: r.project_id || '', autor: r.autor || '', texto: r.texto || '',
  created: r.created ?? undefined, edited: r.edited ?? undefined,
})
const tareaToRow = (t: any) => ({
  id: t.id, titulo: t.titulo || '', detalle: t.detalle || '', project_id: t.projectId || null,
  asignada: t.asignada || '', autor: t.autor || '', estado: t.estado || 'pendiente',
  prioridad: t.prioridad || 'normal', vence: t.vence || null,
  created: t.created ?? null, done_at: t.doneAt ?? null, review: t.review ?? null,
})
const rowToTarea = (r: any) => ({
  id: r.id, titulo: r.titulo || '', detalle: r.detalle || '', projectId: r.project_id || '',
  asignada: r.asignada || '', autor: r.autor || '', estado: r.estado || 'pendiente',
  prioridad: r.prioridad || 'normal', vence: r.vence || '',
  created: r.created ?? undefined, doneAt: r.done_at ?? undefined, review: r.review ?? undefined,
})
const revToRow = (v: any) => ({
  id: v.id, project_id: v.projectId || '', app: v.app || 'venta', page_id: v.pageId || '',
  kind: v.kind || 'postit', tarea_id: v.tareaId || null, autor: v.autor || '',
  created: v.created ?? null,
  data: { x: v.x, y: v.y, color: v.color, texto: v.texto, tool: v.tool, pts: v.pts, postitId: v.postitId },
})
const rowToRev = (r: any) => ({
  id: r.id, projectId: r.project_id || '', app: r.app || 'venta', pageId: r.page_id || '',
  kind: r.kind || 'postit', tareaId: r.tarea_id || undefined, autor: r.autor || '',
  created: r.created ?? undefined, ...(r.data || {}),
})

const LISTS: ListSpec[] = [
  { key: KEYS.clientes, table: 'clientes', toRow: (x) => pick(x, CLIENTE_COLS), fromRow: (r) => r },
  {
    key: KEYS.ferias,
    table: 'ferias',
    toRow: (x) => pick(x, FERIA_COLS),
    // preserve device-local doc metadata (files sync in a later phase)
    fromRow: (r, prev) => ({ ...r, docs: prev[r.id]?.docs || [] }),
  },
  { key: KEYS.proveedores, table: 'proveedores', toRow: (x) => pick(x, PROV_COLS), fromRow: (r) => r },
  { key: KEYS.projects, table: 'proyectos', toRow: proyectoToRow, fromRow: rowToProyecto },
  { key: KEYS.notas, table: 'notas', toRow: notaToRow, fromRow: rowToNota },
  { key: KEYS.tareas, table: 'tareas', toRow: tareaToRow, fromRow: rowToTarea },
  { key: KEYS.revisiones, table: 'revisiones', toRow: revToRow, fromRow: rowToRev },
]

const VENTA_PREFIX = KEYS.venta('')
const PLANOS_PREFIX = KEYS.planos('')

function docKeyInfo(key: string): { id: string; col: 'venta' | 'planos' } | null {
  if (key.startsWith(VENTA_PREFIX)) return { id: key.slice(VENTA_PREFIX.length), col: 'venta' }
  if (key.startsWith(PLANOS_PREFIX)) return { id: key.slice(PLANOS_PREFIX.length), col: 'planos' }
  return null
}

// Ids que este dispositivo ha visto en la nube (último pull/push) por tabla.
// Un borrado sólo se propaga si la fila estaba en esta lista y ya no está en
// local — así un push nunca elimina filas recién creadas desde otro equipo.
const knownKey = (key: string) => 'ready-sync-known:' + key
const readKnown = (key: string): string[] | null => read<string[]>(knownKey(key))
const writeKnown = (key: string, ids: string[]) => writeLocal(knownKey(key), ids)

// ---- push ----
async function pushList(spec: ListSpec): Promise<void> {
  const list: any[] = read<any>(spec.key)?.list || []
  const rows = list.map(spec.toRow)
  if (rows.length) {
    const { error } = await supabase.from(spec.table).upsert(rows)
    if (error) console.warn('[sync] upsert', spec.table, error.message)
  }
  const localIds = new Set(rows.map((r) => r.id))
  const toDelete = (readKnown(spec.key) || []).filter((id) => !localIds.has(id))
  if (toDelete.length) {
    await supabase.from(spec.table).delete().in('id', toDelete)
    if (spec.table === 'proyectos') await supabase.from('documentos').delete().in('project_id', toDelete)
  }
  writeKnown(spec.key, [...localIds])
}

async function pushDoc(key: string): Promise<void> {
  const info = docKeyInfo(key)
  if (!info) return
  const val = read<any>(key)
  const row: any = { project_id: info.id, updated: new Date().toISOString() }
  row[info.col] = val
  const { error } = await supabase.from('documentos').upsert(row, { onConflict: 'project_id' })
  if (error) console.warn('[sync] upsert documentos', error.message)
}

// ---- pull ----
async function pull(): Promise<void> {
  lastPull = Date.now()
  for (const spec of LISTS) {
    const { data, error } = await supabase.from(spec.table).select('*')
    if (error) {
      console.warn('[sync] pull', spec.table, error.message)
      continue
    }
    const prev = read<any>(spec.key)
    const prevById: Record<string, any> = {}
    for (const it of prev?.list || []) prevById[it.id] = it
    const list = (data || []).map((r: any) => spec.fromRow(r, prevById))
    if (spec.key === KEYS.projects) writeLocal(spec.key, { list, current: prev?.current ?? null })
    else writeLocal(spec.key, { list })
    writeKnown(spec.key, list.map((x: any) => x.id))
  }
  const { data: docs } = await supabase.from('documentos').select('*')
  for (const d of docs || []) {
    if (d.venta) writeLocal(KEYS.venta(d.project_id), d.venta)
    if (d.planos) writeLocal(KEYS.planos(d.project_id), d.planos)
  }
}

// Re-lee una sola tabla desde la nube (usado por realtime al llegar un cambio).
async function pullOne(spec: ListSpec): Promise<void> {
  const { data, error } = await supabase.from(spec.table).select('*')
  if (error) return
  const prev = read<any>(spec.key)
  const prevById: Record<string, any> = {}
  for (const it of prev?.list || []) prevById[it.id] = it
  const list = (data || []).map((r: any) => spec.fromRow(r, prevById))
  if (spec.key === KEYS.projects) writeLocal(spec.key, { list, current: prev?.current ?? null })
  else writeLocal(spec.key, { list })
  writeKnown(spec.key, list.map((x: any) => x.id))
  window.dispatchEvent(new Event('ready-sync-pulled'))
}

// Cambios en vivo: cuando el compañero crea o edita una nota/tarea, Supabase
// Realtime avisa y refrescamos esa tabla al momento (sin esperar al focus).
let realtimeOn = false
let rtChannel: any = null
const rtTimers: Record<string, ReturnType<typeof setTimeout>> = {}
function startRealtime(): void {
  if (realtimeOn || !supabaseReady) return
  realtimeOn = true
  try {
    const ch = supabase.channel('ready-team')
    rtChannel = ch
    for (const table of ['notas', 'tareas', 'proyectos', 'revisiones']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        const spec = LISTS.find((l) => l.table === table)
        if (!spec) return
        // pequeño debounce: varios eventos seguidos → un solo pull
        clearTimeout(rtTimers[table])
        rtTimers[table] = setTimeout(() => {
          // no pisar una edición local aún sin subir
          if (!pending[spec.key]) pullOne(spec).catch(() => {})
        }, 350)
      })
    }
    ch.subscribe()
  } catch {
    /* sin realtime seguimos con el refresco al volver a la pestaña */
  }
}

async function seedFromLocal(): Promise<void> {
  for (const spec of LISTS) await pushList(spec)
  const projects: any[] = read<any>(KEYS.projects)?.list || []
  for (const p of projects) {
    if (read(KEYS.venta(p.id)) != null) await pushDoc(KEYS.venta(p.id))
    if (read(KEYS.planos(p.id)) != null) await pushDoc(KEYS.planos(p.id))
  }
}

// ---- write-through hook ----
const timers: Record<string, ReturnType<typeof setTimeout>> = {}
const pending: Record<string, () => Promise<void>> = {}

function flushKey(key: string): void {
  const fn = pending[key]
  if (!fn) return
  delete pending[key]
  clearTimeout(timers[key])
  fn().catch((e) => {
    // Push fallido (red caída, 5xx): reencolar y reintentar, no descartar la
    // edición en silencio.
    console.warn('[sync] push', key, e?.message)
    if (!pending[key]) {
      pending[key] = fn
      clearTimeout(timers[key])
      timers[key] = setTimeout(() => flushKey(key), 10000)
    }
  })
}

/** Fire every pending push right now (on reload / tab hide, so nothing is lost). */
export function flushAll(): void {
  for (const key of Object.keys(pending)) flushKey(key)
}

function schedule(key: string, fn: () => Promise<void>): void {
  pending[key] = fn
  clearTimeout(timers[key])
  timers[key] = setTimeout(() => flushKey(key), 500)
}

function onWrite(key: string, _value: unknown): void {
  const spec = LISTS.find((l) => l.key === key)
  if (spec) return schedule(key, () => pushList(spec))
  if (docKeyInfo(key)) return schedule(key, () => pushDoc(key))
}

// Re-lectura de la nube al volver a la pestaña: una pestaña abierta mucho
// tiempo dejaría de ver lo que crean los compañeros (el pull sólo corría al
// entrar). No se refresca si hay escrituras locales pendientes de subir.
let lastPull = 0
async function refresh(): Promise<void> {
  if (!started || Object.keys(pending).length) return
  if (Date.now() - lastPull < 30000) return
  lastPull = Date.now()
  try {
    await pull()
    window.dispatchEvent(new Event('ready-sync-pulled'))
  } catch (e: any) {
    console.warn('[sync] refresh', e?.message)
  }
}

let unloadHooked = false
function hookUnloadFlush(): void {
  if (unloadHooked) return
  unloadHooked = true
  // Flush pending writes before the page goes away or is backgrounded, so a
  // reload right after an edit doesn't lose the not-yet-synced change.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll()
    else if (document.visibilityState === 'visible') refresh()
  })
  window.addEventListener('pagehide', flushAll)
  window.addEventListener('focus', () => refresh())
}

// ---- public API ----
let started = false

/** Pull cloud state into local storage, seeding the cloud from local if empty,
 *  then start mirroring local writes to the cloud. Safe to call once after login. */
export async function initSync(): Promise<void> {
  if (!supabaseReady || started) return
  started = true
  try {
    const counts = await Promise.all(
      LISTS.map((l) => supabase.from(l.table).select('id', { count: 'exact', head: true })),
    )
    // Sólo sembrar si TODAS las consultas respondieron bien y todas están a 0:
    // un error de red no debe confundirse con "base de datos vacía" (sembraría
    // un estado local viejo encima de los datos del equipo).
    const allOk = counts.every((c) => !c.error)
    const dbEmpty = allOk && counts.every((c) => (c.count ?? 0) === 0)
    const localHasData = LISTS.some((l) => (read<any>(l.key)?.list || []).length > 0)
    if (dbEmpty && localHasData) await seedFromLocal()
    await pull()
  } catch (e: any) {
    console.warn('[sync] initSync', e?.message)
  }
  setWriteHook(onWrite)
  hookUnloadFlush()
  startRealtime()
}

export function stopSync(): void {
  flushAll()
  for (const k of Object.keys(timers)) clearTimeout(timers[k])
  for (const k of Object.keys(pending)) delete pending[k]
  try { rtChannel?.unsubscribe() } catch { /* ignore */ }
  rtChannel = null
  realtimeOn = false
  setWriteHook(null)
  started = false
}
