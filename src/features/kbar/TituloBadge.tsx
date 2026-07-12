// Contador en el título de la pestaña del navegador: «(3) Ready Eventos…»
// = tareas pendientes para mí + notas del equipo sin leer. Sin interfaz.

import { useEffect } from 'react'
import type { Nota, Tarea } from '../../lib/storage'
import { myEmail } from '../../lib/team'
import { listNotas, listTareas, useLista } from '../tareas/kit'
import { getSeen } from '../tareas/NotasDrawer'

const BASE = 'Ready Eventos · Generador de presentaciones CAD'

export default function TituloBadge() {
  const [tareas] = useLista<Tarea>(listTareas)
  const [notas] = useLista<Nota>(listNotas)

  useEffect(() => {
    const me = myEmail()
    const seen = getSeen()
    const nT = tareas.filter((t) => t.estado !== 'hecha' && t.asignada === me).length
    const nN = notas.filter((n) => n.autor !== me && n.created > (seen[n.projectId] || 0)).length
    const n = nT + nN
    document.title = (n > 0 ? `(${n}) ` : '') + BASE
  }, [tareas, notas])

  return null
}
