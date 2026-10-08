/* System Manual as a real Word document (.docx), built in the browser with no extra libraries:
   cover page, table of contents (Word fills in the page numbers when it opens the file), one chapter per
   group, Word heading styles (so the Navigation pane works), styled tables, bullet / numbered lists,
   note boxes, code blocks, header and "Page X of Y" footer. Fonts: Calibri Light headings, Calibri text. */

const ACCENT = '0F766E'          // headings, rules, table header
const ACCENT_SOFT = 'E6F2F1'     // table header fill, note boxes
const GREY = '5D6B78'

const x = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/* ---------------------------------------------------------------- tiny ZIP (stored, no compression) ---- */
const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return t
})()
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

function zip(files) {           // files: [{ name, data: string }]
  const enc = new TextEncoder(), parts = [], central = []
  let offset = 0
  const d = new Date()
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data)
    const h = new DataView(new ArrayBuffer(30))
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true)
    h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true)
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true)
    parts.push(new Uint8Array(h.buffer), name, data)
    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true)
    c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true)
    c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true)
    central.push(new Uint8Array(c.buffer), name)
    offset += 30 + name.length + data.length
  }
  const size = central.reduce((a, p) => a + p.length, 0)
  const e = new DataView(new ArrayBuffer(22))
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true)
  e.setUint32(12, size, true); e.setUint32(16, offset, true)
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}

/* ---------------------------------------------------------------- markdown -> WordprocessingML ---- */
function runs(s, base = '') {
  const out = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g
  let last = 0, m
  const run = (t, props = '') => out.push(`<w:r><w:rPr>${base}${props}</w:rPr><w:t xml:space="preserve">${x(t)}</w:t></w:r>`)
  while ((m = re.exec(s))) {
    if (m.index > last) run(s.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('**')) run(t.slice(2, -2), '<w:b/>')
    else if (t.startsWith('`')) run(t.slice(1, -1), '<w:rStyle w:val="InlineCode"/>')
    else run(t.slice(1, -1), '<w:i/>')
    last = m.index + t.length
  }
  if (last < s.length) run(s.slice(last))
  return out.join('')
}
const para = (style, inner, extra = '') => `<w:p><w:pPr><w:pStyle w:val="${style}"/>${extra}</w:pPr>${inner}</w:p>`
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
const isNum = (c) => /^[(\-+]?[\d,.]+%?\)?$/.test(c.replace(/\*\*/g, ''))

function table(head, body) {
  const n = head.length
  const w = Math.floor(9360 / n)                       // 6.5" text width in twips
  const widths = n === 2 ? [2800, 6560] : head.map(() => w)
  const cell = (t, k, header) => `<w:tc><w:tcPr><w:tcW w:w="${widths[k]}" w:type="dxa"/>${header ? `<w:shd w:val="clear" w:color="auto" w:fill="${ACCENT}"/>` : ''}</w:tcPr>`
    + `<w:p><w:pPr><w:pStyle w:val="TableText"/>${!header && k && isNum(t) ? '<w:jc w:val="right"/>' : ''}</w:pPr>${runs(t, header ? '<w:b/><w:color w:val="FFFFFF"/>' : '')}</w:p></w:tc>`
  const row = (r, header, i) => `<w:tr><w:trPr><w:cantSplit/>${header ? '<w:tblHeader/>' : ''}</w:trPr>`
    + head.map((_, k) => cell(r[k] || '', k, header)).join('').replace(/<w:tcPr>/g, header || i % 2 === 0 ? '<w:tcPr>' : `<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="F6F9F9"/>`) + '</w:tr>'
  return `<w:tbl><w:tblPr><w:tblStyle w:val="ManualTable"/><w:tblW w:w="5000" w:type="pct"/><w:tblLook w:val="04A0" w:firstRow="1"/></w:tblPr>`
    + `<w:tblGrid>${widths.map((v) => `<w:gridCol w:w="${v}"/>`).join('')}</w:tblGrid>`
    + row(head, true, 0) + body.map((r, i) => row(r, false, i)).join('') + '</w:tbl>' + para('Spacer', '')
}

