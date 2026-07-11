import DocShell from './DocShell'
import { KEYS } from '../lib/storage'

export default function Planos() {
  return (
    <DocShell
      title="Memoria y planos"
      subtitle="Documento técnico: planos vectoriales desde DXF (detección de láminas por marcos NO-PLOT, capas/colores/grosores del CAD), cajetín configurable, memoria con IA, etiquetas y leyendas, zonas de rotulación, tablas Excel y exportación a PDF a 300 ppp."
      payloadKey={KEYS.planos}
    />
  )
}
