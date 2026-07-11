import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseReady } from '../../lib/supabase'
import { initSync, stopSync } from '../../lib/sync'

type Phase = 'loading' | 'signin' | 'notmember' | 'syncing' | 'ready'

const wrap: React.CSSProperties = {
  minHeight: '100vh',
  background: '#E8E6E1',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: "'Archivo','Helvetica Neue',Helvetica,sans-serif",
  color: '#17161A',
  padding: 24,
}
const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #E0DED8',
  borderRadius: 16,
  padding: 30,
  width: '100%',
  maxWidth: 380,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  boxShadow: '0 20px 50px rgba(23,22,26,0.12)',
}
const field: React.CSSProperties = {
  padding: '11px 13px',
  border: '1px solid #DCD9D2',
  borderRadius: 9,
  fontSize: 13.5,
  background: '#FDFDFC',
  outline: 'none',
  width: '100%',
}
const primary: React.CSSProperties = {
  border: 'none',
  background: '#D6197E',
  color: '#fff',
  borderRadius: 9,
  padding: '12px 16px',
  fontSize: 13.5,
  fontWeight: 700,
  cursor: 'pointer',
}
const spinner = (
  <span
    style={{
      width: 16,
      height: 16,
      border: '3px solid rgba(214,25,126,0.3)',
      borderTopColor: '#D6197E',
      borderRadius: '50%',
      display: 'inline-block',
      animation: 'crmspin 0.8s linear infinite',
    }}
  />
)

function Brand() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <img src="/assets/logo.png" alt="Ready Eventos" style={{ width: 38, height: 'auto' }} />
      <div>
        <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em' }}>Ready Eventos</div>
        <div
          style={{
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 9,
            color: '#8A867F',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          Generador de presentaciones CAD
        </div>
      </div>
    </div>
  )
}

