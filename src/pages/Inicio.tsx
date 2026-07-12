import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  KEYS,
  read,
  write,
  idbGet,
  idbSet,
  idbDel,
  type Project,
  type Cliente,
  type Feria,
  type Proveedor,
  type Contacto,
} from '../lib/storage'
import { ESTADOS, COLORES } from '../lib/theme'
import { pdfText } from '../lib/pdf'
import ChatAssistant from '../features/inicio/ChatAssistant'
import TareasPanel from '../features/tareas/TareasPanel'
import NotasDrawer, { getSeen } from '../features/tareas/NotasDrawer'
import { KIT_CSS, listNotas, listTareas, useLista } from '../features/tareas/kit'
import { menciones, miembrosCache, myEmail } from '../lib/team'
import type { Nota, Tarea } from '../lib/storage'

type Tab = 'proyectos' | 'tareas' | 'clientes' | 'ferias' | 'proveedores'

const emptyContacto = (): Contacto => ({ nombre: '', cargo: '', telefono: '', email: '' })
const norm = (t: unknown) =>
  String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })

// shared inline style fragments
const monoLabel: React.CSSProperties = {
  fontFamily: "'JetBrains Mono',monospace",
  fontSize: 9.5,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#8A867F',
}
const colHead: React.CSSProperties = {
  fontFamily: "'JetBrains Mono',monospace",
  fontSize: 9,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#8A867F',
}
const inlineInput: React.CSSProperties = {
  border: '1px solid transparent',
  background: 'transparent',
  borderRadius: 6,
  padding: '6px 8px',
  outline: 'none',
  width: '100%',
  minWidth: 0,
}
const cellInput: React.CSSProperties = {
  border: '1px solid #EFEDE8',
  background: '#FDFDFC',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 12,
  color: '#17161A',
  outline: 'none',
  width: '100%',
  minWidth: 0,
}
const ROW_GRID =
  'minmax(140px,1.6fr) minmax(80px,1fr) minmax(80px,1fr) minmax(136px,158px) 56px max-content'

// Ids únicos: Date.now() a secas colisionaba con doble clic o entre dispositivos.
const uid = (prefix: string) =>
  prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

