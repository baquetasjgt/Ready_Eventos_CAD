// Client-side wrapper around the Anthropic Messages API. Replaces the
// prototype's `window.claude.complete(...)` shim with a real call.
//
// The API key is read from the VITE_ANTHROPIC_API_KEY env var (see .env.example).
// It is intentionally left unset by default — add your own key locally, or move
// this call behind a small server proxy before shipping to production, since a
// browser-exposed key is visible to anyone using the app.

const API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-opus-4-8'

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
  return !!import.meta.env.VITE_ANTHROPIC_API_KEY
}

// Returns the assistant's text. Throws on transport/auth errors so callers can
// surface a friendly message, matching the prototype's behaviour.
export async function complete(opts: CompleteOptions): Promise<string> {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined
  if (!apiKey) {
    throw new Error(
      'El asistente de IA no está disponible: falta la clave de API (VITE_ANTHROPIC_API_KEY).',
    )
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: opts.model || MODEL,
      max_tokens: opts.maxTokens ?? 1500,
      ...(opts.system ? { system: opts.system } : {}),
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  })

  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.error?.message || ''
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Error de la API (${res.status}).`)
  }

  const data = await res.json()
  const text = (data.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
  return text
}
