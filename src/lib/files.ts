// Supabase Storage with checked responses, bounded retries and visible errors.

import { errorMessage, reportCloudIssue, resolveCloudIssue } from './cloud-events'
import { supabase, supabaseReady } from './supabase'

interface StorageResponse<T> {
  data: T
  error: any
}

interface StorageRun<T> {
  ok: boolean
  data: T | null
}

const RETRY_DELAYS = [0, 800, 2500]

function statusOf(error: any): number {
  return Number(error?.statusCode || error?.status || error?.status_code || 0)
}

function isTransient(error: any): boolean {
  const status = statusOf(error)
  return !status || status === 408 || status === 423 || status === 429 || status >= 500
}

function isMissing(error: any): boolean {
  const code = String(error?.error || error?.code || '').toLowerCase()
  return statusOf(error) === 404 || code.includes('notfound') || code.includes('not_found')
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function runStorage<T>(
  issueId: string,
  title: string,
  operation: () => PromiseLike<StorageResponse<T>>,
  options: { ignoreMissing?: boolean; notify?: boolean } = {},
): Promise<StorageRun<T>> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    if (RETRY_DELAYS[attempt]) await wait(RETRY_DELAYS[attempt])
    try {
      const { data, error } = await operation()
      if (!error) {
        resolveCloudIssue(issueId)
        return { ok: true, data }
      }
      if (options.ignoreMissing && isMissing(error)) return { ok: false, data: null }
      lastError = error
      console.error('[storage]', issueId, error)
      if (!isTransient(error)) break
    } catch (error) {
      lastError = error
      console.error('[storage]', issueId, error)
    }
  }

  if (options.notify !== false) {
    reportCloudIssue({
      id: issueId,
      title,
      message: errorMessage(lastError) + '. La copia local se conserva.',
      retry: async () => (await runStorage(issueId, title, operation, { ...options, notify: false })).ok,
    })
  }
  return { ok: false, data: null }
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.*)$/)
  if (!match) return null
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: match[1] })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function subirDataUrl(bucket: string, path: string, dataUrl: string): Promise<boolean> {
  if (!supabaseReady) return false
  const blob = dataUrlToBlob(dataUrl)
  if (!blob) return false
  return (await runStorage(
    `storage:upload:${bucket}:${path}`,
    'No se ha podido subir una imagen',
    () => supabase.storage.from(bucket).upload(path, blob, { upsert: true, contentType: blob.type }),
  )).ok
}

export async function bajarDataUrl(bucket: string, path: string): Promise<string | null> {
  if (!supabaseReady) return null
  const result = await runStorage(
    `storage:download:${bucket}:${path}`,
    'No se ha podido descargar una imagen',
    () => supabase.storage.from(bucket).download(path),
    { ignoreMissing: true },
  )
  if (!result.ok || !result.data) return null
  try { return await blobToDataUrl(result.data as Blob) }
  catch { return null }
}

export async function subirTexto(bucket: string, path: string, texto: string): Promise<boolean> {
  if (!supabaseReady) return false
  const blob = new Blob([texto], { type: 'text/plain' })
  return (await runStorage(
    `storage:upload:${bucket}:${path}`,
    'No se ha podido subir un archivo',
    () => supabase.storage.from(bucket).upload(path, blob, { upsert: true, contentType: 'text/plain' }),
  )).ok
}

export async function bajarTexto(bucket: string, path: string): Promise<string | null> {
  if (!supabaseReady) return null
  const result = await runStorage(
    `storage:download:${bucket}:${path}`,
    'No se ha podido descargar un archivo',
    () => supabase.storage.from(bucket).download(path),
    { ignoreMissing: true },
  )
  if (!result.ok || !result.data) return null
  try { return await (result.data as Blob).text() }
  catch { return null }
}

export async function subirBlob(bucket: string, path: string, blob: Blob): Promise<boolean> {
  if (!supabaseReady) return false
  return (await runStorage(
    `storage:upload:${bucket}:${path}`,
    'No se ha podido subir un archivo',
    () => supabase.storage.from(bucket).upload(path, blob, { upsert: true, contentType: blob.type || undefined }),
  )).ok
}

export async function bajarBlob(bucket: string, path: string): Promise<Blob | null> {
  if (!supabaseReady) return null
  const result = await runStorage(
    `storage:download:${bucket}:${path}`,
    'No se ha podido descargar un archivo',
    () => supabase.storage.from(bucket).download(path),
    { ignoreMissing: true },
  )
  return result.ok ? result.data as Blob : null
}

export async function borrarRuta(bucket: string, paths: string[]): Promise<boolean> {
  if (!supabaseReady || !paths.length) return false
  return (await runStorage(
    `storage:delete:${bucket}:${paths.join('|')}`,
    'No se ha podido borrar un archivo de la nube',
    () => supabase.storage.from(bucket).remove(paths),
  )).ok
}

export async function borrarPrefijo(bucket: string, prefix: string): Promise<boolean> {
  if (!supabaseReady) return false
  const paths: string[] = []
  for (let offset = 0; ; offset += 100) {
    const result = await runStorage(
      `storage:list:${bucket}:${prefix}`,
      'No se han podido consultar los archivos de la nube',
      () => supabase.storage.from(bucket).list(prefix, { limit: 100, offset }),
    )
    if (!result.ok) return false
    const page = (result.data || []) as Array<{ name: string }>
    paths.push(...page.map((file) => prefix + '/' + file.name))
    if (page.length < 100) break
  }
  for (let i = 0; i < paths.length; i += 100) {
    if (!await borrarRuta(bucket, paths.slice(i, i + 100))) return false
  }
  return true
}