// Borra de la base local de imágenes del Documento de venta (gencad-venta) los
// blobs de un proyecto eliminado — antes quedaban huérfanos para siempre.
function delVentaImgs(ids: string[]) {
  if (!ids.length) return
  try {
    const rq = indexedDB.open('gencad-venta', 1)
    rq.onupgradeneeded = () => rq.result.createObjectStore('imgs')
    rq.onsuccess = () => {
      try {
        const tx = rq.result.transaction('imgs', 'readwrite')
        for (const id of ids) tx.objectStore('imgs').delete(id)
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}
const CONTACT_GRID =
  'minmax(110px,1.2fr) minmax(90px,1fr) minmax(90px,0.9fr) minmax(110px,1.1fr) max-content'

export default function Inicio() {
  const navigate = useNavigate()

  const [tab, setTab] = useState<Tab>('proyectos')
  const [list, setList] = useState<Project[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [ferias, setFerias] = useState<Feria[]>([])
  const [proveedores, setProveedores] = useState<Proveedor[]>([])

  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [quickCliente, setQuickCliente] = useState(false)
  const [quick, setQuick] = useState<Record<string, string>>({})

  const [delPend, setDelPend] = useState<string | null>(null)
  const [delPendC, setDelPendC] = useState<string | null>(null)
  const [delPendF, setDelPendF] = useState<string | null>(null)
  const [delPendV, setDelPendV] = useState<string | null>(null)
  const [delPendDoc, setDelPendDoc] = useState<string | null>(null)
  const [notasProj, setNotasProj] = useState<string | null>(null)
  const [notasAll] = useLista<Nota>(listNotas)
  const [tareasAll] = useLista<Tarea>(listTareas)
  const [subiendo, setSubiendo] = useState<string | null>(null)
  const [histOpen, setHistOpen] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  // ---- boot / reload ----
  const boot = useCallback(() => {
    const stored = read<{ list: Project[]; current: string | null }>(KEYS.projects)
    const sh = stored && Array.isArray(stored.list) ? stored : { list: [], current: null }
    // Migración de los registros del prototipo SOLO en el primer arranque:
    // volver a mezclarlos en cada boot resucitaba proyectos borrados desde
    // otro dispositivo (con estado y fecha falsos).
    if (!stored) {
      let changed = false
      for (const k of [KEYS.planosList, KEYS.ventaList]) {
        const m = read<{ list: { id: string; name?: string }[] }>(k)
        if (m && Array.isArray(m.list)) {
          for (const p of m.list) {
            if (!sh.list.some((x) => x.id === p.id)) {
              sh.list.push({
                id: p.id,
                name: p.name || 'Proyecto',
                estado: 'Concepto presentado',
                created: Date.now(),
              })
              changed = true
            }
          }
        }
      }
      if (changed) write(KEYS.projects, sh)
    }
    setList(sh.list)
    setClientes(read<{ list: Cliente[] }>(KEYS.clientes)?.list || [])
    setFerias(read<{ list: Feria[] }>(KEYS.ferias)?.list || [])
    setProveedores(read<{ list: Proveedor[] }>(KEYS.proveedores)?.list || [])
  }, [])

  useEffect(() => {
    boot()
    const reload = () => boot()
    window.addEventListener('pageshow', reload)
    window.addEventListener('focus', reload)
    // El motor de sincronización avisa cuando refresca datos desde la nube.
    window.addEventListener('ready-sync-pulled', reload)
    return () => {
      window.removeEventListener('pageshow', reload)
      window.removeEventListener('focus', reload)
      window.removeEventListener('ready-sync-pulled', reload)
    }
  }, [boot])

  // ---- persistence helpers ----
  const save = useCallback((next: Project[]) => {
    const sh = read<{ list: Project[]; current: string | null }>(KEYS.projects) || {
      list: [],
      current: null,
    }
    sh.list = next
    write(KEYS.projects, sh)
    setList(next)
  }, [])
  const saveClientes = (next: Cliente[]) => {
    write(KEYS.clientes, { list: next })
    setClientes(next)
  }
  const saveFerias = (next: Feria[]) => {
    write(KEYS.ferias, { list: next })
    setFerias(next)
  }
  const saveProveedores = (next: Proveedor[]) => {
    write(KEYS.proveedores, { list: next })
    setProveedores(next)
  }

  const clienteById = (id?: string) => clientes.find((c) => c.id === id) || null
  const feriaById = (id?: string) => ferias.find((f) => f.id === id) || null
  const proveedorById = (id?: string) => proveedores.find((v) => v.id === id) || null
  const updCliente = (id: string, patch: Partial<Cliente>) =>
    saveClientes(clientes.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const updFeria = (id: string, patch: Partial<Feria>) =>
    saveFerias(ferias.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  const updProveedor = (id: string, patch: Partial<Proveedor>) =>
    saveProveedores(proveedores.map((v) => (v.id === id ? { ...v, ...patch } : v)))

  // Cacheado por id: se llama en cada render (columna feria y búsqueda) y el
  // payload completo del documento puede ser grande — reparsearlo por pulsación
  // de tecla notaba en proyectos con muchas láminas.
  const ventaCacheRef = useRef<Record<string, { raw: string | null; datos: any }>>({})
  const ventaDatos = (id: string) => {
    let raw: string | null = null
    try { raw = localStorage.getItem(KEYS.venta(id)) } catch { /* ignore */ }
    const c = ventaCacheRef.current[id]
    if (c && c.raw === raw) return c.datos
    let datos: any = {}
    try { datos = (raw ? JSON.parse(raw) : null)?.datos || {} } catch { /* ignore */ }
    ventaCacheRef.current[id] = { raw, datos }
    return datos
  }

  // ---- navigation: pin project into all three layers, then go ----
  const abrir = (id: string, target: 'venta' | 'planos') => {
    const sh = read<{ list: Project[]; current: string | null }>(KEYS.projects) || {
      list: list,
      current: null,
    }
    sh.current = id
    write(KEYS.projects, sh)
    const entry = list.find((x) => x.id === id) || { id, name: 'Proyecto' }
    for (const k of [KEYS.planosList, KEYS.ventaList]) {
      const m = read<{ list: { id: string; name?: string }[]; current: string | null }>(k) || {
        list: [],
        current: null,
      }
      if (!m.list.some((x) => x.id === id)) m.list.push({ id, name: entry.name })
      m.current = id
      write(k, m)
    }
    navigate(`/${target}/${id}`)
  }

  const asignarCliente = (pId: string, cId: string) => {
    const prev = list.find((x) => x.id === pId)
    const prevCli = clienteById(prev?.clienteId)
    save(list.map((x) => (x.id === pId ? { ...x, clienteId: cId } : x)))
    const c = clienteById(cId)
    if (!c) return // desasignar no borra lo que el usuario escribió en el documento
    const key = KEYS.venta(pId)
    const v = read<{ datos: any }>(key)
    if (v && v.datos) {
      // Rellenar solo si el campo está vacío o aún tiene el cliente anterior:
      // no machacar un texto editado a mano en el Documento de venta.
      const cur = String(v.datos.cliente || '').trim()
      if (!cur || (prevCli && cur === prevCli.nombre)) {
        v.datos = { ...v.datos, cliente: c.nombre, web: c.web || v.datos.web || '' }
        write(key, v)
      }
    }
  }

  // ---- create project ----
  const crear = () => {
    const f = form
    const q = quick
    let clienteId = f.clienteId || ''
    let cliente = clienteById(clienteId)
    if (!cliente && quickCliente && String(q.nombre || '').trim()) {
      clienteId = uid('c')
      cliente = {
        id: clienteId,
        nombre: q.nombre.trim(),
        web: q.web || '',
        contacto: q.contacto || '',
        email: q.email || '',
        telefono: q.telefono || '',
        notas: '',
        created: Date.now(),
      }
      saveClientes([...clientes, cliente])
    }
    const feria = feriaById(f.feriaId || '')
    const feriaTxt = feria
      ? [feria.nombre, feria.recinto, feria.fechas].filter(Boolean).join(' · ')
      : ''
    const name =
      String(f.nombre || '').trim() ||
      (cliente ? cliente.nombre + (feria ? ' — ' + feria.nombre : '') : '')
    if (!name) {
      setFormError('Indica el nombre del proyecto o asigna un cliente.')
      return
    }
    const id = uid('p')
    const hoy = new Date().toISOString().slice(0, 10)
    write(KEYS.venta(id), {
      fase: 'brief',
      tab: 'laminas',
      datos: {
        cliente: cliente ? cliente.nombre : '',
        web: cliente ? cliente.web : '',
        feria: feriaTxt,
        stand: f.stand || '',
        objetivo: f.objetivo || '',
        productos: f.productos || '',
        descripcion: f.descripcion || '',
        directrices: '',
      },
      imagenes: [],
      slides: [],
    })
    write(KEYS.planos(id), {
      project: {
        empresa: 'Ready Eventos',
        proyecto: name,
        subtitulo: 'Proyecto de diseño y montaje de stand',
        arquitecto: '',
        contacto:
          'Calle Soria, 34 · 28864 Ajalvir (Madrid) · +34 677 437 113 · ready@readyeventos.com',
        fecha: hoy,
      },
      drawings: [],
      sheets: [],
      tables: [],
      anexos: [],
      seq: 50,
    })
    const next: Project[] = [
      ...list,
      {
        id,
        name,
        estado: 'Concepto presentado',
        clienteId,
        feriaId: f.feriaId || '',
        created: Date.now(),
        hist: [{ e: 'Concepto presentado', t: Date.now() }],
      },
    ]
    save(next)
    setCreating(false)
    setForm({})
    setQuick({})
    setQuickCliente(false)
    setFormError('')
    abrir(id, 'venta')
  }

  // ---- feria PDF upload ----
  const onDocFile = async (feriaId: string, ev: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(ev.target.files || [])]
    ev.target.value = ''
    if (!files.length) return
    setSubiendo(feriaId)
    for (const file of files) {
      try {
        const buf = await file.arrayBuffer()
        const text = await pdfText(buf.slice(0))
        const docId = uid('doc')
        await idbSet(docId, {
          name: file.name,
          blob: new Blob([buf], { type: 'application/pdf' }),
          text,
        })
        const f = feriaById(feriaId)
        if (f)
          updFeria(feriaId, {
            docs: [...(f.docs || []), { id: docId, name: file.name, chars: text.length }],
          })
      } catch {
        /* ignore */
      }
    }
    setSubiendo(null)
  }
  const abrirDoc = async (docId: string) => {
    // Abrir la ventana de forma síncrona (dentro del gesto de clic): si se
    // abre tras el await, el bloqueador de ventanas emergentes la anula.
    const w = window.open('about:blank', '_blank')
    const d = await idbGet(docId)
    if (d && d.blob) {
      const url = URL.createObjectURL(d.blob)
      if (w) w.location.href = url
      else window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } else if (w) w.close()
  }

  // ---- chat context ----
  const buildContext = useCallback(
    async (scopeFeriaId: string) => {
      const proyectos = list.map((p) => ({
        proyecto: p.name,
        estado: p.estado,
        cliente: clienteById(p.clienteId)?.nombre || ventaDatos(p.id).cliente || '',
        feria: feriaById(p.feriaId)?.nombre || ventaDatos(p.id).feria || '',
        proveedores: (p.provIds || []).map((id) => proveedorById(id)?.nombre).filter(Boolean),
      }))
      const provs = proveedores.map((v) => ({
        nombre: v.nombre,
        especialidad: v.especialidad,
        web: v.web,
        notas: v.notas,
        contactos: (v.contactos || []).map((c) => ({
          nombre: c.nombre,
          cargo: c.cargo,
          telefono: c.telefono,
          email: c.email,
        })),
      }))
      const clis = clientes.map((c) => ({
        nombre: c.nombre,
        web: c.web,
        notas: c.notas,
        contactos:
          c.contactos && c.contactos.length
            ? c.contactos
            : [{ nombre: c.contacto || '', telefono: c.telefono || '', email: c.email || '' }],
      }))
      const fers = ferias.map((f) => ({
        nombre: f.nombre,
        recinto: f.recinto,
        fechas: f.fechas,
        web: f.web,
        contactos: (f.contactos || []).map((c) => ({
          nombre: c.nombre,
          cargo: c.cargo,
          telefono: c.telefono,
          email: c.email,
        })),
        documentos: (f.docs || []).map((d) => d.name),
      }))
      let docsTxt = ''
      const scope = scopeFeriaId ? ferias.filter((f) => f.id === scopeFeriaId) : ferias
      let total = 0
      for (const f of scope) {
        for (const d of f.docs || []) {
          if (total > 90000) break
          const stored = await idbGet(d.id)
          const t = stored?.text || ''
          if (!t) continue
          const cut = t.slice(0, 30000)
          total += cut.length
          docsTxt +=
            '\n\n===== NORMATIVA «' +
            d.name +
            '» (feria ' +
            f.nombre +
            ') =====\n' +
            cut +
            (t.length > cut.length ? '\n[…documento truncado…]' : '')
        }
      }
      return (
        'Eres el asistente interno de Ready Eventos (readyeventos.com), empresa española de diseño, producción y montaje de stands de feria (Grupo IGC, Ajalvir, Madrid). Respondes en español, de forma breve y práctica, a preguntas del equipo sobre sus proyectos, clientes, ferias, proveedores y la normativa adjunta. Formato: texto plano con **negritas** y listas sencillas; nunca tablas Markdown ni bloques de código, salvo que te pidan código. Si la respuesta está en la normativa, cita el documento y, si puedes, el punto o apartado. Si no tienes el dato, dilo claramente.\n\nDATOS DEL CRM:\nPROYECTOS: ' +
        JSON.stringify(proyectos) +
        '\nCLIENTES: ' +
        JSON.stringify(clis) +
        '\nFERIAS: ' +
        JSON.stringify(fers) +
        '\nPROVEEDORES: ' +
        JSON.stringify(provs) +
        (docsTxt
          ? '\n\nDOCUMENTACIÓN (texto extraído de los PDF):' + docsTxt
          : '\n\n(No hay PDFs de normativa subidos todavía.)')
      )
    },
    [list, clientes, ferias, proveedores],
  )

  // ---- derived / filters ----
  const q = norm(busca)
  const clienteOptions = clientes.map((c) => ({ v: c.id, label: c.nombre || '(sin nombre)' }))
  const feriaOptions = ferias.map((f) => ({ v: f.id, label: f.nombre || '(sin nombre)' }))

  const matchProy = (p: Project) => {
    if (!q) return true
    const cli = clienteById(p.clienteId)
    const fer = feriaById(p.feriaId)
    const dat = ventaDatos(p.id)
    return norm(
      [p.name, p.estado, cli?.nombre, fer?.nombre, dat.cliente, dat.feria].join(' '),
    ).includes(q)
  }
  const matchCli = (c: Cliente) =>
    !q ||
    norm(
      [
        c.nombre,
        c.web,
        c.notas,
        ...(c.contactos || []).map((x) => [x.nombre, x.email, x.telefono, x.cargo].join(' ')),
        c.contacto,
        c.email,
        c.telefono,
      ].join(' '),
    ).includes(q)
  const matchFer = (f: Feria) =>
    !q ||
    norm(
      [
        f.nombre,
        f.recinto,
        f.fechas,
        f.web,
        ...(f.contactos || []).map((x) => [x.nombre, x.cargo, x.email].join(' ')),
        ...(f.docs || []).map((d) => d.name),
      ].join(' '),
    ).includes(q)
  const matchProv = (v: Proveedor) =>
    !q ||
    norm(
      [
        v.nombre,
        v.especialidad,
        v.web,
        v.notas,
        ...(v.contactos || []).map((x) => [x.nombre, x.cargo, x.email, x.telefono].join(' ')),
      ].join(' '),
    ).includes(q)

  const rows = list.filter(matchProy)
  const clientRows = clientes.filter(matchCli)
  const feriaRows = ferias.filter(matchFer)
  const provRows = proveedores.filter(matchProv)

  const buscaSinResultados =
    !!q &&
    ((tab === 'proyectos' && rows.length === 0 && list.length > 0) ||
      (tab === 'clientes' && clientRows.length === 0 && clientes.length > 0) ||
      (tab === 'ferias' && feriaRows.length === 0 && ferias.length > 0) ||
      (tab === 'proveedores' && provRows.length === 0 && proveedores.length > 0))

  const titulo =
    tab === 'clientes'
      ? 'Clientes'
      : tab === 'ferias'
        ? 'Ferias'
        : tab === 'proveedores'
          ? 'Proveedores'
          : tab === 'tareas'
            ? 'Tareas del equipo'
            : 'Proyectos'
  const buscaPh =
    tab === 'clientes'
      ? 'Buscar clientes…'
      : tab === 'ferias'
        ? 'Buscar ferias…'
        : tab === 'proveedores'
          ? 'Buscar proveedores…'
          : 'Buscar proyectos…'

  const tabBtn = (on: boolean) => ({
    bd: on ? '#17161A' : '#D8D5CE',
    bg: on ? '#17161A' : 'transparent',
    fg: on ? '#FFFFFF' : '#6E6B66',
  })

  const primaryBtn: React.CSSProperties = {
    border: 'none',
    background: '#D6197E',
    color: '#fff',
    borderRadius: 9,
    padding: '12px 20px',
    fontSize: 13.5,
    fontWeight: 700,
    cursor: 'pointer',
    letterSpacing: '0.01em',
  }

  // --- colaboración: contadores para la pestaña Tareas y las filas ---
  const me = myEmail()
  const misPendientes = tareasAll.filter((t) => t.estado !== 'hecha' && t.asignada === me).length
  const notasSeen = getSeen()
  const notasNuevasDe = (pid: string) =>
    notasAll.some((n) => n.projectId === pid && n.autor !== me && n.created > (notasSeen[pid] || 0))
  const hayNotasNuevas = notasAll.some(
    (n) => n.autor !== me && n.created > (notasSeen[n.projectId] || 0),
  )
  const hayMencionNueva = notasAll.some(
    (n) => n.autor !== me && n.created > (notasSeen[n.projectId] || 0) && menciones(n.texto, miembrosCache()).includes(me),
  )
  void hayMencionNueva

  const delWith = (pend: boolean): React.CSSProperties => ({
    border: 'none',
    background: 'none',
    color: pend ? '#C03A2B' : '#B4B0A8',
    fontSize: 15,
    cursor: 'pointer',
    padding: '2px 5px',
    fontWeight: pend ? 700 : 400,
    whiteSpace: 'nowrap',
  })

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#E8E6E1',
        color: '#17161A',
        fontFamily: "'Archivo','Helvetica Neue',Helvetica,sans-serif",
      }}
    >
      <style>{KIT_CSS}</style>
      <div
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: '44px 28px 110px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img src="/assets/logo.png" alt="Ready Eventos" style={{ width: 46, height: 'auto' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
            <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.01em' }}>{titulo}</div>
            <div
              style={{
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 10,
                color: '#8A867F',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              Ready Eventos · CRM · documento de venta · memoria y planos
            </div>
          </div>
          {tab === 'proyectos' && (
            <button onClick={() => setCreating(true)} style={primaryBtn}>
              + Nuevo proyecto
            </button>
          )}
          {tab === 'clientes' && (
            <button
              onClick={() =>
                saveClientes([
                  ...clientes,
                  {
                    id: uid('c'),
                    nombre: '',
                    web: '',
                    contacto: '',
                    email: '',
                    telefono: '',
                    notas: '',
                    contactos: [emptyContacto()],
                    created: Date.now(),
                  },
                ])
              }
              style={primaryBtn}
            >
              + Nuevo cliente
            </button>
          )}
          {tab === 'ferias' && (
            <button
              onClick={() =>
                saveFerias([
                  ...ferias,
                  {
                    id: uid('f'),
                    nombre: '',
                    recinto: '',
                    fechas: '',
                    web: '',
                    contactos: [emptyContacto()],
                    docs: [],
                    created: Date.now(),
                  },
                ])
              }
              style={primaryBtn}
            >
              + Nueva feria
            </button>
          )}
          {tab === 'proveedores' && (
            <button
              onClick={() =>
                saveProveedores([
                  ...proveedores,
                  {
                    id: uid('v'),
                    nombre: '',
                    especialidad: '',
                    web: '',
                    notas: '',
                    contactos: [emptyContacto()],
                    created: Date.now(),
                  },
                ])
              }
              style={primaryBtn}
            >
              + Nuevo proveedor
            </button>
          )}
        </div>

        {/* Tabs + search */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(
            [
              ['proyectos', 'Proyectos'],
              ['tareas', 'Tareas'],
              ['clientes', 'Clientes'],
              ['ferias', 'Ferias'],
              ['proveedores', 'Proveedores'],
            ] as [Tab, string][]
          ).map(([t, label]) => {
            const b = tabBtn(tab === t)
            return (
              <button
                key={t}
                onClick={() => {
                  setTab(t)
                  if (t !== 'proyectos') setCreating(false)
                }}
                style={{
                  padding: '8px 16px',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  fontFamily: "'JetBrains Mono',monospace",
                  border: `1px solid ${b.bd}`,
                  background: b.bg,
                  color: b.fg,
                }}
              >
                {label}
                {t === 'tareas' && misPendientes > 0 && (
                  <span style={{ marginLeft: 7, background: tab === t ? '#D6197E' : '#17161A', color: '#fff', borderRadius: 999, padding: '1px 7px', fontSize: 9.5, fontWeight: 700 }}>{misPendientes}</span>
                )}
                {t === 'tareas' && hayNotasNuevas && (
                  <span title="Hay notas nuevas del equipo" style={{ display: 'inline-block', marginLeft: 6, width: 7, height: 7, borderRadius: '50%', background: '#D6197E', animation: 'tkDot 1.4s ease infinite' }} />
                )}
              </button>
            )
          })}
          <div style={{ flex: 1 }} />
          {tab !== 'tareas' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              background: '#fff',
              border: '1px solid #DCD9D2',
              borderRadius: 999,
              padding: '7px 13px',
              minWidth: 240,
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#8A867F"
              strokeWidth="2.4"
              strokeLinecap="round"
              style={{ flex: 'none' }}
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.5-4.5" />
            </svg>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={buscaPh}
              style={{
                border: 'none',
                background: 'none',
                outline: 'none',
                fontSize: 12.5,
                color: '#17161A',
                flex: 1,
                minWidth: 0,
              }}
            />
            {!!q && (
              <button
                onClick={() => setBusca('')}
                style={{
                  border: 'none',
                  background: 'none',
                  color: '#B4B0A8',
                  fontSize: 13,
                  cursor: 'pointer',
                  padding: '0 2px',
                  flex: 'none',
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            )}
          </div>
          )}
        </div>

        {buscaSinResultados && (
          <div
            style={{
              background: '#fff',
              border: '1px solid #E0DED8',
              borderRadius: 14,
              padding: 30,
              textAlign: 'center',
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: 11,
              color: '#8A867F',
            }}
          >
            Sin resultados para «{busca}».
          </div>
        )}

        {/* Create form */}
        {creating && (
          <CreateForm
            form={form}
            setForm={setForm}
            quick={quick}
            setQuick={setQuick}
            quickCliente={quickCliente}
            setQuickCliente={setQuickCliente}
            formError={formError}
            setFormError={setFormError}
            clienteOptions={clienteOptions}
            feriaOptions={feriaOptions}
            onCancel={() => {
              setCreating(false)
              setFormError('')
            }}
            onCreate={crear}
          />
        )}

        {/* Proyectos */}
        {tab === 'proyectos' && (
          <>
            <div
              style={{
                background: '#fff',
                border: '1px solid #E0DED8',
                borderRadius: 14,
                overflowX: 'auto',
                boxShadow: '0 10px 30px rgba(23,22,26,0.05)',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: ROW_GRID,
                  gap: 10,
                  alignItems: 'center',
                  padding: '12px 18px',
                  borderBottom: '1px solid #ECEAE5',
                  background: '#F7F6F3',
                }}
              >
                <div style={colHead}>Proyecto</div>
                <div style={colHead}>Cliente</div>
                <div style={colHead}>Feria</div>
                <div style={colHead}>Estado</div>
                <div style={colHead}>Fecha</div>
                <div style={{ ...colHead, textAlign: 'right' }}>Documentos</div>
              </div>

              {rows.map((p) => (
                <ProjectRow
                  key={p.id}
                  p={p}
                  clienteOptions={clienteOptions}
                  feria={feriaById(p.feriaId)?.nombre || ventaDatos(p.id).feria || '—'}
                  histOpen={histOpen === p.id}
                  onHistToggle={() => setHistOpen(histOpen === p.id ? null : p.id)}
                  delPend={delPend === p.id}
                  proveedores={proveedores}
                  onName={(name) => {
                    save(list.map((x) => (x.id === p.id ? { ...x, name } : x)))
                    for (const k of [KEYS.planosList, KEYS.ventaList]) {
                      const m = read<{ list: { id: string; name?: string }[] }>(k)
                      if (m && m.list) {
                        m.list = m.list.map((x) => (x.id === p.id ? { ...x, name } : x))
                        write(k, m)
                      }
                    }
                    // Reflejar el nombre en el cajetín de los planos si el
                    // usuario no lo había personalizado allí.
                    const pk = KEYS.planos(p.id)
                    const pl = read<any>(pk)
                    if (pl?.project && pl.project.proyecto === p.name) {
                      pl.project = { ...pl.project, proyecto: name }
                      write(pk, pl)
                    }
                  }}
                  onCliente={(cId) => asignarCliente(p.id, cId)}
                  onEstado={(nuevo) =>
                    save(
                      list.map((x) => {
                        if (x.id !== p.id) return x
                        const h =
                          x.hist && x.hist.length
                            ? x.hist
                            : [{ e: x.estado || 'Concepto presentado', t: x.created || Date.now() }]
                        return { ...x, estado: nuevo, hist: [...h, { e: nuevo, t: Date.now() }] }
                      }),
                    )
                  }
                  onAddProv={(vid) =>
                    save(
                      list.map((x) =>
                        x.id === p.id ? { ...x, provIds: [...(x.provIds || []), vid] } : x,
                      ),
                    )
                  }
                  onQuitarProv={(vid) =>
                    save(
                      list.map((x) =>
                        x.id === p.id
                          ? { ...x, provIds: (x.provIds || []).filter((z) => z !== vid) }
                          : x,
                      ),
                    )
                  }
                  onAbrirVenta={() => abrir(p.id, 'venta')}
                  onAbrirPlanos={() => abrir(p.id, 'planos')}
                  onNotas={() => setNotasProj(p.id)}
                  nNotas={notasAll.filter((n) => n.projectId === p.id).length}
                  notasNew={notasNuevasDe(p.id)}
                  onDel={() => {
                    if (delPend !== p.id) {
                      setDelPend(p.id)
                      setTimeout(() => setDelPend((cur) => (cur === p.id ? null : cur)), 3000)
                      return
                    }
                    // Limpiar los blobs del proyecto en IndexedDB (imágenes del
                    // documento de venta y DXF de los planos): antes quedaban
                    // huérfanos ocupando espacio para siempre.
                    const venta = read<any>(KEYS.venta(p.id))
                    delVentaImgs(((venta?.imagenes as any[]) || []).map((im) => im.id).filter(Boolean))
                    const planos = read<any>(KEYS.planos(p.id))
                    for (const dr of (planos?.drawings as any[]) || []) {
                      idbDel('dxf-' + p.id + '-' + dr.id)
                      idbDel('dxf-' + dr.id)
                    }
                    try {
                      localStorage.removeItem(KEYS.planos(p.id))
                      localStorage.removeItem(KEYS.venta(p.id))
                    } catch {
                      /* ignore */
                    }
                    for (const k of [KEYS.planosList, KEYS.ventaList]) {
                      const m = read<{ list: { id: string }[]; current: string | null }>(k)
                      if (m && m.list) {
                        m.list = m.list.filter((x) => x.id !== p.id)
                        if (m.current === p.id) m.current = m.list.length ? m.list[0].id : null
                        write(k, m)
                      }
                    }
                    const shp = read<{ list: Project[]; current: string | null }>(KEYS.projects)
                    if (shp && shp.current === p.id) {
                      shp.current = null
                      write(KEYS.projects, shp)
                    }
                    setDelPend(null)
                    save(list.filter((x) => x.id !== p.id))
                  }}
                />
              ))}

              {list.length === 0 && (
                <EmptyGuide
                  onClientes={() => setTab('clientes')}
                  onFerias={() => setTab('ferias')}
                  onNuevo={() => setCreating(true)}
                />
              )}
            </div>

            <div style={{ fontSize: 11.5, color: '#8A867F', lineHeight: 1.6 }}>
              Pincha sobre una línea para entrar al proyecto. Dentro de cada proyecto tienes su{' '}
              <strong>Documento de venta</strong> y su <strong>Memoria y planos</strong>, siempre
              asignados al proyecto elegido.
            </div>
          </>
        )}

        {/* Tareas del equipo */}
        {tab === 'tareas' && (
          <TareasPanel proyectos={list} abrirNotas={(id) => setNotasProj(id)} />
        )}

        {/* Clientes */}
        {tab === 'clientes' && (
          <>
            {clientRows.map((c) => (
              <ClienteCard
                key={c.id}
                c={c}
                nProy={list.filter((p) => p.clienteId === c.id).length}
                delPend={delPendC === c.id}
                delStyle={delWith}
                onUpd={(patch) => updCliente(c.id, patch)}
                onDel={() => {
                  if (delPendC !== c.id) {
                    setDelPendC(c.id)
                    setTimeout(() => setDelPendC((cur) => (cur === c.id ? null : cur)), 3000)
                    return
                  }
                  setDelPendC(null)
                  save(list.map((p) => (p.clienteId === c.id ? { ...p, clienteId: '' } : p)))
                  saveClientes(clientes.filter((x) => x.id !== c.id))
                }}
              />
            ))}
            {clientes.length === 0 && (
              <EmptyBox>
                No hay clientes todavía.
                <br />
                Crea el primero con «+ Nuevo cliente».
              </EmptyBox>
            )}
            <div style={{ fontSize: 11.5, color: '#8A867F', lineHeight: 1.6 }}>
              Todos los campos se editan en línea y se guardan solos. Al crear un proyecto podrás
              asignarle cualquiera de estos clientes, y sus datos rellenan el brief automáticamente.
            </div>
          </>
        )}

        {/* Proveedores */}
        {tab === 'proveedores' && (
          <>
            {provRows.map((v) => (
              <ProveedorCard
                key={v.id}
                v={v}
                nProy={list.filter((p) => (p.provIds || []).includes(v.id)).length}
                delPend={delPendV === v.id}
                delStyle={delWith}
                onUpd={(patch) => updProveedor(v.id, patch)}
                onDel={() => {
                  if (delPendV !== v.id) {
                    setDelPendV(v.id)
                    setTimeout(() => setDelPendV((cur) => (cur === v.id ? null : cur)), 3000)
                    return
                  }
                  setDelPendV(null)
                  save(
                    list.map((p) => ({
                      ...p,
                      provIds: (p.provIds || []).filter((z) => z !== v.id),
                    })),
                  )
                  saveProveedores(proveedores.filter((x) => x.id !== v.id))
                }}
              />
            ))}
            {proveedores.length === 0 && (
              <EmptyBox>
                No hay proveedores todavía.
                <br />
                Crea el primero con «+ Nuevo proveedor».
              </EmptyBox>
            )}
            <div style={{ fontSize: 11.5, color: '#8A867F', lineHeight: 1.6 }}>
              Asigna proveedores a un proyecto desde la pestaña <strong>Proyectos</strong>: abre el
              panel ⏱ de la línea del proyecto y usa «+ añadir proveedor».
            </div>
          </>
        )}

        {/* Ferias */}
        {tab === 'ferias' && (
          <>
            {feriaRows.map((f) => (
              <FeriaCard
                key={f.id}
                f={f}
                delPend={delPendF === f.id}
                delStyle={delWith}
                subiendo={subiendo === f.id}
                onUpd={(patch) => updFeria(f.id, patch)}
                onDocFile={(ev) => onDocFile(f.id, ev)}
                onOpenDoc={abrirDoc}
                onDelDoc={(docId) => {
                  if (delPendDoc !== docId) {
                    setDelPendDoc(docId)
                    setTimeout(() => setDelPendDoc((cur) => (cur === docId ? null : cur)), 3000)
                    return
                  }
                  setDelPendDoc(null)
                  idbDel(docId)
                  updFeria(f.id, { docs: (f.docs || []).filter((x) => x.id !== docId) })
                }}
                delPendDoc={delPendDoc}
                onDel={() => {
                  if (delPendF !== f.id) {
                    setDelPendF(f.id)
                    setTimeout(() => setDelPendF((cur) => (cur === f.id ? null : cur)), 3000)
                    return
                  }
                  setDelPendF(null)
                  for (const d of f.docs || []) idbDel(d.id)
                  save(list.map((p) => (p.feriaId === f.id ? { ...p, feriaId: '' } : p)))
                  saveFerias(ferias.filter((x) => x.id !== f.id))
                }}
              />
            ))}
            {ferias.length === 0 && (
              <EmptyBox>
                No hay ferias todavía.
                <br />
                Crea la primera con «+ Nueva feria».
              </EmptyBox>
            )}
            <div style={{ fontSize: 11.5, color: '#8A867F', lineHeight: 1.6 }}>
              Sube la normativa en PDF: el texto se extrae automáticamente y el{' '}
              <strong>asistente</strong> (botón de abajo a la derecha) puede responderte cualquier
              duda usándolo.
            </div>
          </>
        )}
      </div>

      {notasProj && (() => {
        const pr = list.find((x) => x.id === notasProj)
        return pr ? <NotasDrawer proyecto={pr} onClose={() => setNotasProj(null)} /> : null
      })()}

      <ChatAssistant feriaOptions={feriaOptions} buildContext={buildContext} />
    </div>
  )
}

// ===================== sub-components =====================

function EmptyBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #E0DED8',
        borderRadius: 14,
        padding: 44,
        textAlign: 'center',
        fontFamily: "'JetBrains Mono',monospace",
        fontSize: 11,
        color: '#8A867F',
        lineHeight: 1.8,
      }}
    >
      {children}
    </div>
  )
}

function EmptyGuide({
  onClientes,
  onFerias,
  onNuevo,
}: {
  onClientes: () => void
  onFerias: () => void
  onNuevo: () => void
}) {
  const step = (n: string, title: string, body: string, btn: string, onClick: () => void, primary?: boolean) => (
    <div
      style={{
        border: '1px solid #E0DED8',
        borderRadius: 12,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: '#FAF9F7',
      }}
    >
      <div
        style={{
          fontFamily: "'JetBrains Mono',monospace",
          fontSize: 9.5,
          letterSpacing: '0.14em',
          color: '#D6197E',
          fontWeight: 600,
        }}
      >
        {n}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 11.5, color: '#6E6B66', lineHeight: 1.55 }}>{body}</div>
      <button
        onClick={onClick}
        style={{
          alignSelf: 'flex-start',
          border: primary ? 'none' : '1px solid #DCD9D2',
          background: primary ? '#D6197E' : '#fff',
          color: primary ? '#fff' : '#17161A',
          borderRadius: 7,
          padding: '7px 12px',
          fontSize: 11,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        {btn}
      </button>
    </div>
  )
  return (
    <div style={{ padding: '40px 44px', display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#17161A' }}>Empieza en tres pasos</div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 14,
          width: '100%',
          maxWidth: 760,
        }}
      >
        {step(
          'PASO 1',
          'Da de alta el cliente',
          'Con sus contactos: se reutilizan en el cajetín, el presupuesto y el brief.',
          'Ir a Clientes',
          onClientes,
        )}
        {step(
          'PASO 2',
          'Registra la feria',
          'Sube su normativa en PDF y el asistente podrá responder dudas sobre ella.',
          'Ir a Ferias',
          onFerias,
        )}
        {step(
          'PASO 3',
          'Crea el proyecto',
          'Asigna cliente y feria, rellena el brief y genera el documento de venta.',
          '+ Nuevo proyecto',
          onNuevo,
          true,
        )}
      </div>
    </div>
  )
}

function CreateForm(props: {
  form: Record<string, string>
  setForm: (f: Record<string, string>) => void
  quick: Record<string, string>
  setQuick: (q: Record<string, string>) => void
  quickCliente: boolean
  setQuickCliente: (b: boolean) => void
  formError: string
  setFormError: (s: string) => void
  clienteOptions: { v: string; label: string }[]
  feriaOptions: { v: string; label: string }[]
  onCancel: () => void
  onCreate: () => void
}) {
  const {
    form,
    setForm,
    quick,
    setQuick,
    quickCliente,
    setQuickCliente,
    formError,
    setFormError,
    clienteOptions,
    feriaOptions,
    onCancel,
    onCreate,
  } = props
  const setF = (k: string, v: string) => {
    setForm({ ...form, [k]: v })
    setFormError('')
  }
  const setQ = (k: string, v: string) => {
    setQuick({ ...quick, [k]: v })
    setFormError('')
  }
  const fieldBox: React.CSSProperties = {
    padding: '10px 12px',
    border: '1px solid #DCD9D2',
    borderRadius: 7,
    fontSize: 13,
    background: '#FDFDFC',
    color: '#17161A',
    outline: 'none',
    width: '100%',
  }
  const lbl = (t: string) => <span style={monoLabel}>{t}</span>

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #E0DED8',
        borderRadius: 14,
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        boxShadow: '0 10px 30px rgba(23,22,26,0.06)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 800, flex: 1 }}>Nuevo proyecto — briefing</div>
        <button
          onClick={onCancel}
          style={{
            border: 'none',
            background: 'none',
            color: '#8A867F',
            fontSize: 18,
            cursor: 'pointer',
            padding: '2px 6px',
          }}
        >
          ×
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {lbl('Nombre del proyecto')}
          <input
            value={form.nombre || ''}
            onChange={(e) => setF('nombre', e.target.value)}
            placeholder="p. ej. Diasorin — Fitur 2026"
            style={fieldBox}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {lbl('Cliente / expositor')}
          <div style={{ display: 'flex', gap: 6 }}>
            <select
              value={form.clienteId || ''}
              onChange={(e) => {
                setForm({ ...form, clienteId: e.target.value })
                setQuickCliente(false)
                setFormError('')
              }}
              style={{ ...fieldBox, flex: 1, minWidth: 0 }}
            >
              <option value="">— Elegir cliente —</option>
              {clienteOptions.map((co) => (
                <option key={co.v} value={co.v}>
                  {co.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                setQuickCliente(!quickCliente)
                setForm({ ...form, clienteId: '' })
              }}
              title="Crear un cliente nuevo"
              style={{
                border: '1px solid #DCD9D2',
                background: quickCliente ? '#17161A' : '#fff',
                color: quickCliente ? '#fff' : '#17161A',
                borderRadius: 7,
                padding: '0 12px',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                flex: 'none',
              }}
            >
              {quickCliente ? 'Cancelar' : '+ Nuevo'}
            </button>
          </div>
        </label>
      </div>

      {quickCliente && (
        <div
          style={{
            border: '1px dashed #E7C6D8',
            background: '#FDF7FA',
            borderRadius: 10,
            padding: 14,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr 1fr',
            gap: 10,
          }}
        >
          {(
            [
              ['nombre', 'Nombre / empresa', 'p. ej. Diasorin'],
              ['web', 'Web', 'diasorin.com'],
              ['email', 'Email', 'hola@…'],
              ['telefono', 'Teléfono', '+34 …'],
            ] as [string, string, string][]
          ).map(([k, label, ph]) => (
            <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span
                style={{
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: 9,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: '#B0447E',
                }}
              >
                {label}
              </span>
              <input
                value={quick[k] || ''}
                onChange={(e) => setQ(k, e.target.value)}
                placeholder={ph}
                style={{
                  padding: '8px 10px',
                  border: '1px solid #E7C6D8',
                  borderRadius: 6,
                  fontSize: 12,
                  background: '#fff',
                  color: '#17161A',
                  outline: 'none',
                  width: '100%',
                }}
              />
            </label>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {lbl('Feria')}
          <select
            value={form.feriaId || ''}
            onChange={(e) => setF('feriaId', e.target.value)}
            style={fieldBox}
          >
            <option value="">— Elegir feria (opcional) —</option>
            {feriaOptions.map((fo) => (
              <option key={fo.v} value={fo.v}>
                {fo.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {lbl('Stand (medidas y frentes)')}
          <input
            value={form.stand || ''}
            onChange={(e) => setF('stand', e.target.value)}
            placeholder="p. ej. Stand 6×3, dos frentes abiertos"
            style={fieldBox}
          />
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {(
          [
            ['objetivo', 'Objetivo del proyecto', 'Notoriedad, captación de leads, presentación de producto…'],
            ['productos', 'Productos que se exponen', 'Qué se expone y qué hay que destacar de cada producto'],
            ['descripcion', 'Descripción del stand', 'Materiales, alturas, mostrador, almacén, iluminación, pantallas…'],
          ] as [string, string, string][]
        ).map(([k, label, ph]) => (
          <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {lbl(label)}
            <textarea
              value={form[k] || ''}
              onChange={(e) => setF(k, e.target.value)}
              placeholder={ph}
              style={{
                minHeight: 74,
                resize: 'vertical',
                padding: '10px 12px',
                border: '1px solid #DCD9D2',
                borderRadius: 7,
                fontSize: 12.5,
                lineHeight: 1.5,
                background: '#FDFDFC',
                color: '#17161A',
                outline: 'none',
                width: '100%',
              }}
            />
          </label>
        ))}
      </div>

      {formError && (
        <div
          style={{
            border: '1px solid #E7C6D8',
            background: '#FBF1F6',
            borderRadius: 8,
            padding: '10px 13px',
            fontSize: 12,
            color: '#5A3A4C',
          }}
        >
          {formError}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{
            border: '1px solid #DCD9D2',
            background: '#fff',
            borderRadius: 8,
            padding: '11px 16px',
            fontSize: 12.5,
            fontWeight: 600,
            cursor: 'pointer',
            color: '#6E6B66',
          }}
        >
          Cancelar
        </button>
        <button
          onClick={onCreate}
          style={{
            border: 'none',
            background: '#17161A',
            color: '#fff',
            borderRadius: 8,
            padding: '11px 20px',
            fontSize: 12.5,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Crear proyecto
        </button>
      </div>
    </div>
  )
}

function ProjectRow(props: {
  p: Project
  clienteOptions: { v: string; label: string }[]
  feria: string
  histOpen: boolean
  onHistToggle: () => void
  delPend: boolean
  proveedores: Proveedor[]
  onName: (n: string) => void
  onCliente: (id: string) => void
  onEstado: (e: string) => void
  onAddProv: (id: string) => void
  onQuitarProv: (id: string) => void
  onAbrirVenta: () => void
  onAbrirPlanos: () => void
  onNotas: () => void
  nNotas: number
  notasNew: boolean
  onDel: () => void
}) {
  const {
    p,
    clienteOptions,
    feria,
    histOpen,
    onHistToggle,
    delPend,
    proveedores,
    onName,
    onCliente,
    onEstado,
    onAddProv,
    onQuitarProv,
    onAbrirVenta,
    onAbrirPlanos,
    onNotas,
    nNotas,
    notasNew,
    onDel,
  } = props
  const col = COLORES[p.estado] || COLORES['Concepto presentado']
  const hist =
    p.hist && p.hist.length ? p.hist : [{ e: p.estado || 'Concepto presentado', t: p.created || Date.now() }]
  const provChips = (p.provIds || []).map((vid) => proveedores.find((v) => v.id === vid)).map((v, i) => ({
    v,
    vid: (p.provIds || [])[i],
  }))
  const provLibres = proveedores.filter((v) => !(p.provIds || []).includes(v.id))
  const stop = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid #F1EFEA' }}>
      <div
        onClick={onAbrirVenta}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
            e.preventDefault()
            onAbrirVenta()
          }
        }}
        title="Abrir el proyecto"
        style={{
          display: 'grid',
          gridTemplateColumns: ROW_GRID,
          gap: 10,
          alignItems: 'center',
          padding: '13px 18px',
          cursor: 'pointer',
          background: '#fff',
        }}
      >
        <input
          value={p.name}
          onChange={(e) => onName(e.target.value)}
          onClick={stop}
          title="Nombre del proyecto (editable)"
          style={{ ...inlineInput, fontSize: 13.5, fontWeight: 700, color: '#17161A', cursor: 'text' }}
        />
        <select
          value={p.clienteId || ''}
          onChange={(e) => onCliente(e.target.value)}
          onClick={stop}
          title="Cliente asignado"
          style={{
            border: '1px solid transparent',
            background: 'transparent',
            borderRadius: 6,
            padding: '6px 4px',
            fontSize: 12.5,
            color: '#55524D',
            outline: 'none',
            width: '100%',
            minWidth: 0,
            cursor: 'pointer',
          }}
        >
          <option value="">— sin cliente —</option>
          {clienteOptions.map((co) => (
            <option key={co.v} value={co.v}>
              {co.label}
            </option>
          ))}
        </select>
        <div
          style={{
            fontSize: 12.5,
            color: '#55524D',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {feria}
        </div>
        <select
          value={p.estado || 'Concepto presentado'}
          onChange={(e) => onEstado(e.target.value)}
          onClick={stop}
          title="Estado del proyecto"
          style={{
            padding: '7px 9px',
            border: `1px solid ${col[2]}`,
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            background: col[1],
            color: col[0],
            cursor: 'pointer',
            outline: 'none',
            width: '100%',
          }}
        >
          {ESTADOS.map((es) => (
            <option key={es} value={es}>
              {es}
            </option>
          ))}
          {p.estado && !(ESTADOS as readonly string[]).includes(p.estado) && (
            <option value={p.estado}>{p.estado}</option>
          )}
        </select>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: '#8A867F' }}>
          {p.created ? fmtDate(p.created) : '—'}
        </div>
        <div onClick={stop} style={{ display: 'flex', gap: 5, justifyContent: 'flex-end', alignItems: 'center' }}>
          <button
            onClick={onHistToggle}
            title="Historial de estados"
            style={{
              border: `1px solid ${histOpen ? '#17161A' : '#DCD9D2'}`,
              background: histOpen ? '#17161A' : '#fff',
              borderRadius: 7,
              padding: '7px 8px',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              color: histOpen ? '#fff' : '#8A867F',
              whiteSpace: 'nowrap',
              fontFamily: "'JetBrains Mono',monospace",
            }}
          >
            ⏱ {hist.length}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onNotas() }}
            title="Notas del equipo y tareas del proyecto"
            style={{
              position: 'relative',
              border: '1px solid ' + (notasNew ? '#D6197E' : '#DCD9D2'),
              background: notasNew ? '#FBF1F6' : '#fff',
              borderRadius: 999,
              padding: '4px 10px',
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              color: notasNew ? '#A81463' : '#8A867F',
              whiteSpace: 'nowrap',
              fontFamily: "'JetBrains Mono',monospace",
            }}
          >
            💬 {nNotas}
            {notasNew && <span style={{ position: 'absolute', top: -3, right: -3, width: 8, height: 8, borderRadius: '50%', background: '#D6197E', animation: 'tkDot 1.4s ease infinite' }} />}
          </button>
          <button
            onClick={onAbrirVenta}
            title="Documento de venta"
            style={docBtn}
          >
            Venta
          </button>
          <button onClick={onAbrirPlanos} title="Memoria y planos" style={docBtn}>
            Planos
          </button>
          <button
            onClick={onDel}
            title="Eliminar proyecto"
            style={{
              border: 'none',
              background: 'none',
              color: delPend ? '#C03A2B' : '#B4B0A8',
              fontSize: 15,
              cursor: 'pointer',
              padding: '2px 5px',
              fontWeight: delPend ? 700 : 400,
              whiteSpace: 'nowrap',
            }}
          >
            {delPend ? '¿Seguro?' : '×'}
          </button>
        </div>
      </div>

      {histOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 18px 14px', background: '#FBFAF8' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <span style={{ ...monoLabel, fontSize: 9, marginRight: 4 }}>Historial</span>
            {hist.map((h, i) => {
              const c = COLORES[h.e] || COLORES['Concepto presentado']
              return (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {i > 0 && <span style={{ color: '#C9C5BC', fontSize: 11 }}>→</span>}
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      border: `1px solid ${c[2]}`,
                      background: c[1],
                      color: c[0],
                      borderRadius: 999,
                      padding: '4px 10px',
                      fontSize: 10.5,
                      fontWeight: 700,
                    }}
                  >
                    <span>{h.e}</span>
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono',monospace",
                        fontSize: 9,
                        fontWeight: 400,
                        opacity: 0.75,
                      }}
                    >
                      {fmtDate(h.t)}
                    </span>
                  </span>
                </span>
              )
            })}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <span style={{ ...monoLabel, fontSize: 9, marginRight: 4 }}>Proveedores</span>
            {provChips.map(({ v, vid }, i) => (
              <span
                key={i}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  border: '1px solid #DCD9D2',
                  background: '#fff',
                  color: '#17161A',
                  borderRadius: 999,
                  padding: '4px 6px 4px 10px',
                  fontSize: 10.5,
                  fontWeight: 600,
                }}
              >
                <span>{v?.nombre || '(eliminado)'}</span>
                {v?.especialidad && (
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: '#8A867F' }}>
                    {v.especialidad}
                  </span>
                )}
                <button
                  onClick={() => onQuitarProv(vid)}
                  title="Quitar proveedor del proyecto"
                  style={{
                    border: 'none',
                    background: 'none',
                    color: '#B4B0A8',
                    fontSize: 12,
                    cursor: 'pointer',
                    padding: '0 2px',
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </span>
            ))}
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) onAddProv(e.target.value)
              }}
              style={{
                border: '1px dashed #C9C5BC',
                background: 'none',
                borderRadius: 999,
                padding: '4px 8px',
                fontSize: 10.5,
                fontWeight: 600,
                color: '#6E6B66',
                cursor: 'pointer',
                outline: 'none',
                maxWidth: 170,
              }}
            >
              <option value="">+ añadir proveedor</option>
              {provLibres.map((v) => (
                <option key={v.id} value={v.id}>
                  {(v.nombre || '(sin nombre)') + (v.especialidad ? ' — ' + v.especialidad : '')}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  )
}

const docBtn: React.CSSProperties = {
  border: '1px solid #DCD9D2',
  background: '#fff',
  borderRadius: 7,
  padding: '7px 8px',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  color: '#17161A',
  whiteSpace: 'nowrap',
}

function ContactRow({
  c,
  onUpd,
  onDel,
}: {
  c: Contacto
  onUpd: (k: keyof Contacto, v: string) => void
  onDel: () => void
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: CONTACT_GRID, gap: 8, alignItems: 'center' }}>
      <input value={c.nombre || ''} onChange={(e) => onUpd('nombre', e.target.value)} placeholder="Nombre" style={cellInput} />
      <input value={c.cargo || ''} onChange={(e) => onUpd('cargo', e.target.value)} placeholder="Cargo / área" style={{ ...cellInput, color: '#55524D' }} />
      <input value={c.telefono || ''} onChange={(e) => onUpd('telefono', e.target.value)} placeholder="Teléfono" style={{ ...cellInput, color: '#55524D' }} />
      <input value={c.email || ''} onChange={(e) => onUpd('email', e.target.value)} placeholder="Email" style={{ ...cellInput, color: '#55524D' }} />
      <button
        onClick={onDel}
        title="Quitar contacto"
        style={{ border: 'none', background: 'none', color: '#B4B0A8', fontSize: 14, cursor: 'pointer', padding: '2px 5px' }}
      >
        ×
      </button>
    </div>
  )
}

function addBtn(label: string, onClick: () => void) {
  return (
    <button
      onClick={onClick}
      style={{
        alignSelf: 'flex-start',
        border: '1px dashed #C9C5BC',
        background: 'none',
        borderRadius: 7,
        padding: '6px 12px',
        fontSize: 11,
        fontWeight: 600,
        cursor: 'pointer',
        color: '#6E6B66',
      }}
    >
      {label}
    </button>
  )
}

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #E0DED8',
  borderRadius: 14,
  padding: '18px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  boxShadow: '0 10px 30px rgba(23,22,26,0.05)',
}

