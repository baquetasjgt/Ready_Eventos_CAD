// PDF text extraction via pdf.js, empaquetado con la app (npm pdfjs-dist).
// Antes se inyectaba desde un CDN sin verificación de integridad — un CDN
// comprometido habría podido ejecutar código con la sesión del usuario — y
// además fallaba sin conexión. El import dinámico lo separa en su propio
// chunk: solo se descarga la primera vez que se procesa un PDF.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url'

let loaderP: Promise<any> | null = null

function loadPdfjs(): Promise<any> {
  if (!loaderP) {
    loaderP = import('pdfjs-dist/legacy/build/pdf.js').then((lib: any) => {
      lib.GlobalWorkerOptions.workerSrc = workerUrl
      return lib
    })
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
