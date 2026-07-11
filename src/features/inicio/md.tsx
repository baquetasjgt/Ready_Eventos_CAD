import React from 'react'

// Minimal Markdown renderer for the assistant's bubbles: **bold**, `code`,
// #-headers → bold, and ``` fenced blocks. Ported from the prototype.
function mdInline(t: string, keyBase: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let rest = String(t)
  let i = 0
  const re = /\*\*([^*]+)\*\*|`([^`\n]+)`/
  while (true) {
    const m = re.exec(rest)
    if (!m) {
      if (rest) parts.push(rest)
      break
    }
    if (m.index) parts.push(rest.slice(0, m.index))
    if (m[1] !== undefined) {
      parts.push(<strong key={`${keyBase}-${i}`}>{m[1]}</strong>)
    } else {
      parts.push(
        <code
          key={`${keyBase}-${i}`}
          style={{
            background: 'rgba(0,0,0,0.08)',
            borderRadius: 3,
            padding: '0 4px',
            fontSize: 11,
            fontFamily: "'JetBrains Mono',monospace",
          }}
        >
          {m[2]}
        </code>,
      )
    }
    rest = rest.slice(m.index + m[0].length)
    i++
  }
  return parts
}

export function MdRender({ text }: { text: string }): React.ReactElement {
  const clean = String(text || '').replace(/^#{1,5}\s*(.+)$/gm, '**$1**')
  const chunks = clean.split(/```[a-zA-Z]*\n?/)
  const out: React.ReactNode[] = []
  chunks.forEach((ch, ci) => {
    if (ci % 2 === 1) {
      out.push(
        <pre
          key={`cb${ci}`}
          style={{
            background: 'rgba(0,0,0,0.06)',
            borderRadius: 6,
            padding: '8px 10px',
            margin: '4px 0',
            fontSize: 11,
            fontFamily: "'JetBrains Mono',monospace",
            whiteSpace: 'pre-wrap',
            overflowX: 'auto',
          }}
        >
          {ch.replace(/\n$/, '')}
        </pre>,
      )
    } else if (ch) {
      out.push(<span key={`tx${ci}`}>{mdInline(ch, `tx${ci}`)}</span>)
    }
  })
  return <span>{out}</span>
}
