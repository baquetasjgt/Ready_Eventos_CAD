import { useEffect, useState } from 'react'
import {
  getCloudIssues,
  resolveCloudIssue,
  subscribeCloudIssues,
  type CloudIssue,
} from '../../lib/cloud-events'

export default function CloudIssues() {
  const [issues, setIssues] = useState<CloudIssue[]>(getCloudIssues)
  const [retrying, setRetrying] = useState<string | null>(null)

  useEffect(() => subscribeCloudIssues(setIssues), [])

  if (!issues.length) return null

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', right: 16, bottom: 16, zIndex: 100,
        width: 'min(360px, calc(100vw - 32px))', display: 'flex',
        flexDirection: 'column', gap: 8,
        fontFamily: "'Archivo','Helvetica Neue',Helvetica,sans-serif",
      }}
    >
      {issues.map((issue) => (
        <div key={issue.id} style={{
          border: '1px solid #E3B8AF', borderLeft: '4px solid #C03A2B',
          borderRadius: 8, background: '#FFFDFC',
          boxShadow: '0 12px 30px rgba(23,22,26,0.18)',
          padding: '12px 12px 11px', color: '#17161A',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800 }}>{issue.title}</div>
              <div style={{ marginTop: 4, fontSize: 11.5, lineHeight: 1.45, color: '#6E6B66' }}>
                {issue.message}
              </div>
            </div>
            <button type="button" onClick={() => resolveCloudIssue(issue.id)}
              title="Ocultar aviso" aria-label="Ocultar aviso" style={{
                border: 'none', background: 'none', color: '#8A867F', cursor: 'pointer',
                fontSize: 18, lineHeight: 1, padding: 0,
              }}>×</button>
          </div>
          {issue.retry && (
            <button type="button" disabled={retrying === issue.id}
              onClick={async () => {
                setRetrying(issue.id)
                try { if (await issue.retry?.()) resolveCloudIssue(issue.id) }
                finally { setRetrying(null) }
              }}
              style={{
                marginTop: 9, border: '1px solid #D6A39A', borderRadius: 6,
                background: '#fff', color: '#8F2E24', padding: '6px 9px',
                fontSize: 11.5, fontWeight: 700,
                cursor: retrying === issue.id ? 'wait' : 'pointer',
                opacity: retrying === issue.id ? 0.6 : 1,
              }}>
              {retrying === issue.id ? 'Reintentando…' : 'Reintentar'}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
