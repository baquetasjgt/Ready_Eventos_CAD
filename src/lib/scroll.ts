// Desplazamiento suave hasta un elemento, con reintentos por si aún no está
// renderizado (cambio de pestaña o de vista en el mismo tick).
export function scrollAEl(selector: string, block: ScrollLogicalPosition = 'center', tries = 15): void {
  const go = (left: number) => {
    const el = document.querySelector(selector)
    if (el) el.scrollIntoView({ behavior: 'smooth', block })
    else if (left > 0) setTimeout(() => go(left - 1), 150)
  }
  go(tries)
}
