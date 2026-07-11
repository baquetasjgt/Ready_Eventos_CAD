import DocShell from './DocShell'
import { KEYS } from '../lib/storage'

export default function Venta() {
  return (
    <DocShell
      title="Documento de venta"
      subtitle="Presentación visual de venta: brief → la IA compone las láminas con textos reescritos (retórica arquitectónica + neuromarketing), imágenes con máscaras y efectos, collage, y presupuesto corporativo desde Excel/PDF."
      payloadKey={KEYS.venta}
    />
  )
}
