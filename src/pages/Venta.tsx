import { useParams } from 'react-router-dom'
import VentaApp from '../features/venta/VentaApp'

export default function Venta() {
  const { projectId = '' } = useParams()
  // Remount when the project changes so the editor reloads its payload cleanly.
  return <VentaApp key={projectId} projectId={projectId} />
}