function mdToDocx(text, nums) {
  const lines = (text || '').replace(/\r/g, '').split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (!l.trim()) { i++; continue }
    if (/^\s*```/.test(l)) {
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) out.push(para('CodeBlock', runs(lines[i++]).replace(/<w:rPr><\/w:rPr>/g, '')))
      i++
      continue
    }
    if (/^>\s?/.test(l)) {
      const q = []
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''))
      out.push(para('Note', runs(q.join(' '))))
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const head = cells(l), body = []
      i += 2
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(cells(lines[i++]))
      out.push(table(head, body))
      continue
    }
    const h = l.match(/^(#{1,4})\s+(.*)$/)
    if (h) { out.push(para('Heading3', runs(h[2]))); i++; continue }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d/.test(l)
      const numId = ordered ? nums.next() : 1          // each numbered list restarts at 1
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        let item = lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, '')
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) item += ` ${lines[i++].trim()}`
        out.push(para('ListParagraph', runs(item), `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`))
      }
      continue
    }
    const p = [l.trim()]
    i++
    while (i < lines.length && lines[i].trim() && !/^(\s*([-*•]|\d+[.)])\s+|#{1,4}\s|>|\s*\||\s*```)/.test(lines[i])) p.push(lines[i++].trim())
    out.push(para('BodyText', runs(p.join(' '))))
  }
  return out.join('')
}

/* ---------------------------------------------------------------- package parts ---- */
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

