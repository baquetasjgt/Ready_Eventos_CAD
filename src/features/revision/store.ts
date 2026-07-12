// Modo Revisión — estado compartido entre la barra de herramientas y las capas
// de cada lámina (mini-store sin dependencias), más el CRUD de marcas.

import { KEYS, read, write, type Revision, type Tarea } from '../../lib/storage'
import { myEmail } from '../../lib/team'

export type RevTool = 'postit' | 'draw' | 'hi' | 'arrow' | 'erase' | null

export const POSTIT_COLORS = ['#FFE58A', '#FFC4DE', '#BDE3FF', '#C9F2C7']
export const uid = (p: string) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

// ---- estado de herramienta (compartido por barra y capas) ----
type State = { tool: RevTool; color: string; visible: boolean; sel: string | null }
const state: State = { tool: null, color: POSTIT_COLORS[0], visible: true, sel: null }
const subs = new Set<() => void>()
export function revState(): Readonly<State> { return state }
export function setRev(patch: Partial<State>): void {
  Object.assign(state, patch)
  subs.forEach((f) => f())
}
export function subRev(f: () => void): () => void {
  subs.add(f)
  return () => { subs.delete(f) }
}

// ---- datos ----
const CHANGED = 'ready-data-changed'
export function listRevs(): Revision[] { return read<{ list: Revision[] }>(KEYS.revisiones)?.list || [] }
export function saveRevs(next: Revision[]): void {
  write(KEYS.revisiones, { list: next })
  window.dispatchEvent(new Event(CHANGED))
}
export function listTareasR(): Tarea[] { return read<{ list: Tarea[] }>(KEYS.tareas)?.list || [] }
export function saveTareasR(next: Tarea[]): void {
  write(KEYS.tareas, { list: next })
  window.dispatchEvent(new Event(CHANGED))
}

/** Marcas visibles de una lámina: oculta las ligadas a tareas hechas o borradas. */
export function marcasDe(app: 'venta' | 'planos', projectId: string, pageId: string): Revision[] {
  const tareas = listTareasR()
  const viva = (tid?: string) => {
    if (!tid) return true
    const t = tareas.find((x) => x.id === tid)
    return !!t && t.estado !== 'hecha'
  }
  const all = listRevs().filter((r) => r.app === app && r.projectId === projectId && r.pageId === pageId)
  const postitVivo = new Set(all.filter((r) => r.kind === 'postit' && viva(r.tareaId)).map((r) => r.id))
  return all.filter((r) =>
    r.kind === 'postit' ? postitVivo.has(r.id) : viva(r.tareaId) && (!r.postitId || postitVivo.has(r.postitId)),
  )
}

/** Crea un post-it y su tarea vinculada. Devuelve el id del post-it. */
export function crearPostit(app: 'venta' | 'planos', projectId: string, pageId: string, x: number, y: number, pageLabel: string): string {
  const me = myEmail()
  const pid = uid('rv')
  const tid = uid('t')
  const tarea: Tarea = {
    id: tid, titulo: 'Revisar: ' + pageLabel, projectId, asignada: me, autor: me,
    estado: 'pendiente', prioridad: 'normal', created: Date.now(), review: { app, pageId },
  }
  const mark: Revision = {
    id: pid, projectId, app, pageId, kind: 'postit', tareaId: tid, autor: me,
    created: Date.now(), x, y, color: state.color, texto: '',
  }
  saveTareasR([tarea, ...listTareasR()])
  saveRevs([...listRevs(), mark])
  setRev({ sel: pid, tool: null })
  return pid
}

export function updMark(id: string, patch: Partial<Revision>): void {
  saveRevs(listRevs().map((r) => (r.id === id ? { ...r, ...patch } : r)))
}

/** El texto del post-it es el título de su tarea. */
export function setPostitTexto(id: string, texto: string, pageLabel: string): void {
  const mark = listRevs().find((r) => r.id === id)
  updMark(id, { texto })
  if (mark?.tareaId) {
    const titulo = texto.trim() ? texto.trim().slice(0, 140) : 'Revisar: ' + pageLabel
    saveTareasR(listTareasR().map((t) => (t.id === mark.tareaId ? { ...t, titulo } : t)))
  }
}

export function setPostitAsignada(id: string, email: string): void {
  const mark = listRevs().find((r) => r.id === id)
  if (mark?.tareaId) saveTareasR(listTareasR().map((t) => (t.id === mark.tareaId ? { ...t, asignada: email } : t)))
}

/** Completa la tarea de un post-it desde la propia lámina (desaparece al momento). */
export function completarPostit(id: string): void {
  const mark = listRevs().find((r) => r.id === id)
  if (!mark?.tareaId) return
  saveTareasR(listTareasR().map((t) => (t.id === mark.tareaId ? { ...t, estado: 'hecha' as const, doneAt: Date.now() } : t)))
  if (state.sel === id) setRev({ sel: null })
}

/** Borra una marca; un post-it arrastra sus trazos y su tarea. */
export function delMark(id: string): void {
  const mark = listRevs().find((r) => r.id === id)
  if (!mark) return
  const drop = new Set([id])
  if (mark.kind === 'postit') {
    for (const r of listRevs()) if (r.postitId === id) drop.add(r.id)
    if (mark.tareaId) saveTareasR(listTareasR().filter((t) => t.id !== mark.tareaId))
  }
  saveRevs(listRevs().filter((r) => !drop.has(r.id)))
  if (state.sel && drop.has(state.sel)) setRev({ sel: null })
}

export function addStroke(app: 'venta' | 'planos', projectId: string, pageId: string, tool: 'draw' | 'hi' | 'arrow', pts: number[][], color: string): void {
  const sel = state.sel
  const postit = sel ? listRevs().find((r) => r.id === sel && r.kind === 'postit' && r.pageId === pageId) : null
  saveRevs([...listRevs(), {
    id: uid('rv'), projectId, app, pageId, kind: 'stroke', autor: myEmail(), created: Date.now(),
    tool, pts, color, postitId: postit?.id, tareaId: postit?.tareaId,
  }])
}
