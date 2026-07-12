// Historial de versiones de un documento (venta o planos): guarda
// instantáneas con nombre en la nube y permite restaurarlas. La restauración
// escribe el payload y recarga el editor (estado limpio garantizado).

import { useEffect, useState } from 'react'
import { KEYS, write } from '../../lib/storage'
import { supabase, supabaseReady } from '../../lib/supabase'
import { myEmail, nombreCorto, timeAgo } from '../../lib/team'
import { MONO, SANS } from '../tareas/kit'

const uid = (p: string) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

export default function VersionesModal({ app, projectId, getPayload, onClose }: {
  app: 'venta' | 'planos'
  projectId: string
  getPayload: () => any
  onClose: () => void
}) {
  const [lista, setLista] = useState<{ id: string; nombre: string; autor: string; created: number }[]>([])
  const [nombre, setNombre] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [pend, setPend] = useState<string | null>(null)

  const cargar = async () => {
    if (!supabaseReady) return
    const { data } = await supabase
      .from('doc_versiones')
      .select('id,nombre,autor,created')
      .eq('project_id', projectId)
      .eq('app', app)
      .order('created', { ascending: false })
      .limit(40)
    setLista((data as any[]) || [])
  }
  useEffect(() => { cargar() /* eslint-disable-next-line */ }, [])

  const guardar = async () => {
    if (busy) return
    setBusy(true)
    setMsg('')
    try {
      const { error } = await supabase.from('doc_versiones').insert({
        id: uid('ver'),
        project_id: projectId,
        app,
        nombre: nombre.trim() || 'Versión del ' + new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
        autor: myEmail(),
        payload: getPayload(),
        created: Date.now(),
      })
      if (error) throw new Error(error.message)
      setNombre('')
      await cargar()
      setMsg('✓ Versión guardada')
    } catch (e: any) {
      setMsg('No se pudo guardar: ' + e.message + (/(relation|not exist)/i.test(String(e.message)) ? ' — ¿está ejecutada la migración «mejoras»?' : ''))
    } finally {
      setBusy(false)
    }
  }

  const restaurar = async (id: string) => {
    if (pend !== 'r' + id) {
      setPend('r' + id)
      setTimeout(() => setPend((c) => (c === 'r' + id ? null : c)), 3000)
      return
    }
    setPend(null)
    setBusy(true)
    try {
      const { data, error } = await supabase.from('doc_versiones').select('payload').eq('id', id).single()
      if (error || !data?.payload) throw new Error(error?.message || 'versión vacía')
      const key = app === 'venta' ? KEYS.venta(projectId) : KEYS.planos(projectId)
      write(key, data.payload)
      // recarga limpia del editor con el payload restaurado
      window.location.reload()
    } catch (e: any) {
      setBusy(false)
      setMsg('No se pudo restaurar: ' + e.message)
    }
  }

  const borrar = async (id: string) => {
    if (pend !== 'b' + id) {
      setPend('b' + id)
      setTimeout(() => setPend((c) => (c === 'b' + id ? null : c)), 3000)
      return
    }
    setPend(null)
    await supabase.from('doc_versiones').delete().eq('id', id)
    cargar()
  }

  return (
    <div data-ui="1" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 95, background: 'rgba(23,22,26,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: SANS }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 460, maxHeight: '80vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 13, boxShadow: '0 24px 70px rgba(23,22,26,0.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 800, flex: 1, color: '#17161A' }}>Versiones del documento</div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 18, color: '#8A867F', cursor: 'pointer' }}>×</button>
        </div>
        {!supabaseReady && <div style={{ fontSize: 12, color: '#8A867F' }}>Las versiones necesitan conexión con la nube.</div>}
        {supabaseReady && (
          <>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && guardar()}
                placeholder="Nombre de la versión (p. ej. «v1 enviada al cliente»)"
                style={{ flex: 1, minWidth: 0, padding: '9px 11px', border: '1px solid #DCD9D2', borderRadius: 8, fontSize: 12, outline: 'none' }}
              />
              <button onClick={guardar} disabled={busy} style={{ border: 'none', background: '#D6197E', color: '#fff', borderRadius: 8, padding: '9px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer', flex: 'none', opacity: busy ? 0.6 : 1 }}>
                {busy ? '…' : 'Guardar versión'}
              </button>
            </div>
            {msg && <div style={{ fontSize: 11.5, color: msg.startsWith('✓') ? '#1F8A5B' : '#C03A2B' }}>{msg}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {lista.map((v) => (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 9, border: '1px solid #ECEAE5', borderRadius: 10, padding: '9px 12px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: '#17161A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.nombre}</div>
                    <div style={{ fontFamily: MONO, fontSize: 9, color: '#8A867F' }}>{nombreCorto(v.autor)} · {timeAgo(v.created)}</div>
                  </div>
                  <button onClick={() => restaurar(v.id)} style={{ border: '1px solid ' + (pend === 'r' + v.id ? '#D6197E' : '#DCD9D2'), background: pend === 'r' + v.id ? '#FBF1F6' : '#fff', color: pend === 'r' + v.id ? '#A81463' : '#17161A', borderRadius: 7, padding: '5px 11px', fontSize: 11, fontWeight: 700, cursor: 'pointer', flex: 'none' }}>
                    {pend === 'r' + v.id ? '¿Restaurar?' : 'Restaurar'}
                  </button>
                  <button onClick={() => borrar(v.id)} style={{ border: 'none', background: 'none', color: pend === 'b' + v.id ? '#C03A2B' : '#B4B0A8', fontSize: pend === 'b' + v.id ? 10 : 14, fontWeight: 700, cursor: 'pointer', flex: 'none' }}>
                    {pend === 'b' + v.id ? '¿Borrar?' : '×'}
                  </button>
                </div>
              ))}
              {!lista.length && <div style={{ fontSize: 12, color: '#B4B0A8' }}>Aún no hay versiones guardadas. Guarda una antes de enviar el documento al cliente o antes de un cambio grande.</div>}
            </div>
            <div style={{ fontSize: 10.5, color: '#8A867F', lineHeight: 1.6 }}>
              Restaurar sustituye el documento actual por la instantánea (la lámina se recarga). Guarda antes una versión del estado actual si no quieres perderlo.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