function ClienteCard({
  c,
  nProy,
  delPend,
  delStyle,
  onUpd,
  onDel,
}: {
  c: Cliente
  nProy: number
  delPend: boolean
  delStyle: (p: boolean) => React.CSSProperties
  onUpd: (patch: Partial<Cliente>) => void
  onDel: () => void
}) {
  const contactos: Contacto[] =
    c.contactos && c.contactos.length
      ? c.contactos
      : c.contacto || c.email || c.telefono
        ? [{ nombre: c.contacto || '', cargo: '', telefono: c.telefono || '', email: c.email || '' }]
        : [emptyContacto()]
  const setCt = (i: number, k: keyof Contacto, v: string) =>
    onUpd({
      contactos: contactos.map((x, j) => (j === i ? { ...x, [k]: v } : x)),
      contacto: '',
      email: '',
      telefono: '',
    })
  return (
    <div style={cardStyle}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(160px,1.6fr) minmax(110px,1fr) 90px max-content',
          gap: 10,
          alignItems: 'center',
        }}
      >
        <input value={c.nombre || ''} onChange={(e) => onUpd({ nombre: e.target.value })} placeholder="Nombre / empresa" style={{ ...inlineInput, fontSize: 15, fontWeight: 800, color: '#17161A' }} />
        <input value={c.web || ''} onChange={(e) => onUpd({ web: e.target.value })} placeholder="Web del expositor" style={{ ...inlineInput, fontSize: 12.5, color: '#55524D' }} />
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#8A867F', textAlign: 'right', whiteSpace: 'nowrap' }}>{nProy} proy.</div>
        <button onClick={onDel} title="Eliminar cliente" style={delStyle(delPend)}>{delPend ? '¿Seguro?' : '×'}</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={colHead}>Personas de contacto</div>
        {contactos.map((cc, i) => (
          <ContactRow
            key={i}
            c={cc}
            onUpd={(k, v) => setCt(i, k, v)}
            onDel={() =>
              onUpd({
                contactos: contactos.filter((_, j) => j !== i),
                contacto: '',
                email: '',
                telefono: '',
              })
            }
          />
        ))}
        {addBtn('+ Añadir contacto', () =>
          onUpd({ contactos: [...contactos, emptyContacto()], contacto: '', email: '', telefono: '' }),
        )}
      </div>
      <input
        value={c.notas || ''}
        onChange={(e) => onUpd({ notas: e.target.value })}
        placeholder="Notas del cliente (sector, preferencias, histórico…)"
        style={{ ...inlineInput, padding: '5px 8px', fontSize: 11.5, color: '#8A867F' }}
      />
    </div>
  )
}

