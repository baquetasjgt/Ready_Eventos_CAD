// PDF text extraction via pdf.js, loaded on demand from CDN (same version the
// prototype used). Used to index feria normativa PDFs for the assistant.

const PDF_VERSION = '3.11.174'
const CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDF_VERSION}`

let loaderP: Promise<any> | null = null

function loadPdfjs(): Promise<any> {
  if ((window as any).pdfjsLib) return Promise.resolve((window as any).pdfjsLib)
  if (loaderP) return loaderP
  loaderP = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = `${CDN}/pdf.min.js`
    s.onload = () => {
      const lib = (window as any).pdfjsLib
      if (lib) {
        lib.GlobalWorkerOptions.workerSrc = `${CDN}/pdf.worker.min.js`
        resolve(lib)
      } else {
        reject(new Error('pdf.js no disponible'))
      }
    }
    s.onerror = () => reject(new Error('No se pudo cargar pdf.js'))
    document.head.appendChild(s)
  })
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
