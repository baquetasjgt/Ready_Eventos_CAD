// Identidad del equipo: quién soy, quiénes son los miembros (para menciones @)
// y utilidades de presentación (nombre corto, avatar, "hace X").

import { supabase, supabaseReady } from './supabase'

const EMAIL_CACHE = 'ready-me-v1'
const MIEMBROS_CACHE = 'ready-miembros-v1'

let email: string | null = null
if (supabaseReady) {
  supabase.auth.getSession().then(({ data }) => {
    email = data.session?.user?.email?.toLowerCase() || null
    if (email) try { localStorage.setItem(EMAIL_CACHE, email) } catch { /* ignore */ }
  })
  supabase.auth.onAuthStateChange((_e, s) => {
    email = s?.user?.email?.toLowerCase() || null
    if (email) try { localStorage.setItem(EMAIL_CACHE, email) } catch { /* ignore */ }
  })
}

/** Email del usuario actual (cacheado para el primer render). */
export function myEmail(): string {
  if (email) return email
  try { return localStorage.getItem(EMAIL_CACHE) || '' } catch { return '' }
}

/** Miembros autorizados (emails), con caché local para el primer render. */
export function miembrosCache(): string[] {
  try { return JSON.parse(localStorage.getItem(MIEMBROS_CACHE) || '[]') } catch { return [] }
}
export async function fetchMiembros(): Promise<string[]> {
  if (!supabaseReady) return miembrosCache()
  try {
    const { data } = await supabase.from('miembros').select('email').order('email')
    const list = (data || []).map((r: any) => String(r.email).toLowerCase())
    if (list.length) try { localStorage.setItem(MIEMBROS_CACHE, JSON.stringify(list)) } catch { /* ignore */ }
    return list.length ? list : miembrosCache()
  } catch {
    return miembrosCache()
  }
}

/** «manuel.navarro@readyeventos.com» → «Manuel Navarro» */
export function nombreCorto(em: string): string {
  const local = String(em || '').split('@')[0]
  if (!local) return '—'
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Alias de mención: la parte local del email («@manuel.navarro»). */
export function alias(em: string): string {
  return String(em || '').split('@')[0].toLowerCase()
}

const AVATAR_COLORS = ['#D6197E', '#7C3AED', '#0E7490', '#B07A1F', '#1F8A5B', '#C03A2B', '#4338CA']
export function avatarColor(em: string): string {
  let h = 0
  for (const c of String(em || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
export function inicial(em: string): string {
  return (String(em || '?').charAt(0) || '?').toUpperCase()
}

export function timeAgo(ts?: number): string {
  if (!ts) return ''
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'ahora mismo'
  if (s < 3600) return 'hace ' + Math.floor(s / 60) + ' min'
  if (s < 86400) return 'hace ' + Math.floor(s / 3600) + ' h'
  if (s < 86400 * 7) return 'hace ' + Math.floor(s / 86400) + ' d'
  return new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}

/** Extrae los emails mencionados en un texto (@alias contra la lista de miembros). */
export function menciones(texto: string, miembros: string[]): string[] {
  const out: string[] = []
  const rx = /@([\w.+-]+)/g
  let m: RegExpExecArray | null
  while ((m = rx.exec(String(texto || '')))) {
    const a = m[1].toLowerCase()
    const hit = miembros.find((em) => alias(em) === a || em === a)
    if (hit && !out.includes(hit)) out.push(hit)
  }
  return out
}
