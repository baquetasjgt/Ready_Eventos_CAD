// Archivos en Supabase Storage: las imágenes de las láminas, los DXF y los
// PDFs de normativa se suben al crear y se descargan cuando faltan en el
// dispositivo (IndexedDB es la caché local; Storage la copia del equipo).
// Todas las funciones son tolerantes: sin conexión devuelven null y la app
// sigue funcionando en local.

import { supabase, supabaseReady } from './supabase'

function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.*)$/)
  if (!m) return null
  const bin = atob(m[2])
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: m[1] })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(r.error)
    r.readAsDataURL(blob)
  })
}

export async function subirDataUrl(bucket: string, path: string, dataUrl: string): Promise<void> {
  if (!supabaseReady) return
  try {
    const blob = dataUrlToBlob(dataUrl)
    if (!blob) return
    await supabase.storage.from(bucket).upload(path, blob, { upsert: true })
  } catch { /* sin red: queda en local */ }
}

export async function bajarDataUrl(bucket: string, path: string): Promise<string | null> {
  if (!supabaseReady) return null
  try {
    const { data } = await supabase.storage.from(bucket).download(path)
    return data ? await blobToDataUrl(data) : null
  } catch { return null }
}

export async function subirTexto(bucket: string, path: string, texto: string): Promise<void> {
  if (!supabaseReady) return
  try {
    await supabase.storage.from(bucket).upload(path, new Blob([texto], { type: 'text/plain' }), { upsert: true })
  } catch { /* ignore */ }
}

export async function bajarTexto(bucket: string, path: string): Promise<string | null> {
  if (!supabaseReady) return null
  try {
    const { data } = await supabase.storage.from(bucket).download(path)
    return data ? await data.text() : null
  } catch { return null }
}

export async function subirBlob(bucket: string, path: string, blob: Blob): Promise<void> {
  if (!supabaseReady) return
  try {
    await supabase.storage.from(bucket).upload(path, blob, { upsert: true })
  } catch { /* ignore */ }
}

export async function bajarBlob(bucket: string, path: string): Promise<Blob | null> {
  if (!supabaseReady) return null
  try {
    const { data } = await supabase.storage.from(bucket).download(path)
    return data || null
  } catch { return null }
}

export async function borrarRuta(bucket: string, paths: string[]): Promise<void> {
  if (!supabaseReady || !paths.length) return
  try { await supabase.storage.from(bucket).remove(paths) } catch { /* ignore */ }
}

/** Borra todos los objetos bajo un prefijo (p. ej. los archivos de un proyecto). */
export async function borrarPrefijo(bucket: string, prefix: string): Promise<void> {
  if (!supabaseReady) return
  try {
    const { data } = await supabase.storage.from(bucket).list(prefix, { limit: 200 })
    const paths = (data || []).map((f: any) => prefix + '/' + f.name)
    if (paths.length) await supabase.storage.from(bucket).remove(paths)
  } catch { /* ignore */ }
}
