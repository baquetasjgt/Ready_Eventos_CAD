import { Link } from 'react-router-dom'

// Pantalla para enlaces a proyectos que ya no existen (marcador antiguo o
// proyecto borrado). Sin esta guarda, el editor arrancaba vacío y el primer
// cambio creaba un documento fantasma que no aparece en el CRM.
export default function NoProyecto({ projectId }: { projectId: string }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#E8E6E1',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Archivo','Helvetica Neue',Helvetica,sans-serif",
        color: '#17161A',
        padding: 24,
      }}
    >
      <div
        style={{
          background: '#fff',
          border: '1px solid #E0DED8',
          borderRadius: 16,
          padding: 30,
          maxWidth: 420,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          boxShadow: '0 20px 50px rgba(23,22,26,0.12)',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 800 }}>Proyecto no encontrado</div>
        <div style={{ fontSize: 12.5, color: '#6E6B66', lineHeight: 1.6 }}>
          El proyecto <code style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{projectId}</code>{' '}
          no existe o se ha eliminado. Vuelve al inicio para abrir otro o crear uno nuevo.
        </div>
        <Link
          to="/"
          style={{
            background: '#D6197E',
            color: '#fff',
            borderRadius: 9,
            padding: '11px 16px',
            fontSize: 13,
            fontWeight: 700,
            textDecoration: 'none',
            textAlign: 'center',
          }}
        >
          ← Volver a proyectos
        </Link>
      </div>
    </div>
  )
}