function styles() {
  const font = (f) => `<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}" w:eastAsia="${f}"/>`
  const st = (id, name, ppr, rpr, extra = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>${extra}<w:qFormat/><w:pPr>${ppr}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`
  return `${HEAD}<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr>${font('Calibri')}<w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="1F2933"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${st('BodyText', 'Body Text', '<w:spacing w:after="140"/><w:jc w:val="both"/>', '')}
${st('Title', 'Title', '<w:spacing w:before="0" w:after="120"/>', `${font('Calibri Light')}<w:b/><w:color w:val="${ACCENT}"/><w:sz w:val="72"/><w:szCs w:val="72"/>`)}
${st('Subtitle', 'Subtitle', '<w:spacing w:after="80"/>', `${font('Calibri Light')}<w:color w:val="${GREY}"/><w:sz w:val="32"/><w:szCs w:val="32"/>`)}
${st('CoverMeta', 'Cover Meta', '<w:spacing w:after="40"/>', `<w:color w:val="${GREY}"/><w:sz w:val="22"/>`)}
${st('Heading1', 'heading 1', `<w:keepNext/><w:pageBreakBefore/><w:spacing w:before="0" w:after="240"/><w:pBdr><w:bottom w:val="single" w:sz="18" w:space="6" w:color="${ACCENT}"/></w:pBdr><w:outlineLvl w:val="0"/>`, `${font('Calibri Light')}<w:color w:val="${ACCENT}"/><w:sz w:val="44"/><w:szCs w:val="44"/>`, '<w:next w:val="BodyText"/>')}
${st('Heading2', 'heading 2', `<w:keepNext/><w:keepLines/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="1"/>`, `${font('Calibri Light')}<w:b/><w:color w:val="1F2933"/><w:sz w:val="32"/><w:szCs w:val="32"/>`, '<w:next w:val="BodyText"/>')}
${st('Heading3', 'heading 3', `<w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/>`, `<w:b/><w:color w:val="${ACCENT}"/><w:sz w:val="24"/><w:szCs w:val="24"/>`, '<w:next w:val="BodyText"/>')}
${st('TOCHeading', 'TOC Heading', `<w:spacing w:after="240"/><w:pBdr><w:bottom w:val="single" w:sz="18" w:space="6" w:color="${ACCENT}"/></w:pBdr>`, `${font('Calibri Light')}<w:color w:val="${ACCENT}"/><w:sz w:val="44"/>`)}
${st('TOC1', 'toc 1', '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9350"/></w:tabs><w:spacing w:before="140" w:after="20" w:line="252" w:lineRule="auto"/>', `<w:b/><w:color w:val="${ACCENT}"/>`)}
${st('TOC2', 'toc 2', '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9350"/></w:tabs><w:spacing w:after="0" w:line="252" w:lineRule="auto"/><w:ind w:left="360"/>', '<w:sz w:val="21"/>')}
${st('ListParagraph', 'List Paragraph', '<w:spacing w:after="60"/><w:ind w:left="720" w:hanging="360"/>', '')}
${st('Note', 'Note', `<w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="${ACCENT}"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="${ACCENT_SOFT}"/><w:spacing w:before="120" w:after="160"/><w:ind w:left="200" w:right="120"/>`, '')}
${st('CodeBlock', 'Code Block', '<w:shd w:val="clear" w:color="auto" w:fill="F1F3F4"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="200" w:right="120"/>', `${font('Consolas')}<w:sz w:val="18"/>`)}
${st('TableText', 'Table Text', '<w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/>', '<w:sz w:val="19"/><w:szCs w:val="19"/>')}
${st('Spacer', 'Spacer', '<w:spacing w:after="60"/>', '<w:sz w:val="8"/>')}
${st('Header', 'header', `<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="${ACCENT}"/></w:pBdr><w:tabs><w:tab w:val="right" w:pos="9350"/></w:tabs>`, `<w:color w:val="${GREY}"/><w:sz w:val="18"/>`)}
${st('Footer', 'footer', '<w:tabs><w:tab w:val="right" w:pos="9350"/></w:tabs>', `<w:color w:val="${GREY}"/><w:sz w:val="18"/>`)}
<w:style w:type="character" w:styleId="InlineCode"><w:name w:val="Inline Code"/><w:rPr>${font('Consolas')}<w:sz w:val="19"/><w:shd w:val="clear" w:color="auto" w:fill="F1F3F4"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="${ACCENT}"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="ManualTable"><w:name w:val="Manual Table"/><w:tblPr><w:tblBorders>
<w:top w:val="single" w:sz="4" w:color="CFD8DC"/><w:left w:val="single" w:sz="4" w:color="CFD8DC"/><w:bottom w:val="single" w:sz="4" w:color="CFD8DC"/>
<w:right w:val="single" w:sz="4" w:color="CFD8DC"/><w:insideH w:val="single" w:sz="4" w:color="CFD8DC"/><w:insideV w:val="single" w:sz="4" w:color="CFD8DC"/></w:tblBorders>
<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`
}

function numbering(count) {
  const lvl = (fmt, text) => `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/>`
    + `<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>${fmt === 'bullet' ? `<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/><w:color w:val="${ACCENT}"/></w:rPr>` : `<w:rPr><w:b/><w:color w:val="${ACCENT}"/></w:rPr>`}</w:lvl>`
  let nums = '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
  for (let n = 2; n <= count; n++) nums += `<w:num w:numId="${n}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`
  return `${HEAD}<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>${lvl('bullet', '')}</w:abstractNum>`
    + `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>${lvl('decimal', '%1.')}</w:abstractNum>${nums}</w:numbering>`
}

const field = (code, shown) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r>`
  + `<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${shown}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`

/** Build the .docx Blob. */
export function manualDocx({ sections, groups, company }) {
  const parts = groups.map((g) => ({ g, items: sections.filter((s) => s.group === g) })).filter((p) => p.items.length)
  let numCount = 1
  const nums = { next: () => ++numCount }
  let bm = 0
  const bookmark = (name, inner) => `<w:bookmarkStart w:id="${++bm}" w:name="${name}"/>${inner}<w:bookmarkEnd w:id="${bm}"/>`
  const id = (s) => `_s_${s.replace(/[^A-Za-z0-9]/g, '_').slice(0, 30)}`
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  // cover page
  const cover = [
    para('Spacer', '', '<w:spacing w:before="2400"/>'),
    para('CoverMeta', `<w:r><w:rPr><w:b/><w:color w:val="${ACCENT}"/><w:spacing w:val="40"/></w:rPr><w:t>FINANCIAL REPORTING SYSTEM</w:t></w:r>`),
    para('Title', `<w:r><w:t>${x(company)}</w:t></w:r>`),
    para('Subtitle', '<w:r><w:t>System Manual</w:t></w:r>', `<w:pBdr><w:bottom w:val="single" w:sz="24" w:space="12" w:color="${ACCENT}"/></w:pBdr><w:spacing w:after="480"/>`),
    para('CoverMeta', '<w:r><w:t>Dashboards, financial statements, adjustments, close and consolidation, and the Dynamics 365 data pipeline - how to use the system, how it works, and what to do when something goes wrong.</w:t></w:r>', '<w:spacing w:after="1600"/>'),
    para('CoverMeta', `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Date: </w:t></w:r><w:r><w:t>${x(today)}</w:t></w:r>`),
    para('CoverMeta', `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Sections: </w:t></w:r><w:r><w:t>${sections.length} in ${parts.length} chapters</w:t></w:r>`),
    para('CoverMeta', '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Source: </w:t></w:r><w:r><w:t>Microsoft Dynamics 365 Finance &amp; Operations</w:t></w:r>'),
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
  ].join('')

  // contents page: a real Word TOC field (Word fills in page numbers on open); the cached entries below are shown until then
  const cached = parts.map(({ g, items }) => para('TOC1', `<w:hyperlink w:anchor="${id(g)}"><w:r><w:t>${x(g)}</w:t></w:r></w:hyperlink>`)
    + items.map((s) => para('TOC2', `<w:hyperlink w:anchor="${id(s.id)}"><w:r><w:t>${x(s.title)}</w:t></w:r></w:hyperlink>`)).join('')).join('')
  const toc = para('TOCHeading', '<w:r><w:t>Contents</w:t></w:r>')
    + `<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-2" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>`
    + cached + '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'

  const body = parts.map(({ g, items }) => para('Heading1', bookmark(id(g), `<w:r><w:t>${x(g)}</w:t></w:r>`))
    + items.map((s) => para('Heading2', bookmark(id(s.id), `<w:r><w:t>${x(s.title)}</w:t></w:r>`)) + mdToDocx(s.md, nums)).join('')).join('')

  const sect = '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/><w:footerReference w:type="default" r:id="rIdF"/>'
    + '<w:headerReference w:type="first" r:id="rIdH0"/><w:footerReference w:type="first" r:id="rIdF0"/>'
    + '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1300" w:right="1270" w:bottom="1200" w:left="1270" w:header="600" w:footer="560" w:gutter="0"/>'
    + '<w:titlePg/></w:sectPr>'
  const document = `${HEAD}<w:document ${W}><w:body>${cover}${toc}${body}${sect}</w:body></w:document>`

  const header = `${HEAD}<w:hdr ${W}>${para('Header', `<w:r><w:t>${x(company)}</w:t></w:r><w:r><w:tab/><w:t>System Manual</w:t></w:r>`)}</w:hdr>`
  const footer = `${HEAD}<w:ftr ${W}>${para('Footer', `<w:r><w:t>${x(company)} · Financial Reporting System</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">Page </w:t></w:r>${field('PAGE', '1')}<w:r><w:t xml:space="preserve"> of </w:t></w:r>${field('NUMPAGES', '1')}`)}</w:ftr>`
  const settings = `${HEAD}<w:settings ${W}><w:updateFields w:val="true"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const rels = `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rIdS" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rIdN" Type="${R}/numbering" Target="numbering.xml"/>`
    + `<Relationship Id="rIdT" Type="${R}/settings" Target="settings.xml"/><Relationship Id="rIdH" Type="${R}/header" Target="header1.xml"/>`
    + `<Relationship Id="rIdF" Type="${R}/footer" Target="footer1.xml"/>`
    + `<Relationship Id="rIdH0" Type="${R}/header" Target="header0.xml"/><Relationship Id="rIdF0" Type="${R}/footer" Target="footer0.xml"/></Relationships>`
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const core = `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
    + `<dc:title>${x(company)} - System Manual</dc:title><dc:creator>${x(company)} Financial Reporting System</dc:creator>`
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`
  const ct = `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
    + '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
    + '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
    + '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
    + '<Override PartName="/word/header0.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
    + '<Override PartName="/word/footer0.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'
  const root = `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>`
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'

  return zip([
    { name: '[Content_Types].xml', data: ct }, { name: '_rels/.rels', data: root },
    { name: 'word/document.xml', data: document }, { name: 'word/_rels/document.xml.rels', data: rels },
    { name: 'word/styles.xml', data: styles() }, { name: 'word/numbering.xml', data: numbering(numCount) },
    { name: 'word/settings.xml', data: settings }, { name: 'word/header1.xml', data: header },
    { name: 'word/footer1.xml', data: footer }, { name: 'docProps/core.xml', data: core },
    { name: 'word/header0.xml', data: `${HEAD}<w:hdr ${W}><w:p/></w:hdr>` }, { name: 'word/footer0.xml', data: `${HEAD}<w:ftr ${W}><w:p/></w:ftr>` },
  ])
}
