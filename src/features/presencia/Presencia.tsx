// Presencia en vivo (Supabase Realtime Presence): muestra quién del equipo
// está conectado y si está en la misma pantalla que tú. Pila de avatares
// flotante bajo el chip de cuenta.

import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase, supabaseReady } from '../../lib/supabase'
import { myEmail, nombreCorto } from '../../lib/team'
import { Avatar, KIT_CSS, SANS } from '../tareas/kit'

export default function Presencia() {
  const loc = useLocation()
  const [otros, setOtros] = useState<{ email: string; path: string }[]>([])
  const chRef = useRef<any>(null)
  const pathRef = useRef(loc.pathname)
  pathRef.current = loc.pathname

  useEffect(() => {
    if (!supabaseReady) return
    let cancel = false
    // el email puede tardar un instante en estar disponible tras el login
    const start = () => {
      const email = myEmail()
      if (!email) { if (!cancel) setTimeout(start, 1500); return }
      const ch = supabase.channel('presencia-equipo', { config: { presence: { key: email } } })
      chRef.current = ch
      ch.on('presence', { event: 'sync' }, () => {
        const st = ch.presenceState() as Record<string, any[]>
        const out: { email: string; path: string }[] = []
        for (const [k, metas] of Object.entries(st)) {
          if (k === email) continue
          const m: any = metas[metas.length - 1]
          out.push({ email: k, path: m?.path || '/' })
        }
        setOtros(out)
      })
      ch.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') ch.track({ path: pathRef.current, at: Date.now() })
      })
    }
    start()
    return () => {
      cancel = true
      try { chRef.current?.unsubscribe() } catch { /* ignore */ }
    }
  }, [])

  useEffect(() => {
    try { chRef.current?.track({ path: loc.pathname, at: Date.now() }) } catch { /* ignore */ }
  }, [loc.pathname])

  if (!otros.length) return null

  const label = (o: { email: string; path: string }) => {
    if (o.path === loc.pathname) return nombreCorto(o.email) + ' está aquí contigo'
    if (o.path.startsWith('/venta/')) return nombreCorto(o.email) + ' está en un Documento de venta'
    if (o.path.startsWith('/planos/')) return nombreCorto(o.email) + ' está en Memoria y planos'
    return nombreCorto(o.email) + ' está en Proyectos'
  }

  return (
    <div data-ui="1" data-noprint="1" style={{ position: 'fixed', top: 54, right: 16, zIndex: 59, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', fontFamily: SANS }}>
      <style>{KIT_CSS}</style>
      {otros.map((o) => {
        const aqui = o.path === loc.pathname
        return (
          <div key={o.email} title={label(o)} style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#fff', border: '1.5px solid ' + (aqui ? '#1F8A5B' : '#E0DED8'), borderRadius: 999, padding: '3px 10px 3px 4px', boxShadow: '0 6px 18px rgba(23,22,26,0.14)', animation: 'tkFadeUp 0.2s ease' }}>
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <Avatar email={o.email} size={22} />
              <span style={{ position: 'absolute', bottom: -1, right: -1, width: 8, height: 8, borderRadius: '50%', background: aqui ? '#1F8A5B' : '#B4B0A8', border: '1.5px solid #fff' }} />
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: aqui ? '#1F8A5B' : '#8A867F' }}>
              {aqui ? 'aquí contigo' : 'conectado'}
            </span>
          </div>
        )
      })}
    </div>
  )
}