export default function AuthGate({ children }: { children: ReactNode }) {
  // Offline / not configured → run the app as-is (local only).
  if (!supabaseReady) return <>{children}</>

  const [phase, setPhase] = useState<Phase>('loading')
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!session) {
        setPhase('signin')
        return
      }
      const { data, error } = await supabase.rpc('is_member')
      if (cancelled) return
      if (error || !data) {
        setPhase('notmember')
        return
      }
      setPhase('syncing')
      await initSync()
      if (!cancelled) setPhase('ready')
    }
    run()
    return () => {
      cancelled = true
    }
  }, [session])

  if (phase === 'loading' || phase === 'syncing') {
    return (
      <div style={wrap}>
        <div style={{ ...card, alignItems: 'center', gap: 18 }}>
          <Brand />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#8A867F', fontSize: 13 }}>
            {spinner}
            <span>{phase === 'syncing' ? 'Sincronizando con la nube…' : 'Cargando…'}</span>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'signin') return <SignIn />

  if (phase === 'notmember') {
    return (
      <div style={wrap}>
        <div style={card}>
          <Brand />
          <div style={{ fontSize: 14, fontWeight: 700 }}>Cuenta no autorizada</div>
          <div style={{ fontSize: 12.5, color: '#6E6B66', lineHeight: 1.6 }}>
            Tu cuenta <strong>{session?.user?.email}</strong> aún no tiene acceso a los datos de
            Ready Eventos. Pídele a un miembro del equipo que te dé de alta desde la app.
          </div>
          <button
            onClick={() => {
              stopSync()
              supabase.auth.signOut()
            }}
            style={{ ...primary, background: '#17161A' }}
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      {children}
      <AccountChip email={session?.user?.email || ''} />
    </>
  )
}

function SignIn() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [info, setInfo] = useState('')

  const submit = async () => {
    setMsg('')
    setInfo('')
    if (!email || !pass) {
      setMsg('Introduce email y contraseña.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pass })
        if (error) setMsg(traducir(error.message))
      } else {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password: pass })
        if (error) setMsg(traducir(error.message))
        else if (!data.session)
          setInfo('Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={wrap}>
      <div style={card}>
        <Brand />
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          {(['in', 'up'] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m)
                setMsg('')
                setInfo('')
              }}
              style={{
                flex: 1,
                padding: '8px 10px',
                borderRadius: 8,
                border: `1px solid ${mode === m ? '#17161A' : '#DCD9D2'}`,
                background: mode === m ? '#17161A' : '#fff',
                color: mode === m ? '#fff' : '#6E6B66',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {m === 'in' ? 'Entrar' : 'Crear cuenta'}
            </button>
          ))}
        </div>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="Email"
          style={field}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <input
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          type="password"
          placeholder="Contraseña"
          style={field}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        {msg && (
          <div style={{ fontSize: 12, color: '#C03A2B', background: '#F9ECEA', border: '1px solid #E5C3BD', borderRadius: 8, padding: '9px 11px' }}>
            {msg}
          </div>
        )}
        {info && (
          <div style={{ fontSize: 12, color: '#1F8A5B', background: '#EAF5EF', border: '1px solid #BFDECE', borderRadius: 8, padding: '9px 11px' }}>
            {info}
          </div>
        )}
        <button onClick={submit} disabled={busy} style={{ ...primary, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Un momento…' : mode === 'in' ? 'Entrar' : 'Crear cuenta'}
        </button>
      </div>
    </div>
  )
}

function traducir(m: string): string {
  if (/invalid login/i.test(m)) return 'Email o contraseña incorrectos.'
  if (/already registered/i.test(m)) return 'Ese email ya está registrado.'
  if (/at least 6/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres.'
  if (/email not confirmed/i.test(m)) return 'Confirma tu email antes de entrar (revisa tu correo).'
  return m
}

function AccountChip({ email }: { email: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Cuenta y equipo"
        style={{
          position: 'fixed',
          top: 14,
          right: 16,
          zIndex: 60,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: '#fff',
          border: '1px solid #DCD9D2',
          borderRadius: 999,
          padding: '6px 12px 6px 8px',
          fontSize: 11.5,
          fontWeight: 600,
          color: '#17161A',
          cursor: 'pointer',
          boxShadow: '0 6px 18px rgba(23,22,26,0.12)',
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: '#D6197E',
            color: '#fff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 800,
          }}
        >
          {(email[0] || '?').toUpperCase()}
        </span>
        <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</span>
      </button>
      {open && <AccountModal email={email} onClose={() => setOpen(false)} />}
    </>
  )
}

function AccountModal({ email, onClose }: { email: string; onClose: () => void }) {
  const [miembros, setMiembros] = useState<string[]>([])
  const [nuevo, setNuevo] = useState('')
  const [msg, setMsg] = useState('')

  const load = async () => {
    const { data } = await supabase.from('miembros').select('email').order('email')
    setMiembros((data || []).map((r: any) => r.email))
  }
  useEffect(() => {
    load()
  }, [])

  const add = async () => {
    const e = nuevo.trim().toLowerCase()
    setMsg('')
    if (!e || !/.+@.+\..+/.test(e)) {
      setMsg('Email no válido.')
      return
    }
    const { error } = await supabase.from('miembros').insert({ email: e })
    if (error) setMsg(error.message)
    else {
      setNuevo('')
      load()
    }
  }
  const remove = async (e: string) => {
    if (e === email.toLowerCase()) {
      setMsg('No puedes quitarte a ti mismo.')
      return
    }
    await supabase.from('miembros').delete().eq('email', e)
    load()
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        background: 'rgba(23,22,26,0.35)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-end',
        padding: 16,
        fontFamily: "'Archivo','Helvetica Neue',Helvetica,sans-serif",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ ...card, maxWidth: 340, marginTop: 44, gap: 12 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 800, flex: 1 }}>Cuenta y equipo</div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 18, color: '#8A867F', cursor: 'pointer' }}>
            ×
          </button>
        </div>
        <div style={{ fontSize: 12.5, color: '#6E6B66' }}>
          Sesión: <strong>{email}</strong>
        </div>
        <div
          style={{
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 9,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: '#8A867F',
          }}
        >
          Miembros autorizados
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
          {miembros.map((m) => (
            <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m}</span>
              <button
                onClick={() => remove(m)}
                title="Quitar acceso"
                style={{ border: 'none', background: 'none', color: '#B4B0A8', fontSize: 14, cursor: 'pointer' }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
            placeholder="añadir email…"
            style={{ ...field, padding: '9px 11px', fontSize: 12.5 }}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button onClick={add} style={{ ...primary, padding: '9px 14px', fontSize: 12.5 }}>
            +
          </button>
        </div>
        {msg && <div style={{ fontSize: 11.5, color: '#C03A2B' }}>{msg}</div>}
        <button
          onClick={() => {
            stopSync()
            supabase.auth.signOut()
          }}
          style={{ border: '1px solid #DCD9D2', background: '#fff', borderRadius: 9, padding: '10px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', color: '#17161A' }}
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}