function ProveedorCard({
  v,
  nProy,
  delPend,
  delStyle,
  onUpd,
  onDel,
}: {
  v: Proveedor
  nProy: number
  delPend: boolean
  delStyle: (p: boolean) => React.CSSProperties
  onUpd: (patch: Partial<Proveedor>) => void
  onDel: () => void
}) {
  const contactos: Contacto[] = v.contactos && v.contactos.length ? v.contactos : [emptyContacto()]
  const setCt = (i: number, k: keyof Contacto, val: string) =>
    onUpd({ contactos: contactos.map((x, j) => (j === i ? { ...x, [k]: val } : x)) })
  return (
    <div style={cardStyle}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(150px,1.4fr) minmax(120px,1fr) minmax(100px,1fr) 90px max-content',
          gap: 10,
          alignItems: 'center',
        }}
      >
        <input value={v.nombre || ''} onChange={(e) => onUpd({ nombre: e.target.value })} placeholder="Nombre / empresa" style={{ ...inlineInput, fontSize: 15, fontWeight: 800, color: '#17161A' }} />
        <input value={v.especialidad || ''} onChange={(e) => onUpd({ especialidad: e.target.value })} placeholder="Especialidad (carpintería, gráfica…)" style={{ ...inlineInput, fontSize: 12.5, color: '#55524D' }} />
        <input value={v.web || ''} onChange={(e) => onUpd({ web: e.target.value })} placeholder="Web" style={{ ...inlineInput, fontSize: 12.5, color: '#55524D' }} />
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#8A867F', textAlign: 'right', whiteSpace: 'nowrap' }}>{nProy} proy.</div>
        <button onClick={onDel} title="Eliminar proveedor" style={delStyle(delPend)}>{delPend ? '¿Seguro?' : '×'}</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={colHead}>Personas de contacto</div>
        {contactos.map((cc, i) => (
          <ContactRow key={i} c={cc} onUpd={(k, val) => setCt(i, k, val)} onDel={() => onUpd({ contactos: contactos.filter((_, j) => j !== i) })} />
        ))}
        {addBtn('+ Añadir contacto', () => onUpd({ contactos: [...contactos, emptyContacto()] }))}
      </div>
      <input value={v.notas || ''} onChange={(e) => onUpd({ notas: e.target.value })} placeholder="Notas del proveedor (tarifas, plazos, calidad…)" style={{ ...inlineInput, padding: '5px 8px', fontSize: 11.5, color: '#8A867F' }} />
    </div>
  )
}

