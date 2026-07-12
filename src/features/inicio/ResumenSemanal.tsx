// Resumen semanal con IA: recopila lo ocurrido en los últimos 7 días
// (avances de proyectos, tareas y notas) y pide un resumen ejecutivo.

import { useState } from 'react'
import { complete, hasApiKey } from '../../lib/claude'
import { KEYS, read, type Nota, type Project, type Tarea } from '../../lib/storage'
import { nombreCorto } from '../../lib/team'
import { KIT_CSS, MONO, SANS } from '../tareas/kit'

export default function ResumenSemanal({ proyectos }: { proyectos: Project[] }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [texto, setTexto] = useState('')
  const [error, setError] = useState('')

  const generar = async () => {
    if (busy) return
    if (!hasApiKey()) { setError('La IA no está disponible en este entorno.'); return }
    setBusy(true)
    setError('')
    setTexto('')
    try {
      const desde = Date.now() - 7 * 86400000
      const tareas = read<{ list: Tarea[] }>(KEYS.tareas)?.list || []
      const notas = read<{ list: Nota[] }>(KEYS.notas)?.list || []
      const pName = (id?: string) => proyectos.find((p) => p.id === id)?.name || 'sin proyecto'
      const ctx = {
        cambios_de_estado: proyectos.flatMap((p) =>
          (p.hist || []).filter((h) => h.t >= desde).map((h) => ({ proyecto: p.name, nuevo_estado: h.e }))),
        proyectos_activos: proyectos.map((p) => ({ nombre: p.name, estado: p.estado })),
        tareas_completadas: tareas.filter((t) => (t.doneAt || 0) >= desde).map((t) => ({ t: t.titulo, por: nombreCorto(t.asignada), proyecto: pName(t.projectId) })),
        tareas_creadas: tareas.filter((t) => t.created >= desde && t.estado !== 'hecha').map((t) => ({ t: t.titulo, para: nombreCorto(t.asignada) })),
        tareas_atrasadas: tareas.filter((t) => t.estado !== 'hecha' && t.vence && t.vence < new Date().toISOString().slice(0, 10)).map((t) => ({ t: t.titulo, de: nombreCorto(t.asignada), vencia: t.vence })),
        notas_del_equipo: notas.filter((n) => n.created >= desde).map((n) => ({ de: nombreCorto(n.autor), proyecto: pName(n.projectId), nota: n.texto.slice(0, 180) })),
      }
      const res = await complete({
        system: 'Eres el asistente de dirección de Ready Eventos, empresa española de diseño y montaje de stands de feria. Redactas resúmenes ejecutivos claros, concretos y accionables, en español de España. Sin markdown, sin asteriscos: párrafos cortos y guiones para las listas.',
        messages: [{ role: 'user', content: 'Actividad de la última semana del equipo:\n' + JSON.stringify(ctx, null, 1) + '\n\nRedacta un resumen ejecutivo breve (150-250 palabras): 1) qué ha avanzado, 2) qué está pendiente o atascado (especialmente tareas atrasadas), 3) recomendación de prioridades para la próxima semana. Si apenas hay actividad, dilo sin adornos.' }],
        maxTokens: 2000,
      })
      setTexto(String(res).trim())
    } catch (e: any) {
      setError('No se pudo generar el resumen: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={() => { setOpen(true); if (!texto) generar() }}
        title="Resumen ejecutivo de los últimos 7 días con IA"
        style={{ border: '1px solid #DCD9D2', background: '#fff', color: '#17161A', borderRadius: 9, padding: '12px 16px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: SANS }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="#D6197E"><path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2z" /></svg>
        Resumen semanal
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(23,22,26,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: SANS }}>
          <style>{KIT_CSS}</style>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 26, width: '100%', maxWidth: 560, maxHeight: '80vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 24px 70px rgba(23,22,26,0.35)', animation: 'tkFadeUp 0.18s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 800, flex: 1, color: '#17161A' }}>Resumen de la semana</div>
              <button onClick={generar} disabled={busy} title="Volver a generar" style={{ border: '1px solid #DCD9D2', background: '#fff', borderRadius: 7, padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', color: '#55524D' }}>↻</button>
              <button onClick={() => setOpen(false)} style={{ border: 'none', background: 'none', fontSize: 18, color: '#8A867F', cursor: 'pointer' }}>×</button>
            </div>
            {busy && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#6E6B66', fontSize: 12.5 }}>
                <span style={{ width: 15, height: 15, border: '3px solid rgba(214,25,126,0.25)', borderTopColor: '#D6197E', borderRadius: '50%', display: 'inline-block', animation: 'gcspin 0.8s linear infinite' }} />
                Analizando la actividad de la semana…
              </div>
            )}
            {error && <div style={{ fontSize: 12, color: '#C03A2B' }}>{error}</div>}
            {texto && !busy && (
              <div style={{ fontSize: 13, lineHeight: 1.7, color: '#26252A', whiteSpace: 'pre-wrap' }}>{texto}</div>
            )}
            <div style={{ fontFamily: MONO, fontSize: 9, color: '#B4B0A8' }}>Generado con IA a partir del historial de proyectos, tareas y notas de los últimos 7 días.</div>
          </div>
        </div>
      )}
    </>
  )
}
