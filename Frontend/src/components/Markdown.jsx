import { Fragment } from 'react'

/* Small, safe markdown renderer for AI answers: headings, paragraphs, bullet / numbered lists, tables,
   **bold**, *italic* and `code`. Builds React elements only - no HTML from the answer is ever injected. */
function inline(s, key = 'i') {
  const out = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g
  let last = 0, m, n = 0
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('**')) out.push(<strong key={`${key}${n++}`}>{t.slice(2, -2)}</strong>)
    else if (t.startsWith('`')) out.push(<code key={`${key}${n++}`}>{t.slice(1, -1)}</code>)
    else out.push(<em key={`${key}${n++}`}>{t.slice(1, -1)}</em>)
    last = m.index + t.length
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
const isNum = (c) => /^[(\-+]?[\d,.]+%?\)?$/.test(c.replace(/\*\*/g, '').replace(/\s?(SAR|AED|USD|days)$/i, ''))

export default function Markdown({ text }) {
  const lines = (text || '').replace(/\r/g, '').split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (!l.trim()) { i++; continue }
    if (/^\s*```/.test(l)) {                              // fenced code block
      const code = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++])
      i++
      blocks.push(<pre key={blocks.length} className="md-pre" data-no-tr><code>{code.join('\n')}</code></pre>)
      continue
    }
    const bq = l.match(/^>\s?(.*)$/)
    if (bq) {                                             // > note
      const q = []
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''))
      blocks.push(<div key={blocks.length} className="md-note">{inline(q.join(' '))}</div>)
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const head = cells(l); const body = []
      i += 2
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(cells(lines[i++]))
      blocks.push(
        <div className="md-table" key={blocks.length}><table>
          <thead><tr>{head.map((c, k) => <th key={k} className={k && body.every((r) => !r[k] || isNum(r[k])) ? 'num' : ''}>{inline(c)}</th>)}</tr></thead>
          <tbody>{body.map((r, j) => <tr key={j}>{head.map((_, k) => <td key={k} className={isNum(r[k] || '') ? 'num' : ''}>{inline(r[k] || '')}</td>)}</tr>)}</tbody>
        </table></div>)
      continue
    }
    const h = l.match(/^(#{1,4})\s+(.*)$/)
    if (h) { blocks.push(<h4 key={blocks.length} className={`md-h${h[1].length}`}>{inline(h[2])}</h4>); i++; continue }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d/.test(l); const items = []
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        items.push({ sub: /^\s{2,}/.test(lines[i]), text: lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, '') }); i++
      }
      const Tag = ordered ? 'ol' : 'ul'
      blocks.push(<Tag key={blocks.length}>{items.map((it, k) => <li key={k} className={it.sub ? 'md-sub' : ''}>{inline(it.text)}</li>)}</Tag>)
      continue
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(l)) { blocks.push(<hr key={blocks.length} />); i++; continue }
    const para = []
    while (i < lines.length && lines[i].trim() && !/^\s*(\||#{1,4}\s|[-*•]\s|\d+[.)]\s|```|>)/.test(lines[i])) para.push(lines[i++])
    if (!para.length) para.push(lines[i++])
    blocks.push(<p key={blocks.length}>{para.map((p, k) => <Fragment key={k}>{k > 0 && <br />}{inline(p, `p${k}`)}</Fragment>)}</p>)
  }
  return <div className="md">{blocks}</div>
}