function FeriaCard({
  f,
  delPend,
  delStyle,
  subiendo,
  onUpd,
  onDocFile,
  onOpenDoc,
  onDelDoc,
  delPendDoc,
  onDel,
}: {
  f: Feria
  delPend: boolean
  delStyle: (p: boolean) => React.CSSProperties
  subiendo: boolean
  onUpd: (patch: Partial<Feria>) => void
  onDocFile: (ev: React.ChangeEvent<HTMLInputElement>) => void
  onOpenDoc: (id: string) => void
  onDelDoc: (id: string) => void
  delPendDoc: string | null
  onDel: () => void
}) {
  const contactos = f.contactos || []
  const setCt = (i: number, k: keyof Contacto, v: string) =>
    onUpd({ contactos: contactos.map((c, j) => (j === i ? { ...c, [k]: v } : c)) })
  return (
    <div style={{ ...cardStyle, gap: 14 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(140px,1.4fr) minmax(110px,1fr) minmax(90px,0.9fr) minmax(90px,1fr) max-content',
          gap: 10,
          alignItems: 'center',
        }}
      >
        <input value={f.nombre || ''} onChange={(e) => onUpd({ nombre: e.target.value })} placeholder="Nombre de la feria" style={{ ...inlineInput, fontSize: 15, fontWeight: 800, color: '#17161A' }} />
        <input value={f.recinto || ''} onChange={(e) => onUpd({ recinto: e.target.value })} placeholder="Recinto / ciudad" style={{ ...inlineInput, fontSize: 12.5, color: '#55524D' }} />
        <input value={f.fechas || ''} onChange={(e) => onUpd({ fechas: e.target.value })} placeholder="Fechas" style={{ ...inlineInput, fontSize: 12.5, color: '#55524D' }} />
        <input value={f.web || ''} onChange={(e) => onUpd({ web: e.target.value })} placeholder="Web de la feria" style={{ ...inlineInput, fontSize: 12.5, color: '#55524D' }} />
        <button onClick={onDel} title="Eliminar feria" style={delStyle(delPend)}>{delPend ? '¿Seguro?' : '×'}</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={colHead}>Personas de contacto</div>
        {contactos.map((c, i) => (
          <ContactRow key={i} c={c} onUpd={(k, v) => setCt(i, k, v)} onDel={() => onUpd({ contactos: contactos.filter((_, j) => j !== i) })} />
        ))}
        {addBtn('+ Añadir contacto', () => onUpd({ contactos: [...contactos, emptyContacto()] }))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={colHead}>Normativa y documentación (PDF)</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {(f.docs || []).map((d) => (
            <div
              key={d.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                border: '1px solid #E0DED8',
                background: '#F7F6F3',
                borderRadius: 8,
                padding: '7px 10px',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#B0447E" strokeWidth="2" strokeLinecap="round" style={{ flex: 'none' }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
              </svg>
              <button
                onClick={() => onOpenDoc(d.id)}
                title="Abrir el PDF"
                style={{
                  border: 'none',
                  background: 'none',
                  padding: 0,
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#17161A',
                  cursor: 'pointer',
                  maxWidth: 220,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {d.name}
              </button>
              <span
                style={{
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: 9,
                  color: d.chars > 200 ? '#1F8A5B' : '#B07A1F',
                  flex: 'none',
                }}
              >
                {d.chars > 200 ? 'texto OK' : 'sin texto'}
              </span>
              <button
                onClick={() => onDelDoc(d.id)}
                title={delPendDoc === d.id ? 'Confirmar eliminación' : 'Eliminar documento (pide confirmación)'}
                style={{ border: 'none', background: 'none', color: delPendDoc === d.id ? '#C03A2B' : '#B4B0A8', fontSize: delPendDoc === d.id ? 10.5 : 13, fontWeight: delPendDoc === d.id ? 700 : 400, cursor: 'pointer', padding: '0 2px', flex: 'none', whiteSpace: 'nowrap' }}
              >
                {delPendDoc === d.id ? '¿Eliminar?' : '×'}
              </button>
            </div>
          ))}
          <label
            style={{
              border: '1px dashed #C9C5BC',
              background: 'none',
              borderRadius: 8,
              padding: '8px 13px',
              fontSize: 11.5,
              fontWeight: 600,
              cursor: 'pointer',
              color: '#6E6B66',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {subiendo && (
              <span
                style={{
                  width: 11,
                  height: 11,
                  border: '2px solid rgba(214,25,126,0.3)',
                  borderTopColor: '#D6197E',
                  borderRadius: '50%',
                  display: 'inline-block',
                  animation: 'crmspin 0.8s linear infinite',
                }}
              />
            )}
            <span>{subiendo ? 'Extrayendo texto…' : '+ Subir PDF de normativa'}</span>
            <input type="file" accept=".pdf" multiple onChange={onDocFile} style={{ display: 'none' }} />
          </label>
        </div>
      </div>
    </div>
  )
}
