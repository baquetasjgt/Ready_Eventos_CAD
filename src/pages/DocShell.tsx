import { Link, useParams } from 'react-router-dom'
import { KEYS, read } from '../lib/storage'

// Temporary shell for the two per-project documents while their full editors
// are built. Confirms the project is correctly assigned (shared localStorage
// schema) and links back to the CRM.
export default function DocShell({
  title,
  subtitle,
  payloadKey,
}: {
  title: string
  subtitle: string
  payloadKey: (id: string) => string
}) {
  const { projectId = '' } = useParams()
  const proj = (read<{ list: { id: string; name: string }[] }>(KEYS.projects)?.list || []).find(
    (p) => p.id === projectId,
  )
  const payload = read<any>(payloadKey(projectId))
  const name = proj?.name || payload?.project?.proyecto || payload?.datos?.cliente || 'Proyecto'

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#E8E6E1',
        color: '#17161A',
        fontFamily: "'Archivo','Helvetica Neue',Helvetica,sans-serif",
      }}
    >
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '44px 28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <img src="/assets/logo.png" alt="Ready Eventos" style={{ width: 46, height: 'auto' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.01em' }}>{title}</div>
            <div
              style={{
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 10,
                color: '#8A867F',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              {name}
            </div>
          </div>
          <Link
            to="/"
            style={{
              textDecoration: 'none',
              border: '1px solid #DCD9D2',
              background: '#fff',
              color: '#17161A',
              borderRadius: 9,
              padding: '10px 16px',
              fontSize: 12.5,
              fontWeight: 700,
            }}
          >
            ← Inicio
          </Link>
        </div>
        <div
          style={{
            background: '#fff',
            border: '1px solid #E0DED8',
            borderRadius: 14,
            padding: 40,
            fontSize: 13.5,
            lineHeight: 1.7,
            color: '#55524D',
            boxShadow: '0 10px 30px rgba(23,22,26,0.05)',
          }}
        >
          <p style={{ marginTop: 0 }}>{subtitle}</p>
          <p style={{ marginBottom: 0, color: '#8A867F', fontSize: 12.5 }}>
            El editor completo de esta sección se implementa a continuación. El proyecto ya está
            asignado y sus datos guardados — al abrir el editor definitivo cargarán automáticamente.
          </p>
        </div>
      </div>
    </div>
  )
}
