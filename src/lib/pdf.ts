// PDF text extraction via pdf.js, empaquetado con la app (npm pdfjs-dist).
// Antes se inyectaba desde un CDN sin verificación de integridad — un CDN
// comprometido habría podido ejecutar código con la sesión del usuario — y
// además fallaba sin conexión. El import dinámico lo separa en su propio
// chunk: solo se descarga la primera vez que se procesa un PDF.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url'

let loaderP: Promise<any> | null = null

function loadPdfjs(): Promise<any> {
  if (!loaderP) {
    loaderP = import('pdfjs-dist/legacy/build/pdf.js').then((mod: any) => {
      // pdf.js legado es CommonJS/UMD: según cómo lo envuelva el empaquetador,
      // la librería puede llegar como el propio módulo, como .default o como
      // un binding interno. Buscar el objeto que tenga getDocument.
      const cands = [mod, mod?.default, ...Object.values(mod || {})]
      const lib = cands.find(
        (c: any) => c && typeof c.getDocument === 'function' && c.GlobalWorkerOptions,
      )
      if (!lib) throw new Error('pdf.js no disponible')
      lib.GlobalWorkerOptions.workerSrc = workerUrl
      return lib
    })
    loaderP.catch(() => { loaderP = null }) // permitir reintento si falló la carga
  }
  return loaderP
}

export async function pdfText(buf: ArrayBuffer): Promise<string> {
  try {
    const lib = await loadPdfjs()
    const pdf = await lib.getDocument({ data: buf }).promise
    let out = ''
    for (let i = 1; i <= Math.min(pdf.numPages, 120); i++) {
      const page = await pdf.getPage(i)
      const tc = await page.getTextContent()
      out += tc.items.map((it: any) => it.str).join(' ') + '\n'
      if (out.length > 400000) break
    }
    return out.replace(/[ \t]+/g, ' ').trim()
  } catch {
    return ''
  }
}
