import { manualDocx } from './docx'
import { getToken } from '../../api'

/* Download the System Manual as PDF, Word, HTML, Markdown or plain text - built in the browser,
   from the same sections the page shows (technical sections only for users who may see them). */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inline(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*([^*\s][^*]*)\*/g, '<em>$1</em>')
}
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())

/** The manual's small markdown dialect -> HTML (same features as components/Markdown.jsx). */
export function mdToHtml(text) {
  const lines = (text || '').replace(/\r/g, '').split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (!l.trim()) { i++; continue }
    if (/^\s*```/.test(l)) {
      const code = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++])
      i++
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`)
      continue
    }
    if (/^>\s?/.test(l)) {
      const q = []
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''))
      out.push(`<blockquote>${inline(q.join(' '))}</blockquote>`)
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const head = cells(l), body = []
      i += 2
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(cells(lines[i++]))
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
        body.map((r) => `<tr>${head.map((_, k) => `<td>${inline(r[k] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
      continue
    }
    const h = l.match(/^(#{1,4})\s+(.*)$/)
    if (h) { out.push(`<h4>${inline(h[2])}</h4>`); i++; continue }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d/.test(l), items = []
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        let item = lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, '')
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) item += ` ${lines[i++].trim()}`
        items.push(`<li>${inline(item)}</li>`)
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`)
      continue
    }
    const para = [l.trim()]
    i++
    while (i < lines.length && lines[i].trim() && !/^(\s*([-*•]|\d+[.)])\s+|#{1,4}\s|>|\s*\||\s*```)/.test(lines[i])) para.push(lines[i++].trim())
    out.push(`<p>${inline(para.join(' '))}</p>`)
  }
  return out.join('\n')
}

const CSS = `body{font-family:Segoe UI,Arial,sans-serif;color:#17212b;line-height:1.5;max-width:900px;margin:32px auto;padding:0 24px;font-size:11pt}
h1{font-size:22pt;margin:0 0 4px} h2{font-size:15pt;margin:28px 0 6px;border-bottom:2px solid #0d9488;padding-bottom:4px}
h3{font-size:12pt;color:#0d9488;margin:30px 0 0;text-transform:uppercase;letter-spacing:.04em} h4{font-size:11.5pt;margin:16px 0 6px}
table{border-collapse:collapse;width:100%;margin:8px 0 12px;font-size:10pt} th,td{border:1px solid #cfd8dc;padding:5px 8px;text-align:left;vertical-align:top}
th{background:#eef5f4} code{font-family:Consolas,monospace;background:#f1f3f4;padding:0 3px;border-radius:3px;font-size:9.5pt}
pre{background:#f1f3f4;padding:10px;border-radius:6px;white-space:pre-wrap;font-size:9.5pt} blockquote{border-left:4px solid #0d9488;margin:8px 0;padding:6px 12px;background:#f3f8f8}
.meta{color:#5d6b78;font-size:9.5pt;margin-bottom:18px} .toc a{color:#0d9488;text-decoration:none} .toc li{margin:2px 0}
@media print{body{margin:0;max-width:none} h2{page-break-after:avoid} table,pre{page-break-inside:avoid} .toc{page-break-after:always}}`

function grouped(sections, groups) {
  return groups.map((g) => ({ g, items: sections.filter((s) => s.group === g) })).filter((x) => x.items.length)
}

export function manualHtml({ sections, groups, company, forWord = false }) {
  const parts = grouped(sections, groups)
  const date = new Date().toLocaleString()
  const toc = `<div class="toc"><h2>Contents</h2>${parts.map(({ g, items }) =>
    `<p><b>${esc(g)}</b></p><ul>${items.map((s) => `<li><a href="#${s.id}">${esc(s.title)}</a></li>`).join('')}</ul>`).join('')}</div>`
  const body = parts.map(({ g, items }) => `<h3>${esc(g)}</h3>${items.map((s) =>
    `<h2 id="${s.id}"><a name="${s.id}"></a>${esc(s.title)}</h2>\n${mdToHtml(s.md)}`).join('\n')}`).join('\n')
  const head = forWord
    ? '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">'
    : '<!doctype html><html lang="en">'
  return `${head}<head><meta charset="utf-8"><title>${esc(company)} - System Manual</title><style>${CSS}</style></head><body>
<h1>${esc(company)} - System Manual</h1><div class="meta">Financial Reporting System · generated ${esc(date)}</div>
${toc}
${body}
</body></html>`
}

export function manualMarkdown({ sections, groups, company }) {
  const parts = grouped(sections, groups)
  const toc = parts.map(({ g, items }) => `**${g}**\n\n${items.map((s) => `- [${s.title}](#${s.id})`).join('\n')}`).join('\n\n')
  return `# ${company} - System Manual\n\n_Financial Reporting System · generated ${new Date().toLocaleString()}_\n\n## Contents\n\n${toc}\n\n${
    parts.map(({ g, items }) => `---\n\n# ${g}\n\n${items.map((s) => `## ${s.title}\n\n${s.md.trim()}\n`).join('\n')}`).join('\n')}`
}

export function manualText(args) {
  return manualMarkdown(args)
    .replace(/^#{1,4}\s+(.*)$/gm, (_, t) => `${t}\n${'='.repeat(Math.min(t.length, 80))}`)
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/_([^_]+)_/g, '$1')
    .replace(/\[([^\]]+)\]\(#[^)]+\)/g, '$1').replace(/^\|?[\s:|-]+\|?$/gm, '').replace(/^---$/gm, '')
}

function save(content, name, type) {
  const blob = new Blob([type.startsWith('text') || type.includes('msword') ? '﻿' : '', content], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

/** format: 'pdf' | 'word' | 'html' | 'md' | 'txt' */
export function downloadManual(format, { sections, groups, company }) {
  const base = `${(company || 'System').replace(/[^\w-]+/g, '_')}_System_Manual`
  const args = { sections, groups, company }
  if (format === 'word') {                               // real .docx: cover, contents, styles, page numbers
    const blob = manualDocx(args)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `${base}.docx`
    document.body.append(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    return 'ok'
  }
  if (format === 'html') return save(manualHtml(args), `${base}.html`, 'text/html;charset=utf-8')
  if (format === 'md') return save(manualMarkdown(args), `${base}.md`, 'text/markdown;charset=utf-8')
  if (format === 'txt') return save(manualText(args), `${base}.txt`, 'text/plain;charset=utf-8')
  // PDF: built by the API (reportlab) and downloaded as a real .pdf file
  return downloadPdf(args, `${base}.pdf`)
}

async function downloadPdf({ sections, groups, company }, filename) {
  const accent = (getComputedStyle(document.documentElement).getPropertyValue('--accent-base') || '').trim()
  const tok = getToken()
  const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/auth/manual/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: JSON.stringify({ company, groups, accent: /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#0f766e',
      sections: sections.map(({ id, group, title, md }) => ({ id, group, title, md })) }),
  })
  if (!res.ok) {
    let msg = res.status === 404 ? 'The API is an older version - restart uvicorn and try again.' : `HTTP ${res.status}`
    try { msg = (await res.json()).detail || msg } catch { /* not json */ }
    throw new Error(msg)
  }
  const href = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = href; a.download = filename
  document.body.append(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 10000)
  return 'ok'
}
