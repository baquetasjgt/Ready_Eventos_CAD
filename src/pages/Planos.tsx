import { useParams } from 'react-router-dom'
import { KEYS, read, type Project } from '../lib/storage'
import PlanosApp from '../features/planos/PlanosApp'
import NoProyecto from './NoProyecto'

// "Memoria y planos" — technical document editor (DXF → vector plans, láminas,
// cajetín, memoria IA, etiquetas, leyendas, rotulación, tablas, PDF a 300 ppp).
export default function Planos() {
  const { projectId = '' } = useParams()
  const existe = (read<{ list: Project[] }>(KEYS.projects)?.list || []).some((p) => p.id === projectId)
  if (!existe) return <NoProyecto projectId={projectId} />
  // Remount al cambiar de proyecto: limpia cachés, deshacer y estado interno.
  return <PlanosApp key={projectId} />
}
