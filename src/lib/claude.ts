// AI text generation. Targets Google's Gemini API (model gemini-3.5-flash).
//
// The module keeps the name/signature (`complete` / `hasApiKey`) that the rest
// of the app already imports, so switching providers is a one-file change.
//
// The API key is read from VITE_GEMINI_API_KEY (see .env.example). It is left
// unset in the repo; add your own key in a local .env. A browser-exposed key is
// visible to end users, so move this call behind a server proxy before shipping
// to production.

const MODEL = 'gemini-3.5-flash'
const endpoint = (model: string, key: string) =>
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

export function hasApiKey(): boolean {
  return !!import.meta.env.VITE_GEMINI_API_KEY
}

// Returns the model's text. Throws on transport/auth/safety errors so callers
// can surface a friendly message, matching the prototype's behaviour.
export async function complete(opts: CompleteOptions): Promise<string> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined
  if (!apiKey) {
    throw new Error(
      'El asistente de IA no está disponible: falta la clave de API (VITE_GEMINI_API_KEY).',
    )
  }

  const body: Record<string, unknown> = {
    contents: opts.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: { maxOutputTokens: opts.maxTokens ?? 1500 },
  }
  if (opts.system) {
    body.system_instruction = { parts: [{ text: opts.system }] }
  }

  const res = await fetch(endpoint(opts.model || MODEL, apiKey), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = await res.json().catch(() => null)

  if (!res.ok) {
    const detail = data?.error?.message || `Error de la API (${res.status}).`
    throw new Error(detail)
  }

  const blocked = data?.promptFeedback?.blockReason
  if (blocked) {
    throw new Error('La IA ha bloqueado la petición (' + blocked + ').')
  }

  const cand = data?.candidates?.[0]
  const text = (cand?.content?.parts || [])
    .map((p: any) => p?.text || '')
    .join('')
  if (!text) {
    const reason = cand?.finishReason ? ' (' + cand.finishReason + ')' : ''
    throw new Error('La IA no ha devuelto texto' + reason + '.')
  }
  return text
}
