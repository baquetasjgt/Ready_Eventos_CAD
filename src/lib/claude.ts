// AI text generation (Google Gemini, model gemini-3.5-flash).
//
// Two paths, chosen automatically:
//   1. Server proxy (recommended for production): a Supabase Edge Function
//      ("ai") that holds GEMINI_API_KEY server-side, so the key never reaches
//      the browser. Used when Supabase is configured and no local key is set.
//   2. Direct call (local dev convenience): if VITE_GEMINI_API_KEY is present,
//      call Google directly.
//
// Keep the module name/signature (`complete` / `hasApiKey`) stable so the rest
// of the app doesn't care which path is used.

import { supabase, supabaseReady } from './supabase'

const MODEL = 'gemini-3.5-flash'
const directEndpoint = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
    key,
  )}`

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface CompleteOptions {
  system?: string
  messages: ChatMessage[]
  maxTokens?: number
  model?: string
}

const localKey = () => import.meta.env.VITE_GEMINI_API_KEY as string | undefined

export function hasApiKey(): boolean {
  return !!localKey() || supabaseReady
}

export async function complete(opts: CompleteOptions): Promise<string> {
  // Path 1: server proxy (no key in the browser).
  if (!localKey() && supabaseReady) {
    const { data, error } = await supabase.functions.invoke('ai', {
      body: {
        system: opts.system,
        messages: opts.messages,
        maxTokens: opts.maxTokens ?? 1500,
        model: opts.model,
      },
    })
    if (error) {
      // invoke() wraps non-2xx; try to surface the function's JSON error.
      let detail = error.message
      try {
        const ctx = (error as any).context
        if (ctx?.json) {
          const j = await ctx.json()
          if (j?.error) detail = j.error
        }
      } catch {
        /* ignore */
      }
      throw new Error(detail || 'El asistente de IA no está disponible.')
    }
    const text = (data as any)?.text
    if (!text) throw new Error('La IA no ha devuelto texto.')
    return text
  }

  // Path 2: direct call with a local key.
  const apiKey = localKey()
  if (!apiKey) {
    throw new Error(
      'El asistente de IA no está disponible: configura Supabase (proxy) o VITE_GEMINI_API_KEY.',
    )
  }
  const body: Record<string, unknown> = {
    contents: opts.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: { maxOutputTokens: opts.maxTokens ?? 1500 },
  }
  if (opts.system) body.system_instruction = { parts: [{ text: opts.system }] }

  const res = await fetch(directEndpoint(opts.model || MODEL, apiKey), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error?.message || `Error de la API (${res.status}).`)
  if (data?.promptFeedback?.blockReason)
    throw new Error('La IA ha bloqueado la petición (' + data.promptFeedback.blockReason + ').')
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map((p: any) => p?.text || '')
    .join('')
  if (!text) throw new Error('La IA no ha devuelto texto.')
  return text
}
