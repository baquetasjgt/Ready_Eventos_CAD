import { useParams } from 'react-router-dom'
import { KEYS, read, type Project } from '../lib/storage'
import VentaApp from '../features/venta/VentaApp'
import NoProyecto from './NoProyecto'

export default function Venta() {
  const { projectId = '' } = useParams()
  const existe = (read<{ list: Project[] }>(KEYS.projects)?.list || []).some((p) => p.id === projectId)
  if (!existe) return <NoProyecto projectId={projectId} />
  // Remount when the project changes so the editor reloads its payload cleanly.
  return <VentaApp key={projectId} projectId={projectId} />
}
