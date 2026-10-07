import { useEffect, useMemo, useState } from 'react'
import { MotionCard, motion, rowMotion, useReducedMotion } from '../../components/motion'
import { admin, api, fmt } from '../../api'
import Pager, { paginate } from '../../components/Pager'
import { useApp } from '../../theme'
import { useAuth } from '../../auth'
import { downloadCsv } from '../dash/common'
import { Hero3D } from '../../components/three'

/** Account -> statement line mapping. Comes from the FS workbooks; change any account here. */
export default function Mapping() {
  const { scope } = useApp()
  const { can } = useAuth()
  const editable = can('mapping.edit')
  const tenant = scope?.tenant
  const company = scope?.company
  const [d, setD] = useState(null)
  const reduce = useReducedMotion()
  const [layout, setLayout] = useState(null)
  const [edits, setEdits] = useState({})
  const [q, setQ] = useState('')
  const [only, setOnly] = useState('')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(50)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => {
    if (!tenant) return
    setD(null)
    api('fs/mapping', { tenant, company: company || '*' }).then(setD).catch((e) => setMsg({ bad: true, text: e.message }))
  }
  useEffect(load, [tenant, company]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api('fs/layout').then(setLayout).catch(() => {}) }, [])

  const shown = useMemo(() => (d?.accounts || []).filter((a) =>
    (!only || (only === 'range' && a.source === 'Account range') || (only === 'manual' && a.source === 'Manual') ||
      (only === 'posted' && a.lines > 0) || (only === 'edited' && edits[a.main_account])) &&
    `${a.main_account} ${a.account_name} ${a.line} ${a.note}`.toLowerCase().includes(q.toLowerCase())), [d, q, only, edits])
  const { pageRows, page: cur, pages } = paginate(shown, page, size)
  const nEdits = Object.keys(edits).length

  const edit = (a, field, value) => setEdits((e) => {
    const base = e[a.main_account] || { main_account: a.main_account, line_code: a.line_code, note_line: a.note }
    return { ...e, [a.main_account]: { ...base, [field]: value } }
  })
  const save = async (items) => {
    setBusy(true); setMsg(null)
    try {
      await admin('fs/mapping', { method: 'PUT', body: { tenant, items } })
      setEdits({}); setMsg({ text: `${items.length} account(s) saved. Reports and statements use the new mapping now.` }); load()
    } catch (e) { setMsg({ bad: true, text: e.message }) } finally { setBusy(false) }
  }
  const setSet = async (map_set) => {
    try {
      await admin('fs/company-set', { method: 'PUT', body: { tenant, company, map_set } }); load()
    } catch (e) { setMsg({ bad: true, text: e.message }) }
  }

  const options = layout && ['BS', 'IS'].map((st) => (
    <optgroup key={st} label={st === 'BS' ? 'Balance sheet' : 'Income statement'}>
      {layout.lines.filter((l) => l.statement === st).map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
    </optgroup>
  ))
  const counts = d ? d.accounts.reduce((c, a) => ({ ...c, [a.source]: (c[a.source] || 0) + 1 }), {}) : {}

  return (
    <div className="page">
      <header className="hero hero-3d">
        <Hero3D />
        <div>
          <h1>FS Mapping</h1>
          <p>Which financial-statement line each ledger account goes to. Loaded from the YE2025 FS mapping workbooks.</p>
        </div>
      </header>
      {!tenant && <div className="alert">Pick a company in the top-right company list.</div>}
      {msg && <div className={`alert ${msg.bad ? 'bad' : 'good'}`}>{msg.text}</div>}
      {tenant && !d && !msg?.bad && <div className="card muted">Loading…</div>}
      {d && <>
        <div className="tiles">
          {['ADD SPF', 'Tazayud', 'Manual', 'Account range'].map((s) => (
            <div key={s} className="tile"><span className="label">{s === 'Account range' ? 'Mapped by account range' : s === 'Manual' ? 'Changed here' : `From ${s} workbook`}</span>
              <strong className={s === 'Account range' && counts[s] ? 'down' : ''}>{fmt(counts[s] || 0)}</strong></div>
          ))}
        </div>
        {company && (
          <MotionCard as="section" hover={false} className="card row">
            <span>Workbook used first for company <b data-no-tr>{company}</b>:</span>
            <select value={d.assigned || ''} disabled={!editable} onChange={(e) => setSet(e.target.value)}>
              <option value="">Automatic (ADD SPF, then Tazayud)</option>
              {d.sets.map((s) => <option key={s.map_set} value={s.map_set}>{s.map_set} ({s.accounts} accounts)</option>)}
            </select>
            <span className="muted small">Accounts in no workbook use the chart-of-accounts ranges.</span>
          </MotionCard>
        )}
        <MotionCard as="section" hover={false} className="card stack">
          <div className="row">
            <input className="grow" placeholder="Search account, line or note…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
            <select value={only} onChange={(e) => { setOnly(e.target.value); setPage(1) }}>
              <option value="">All accounts</option>
              <option value="posted">Accounts with postings</option>
              <option value="range">Mapped by account range only</option>
              <option value="manual">Changed here</option>
              <option value="edited">Unsaved changes</option>
            </select>
            <button className="export-only" onClick={() => downloadCsv('fs_mapping.csv', ['Account', 'Name', 'Type', 'Statement', 'FS line', 'Note', 'Mapped by'],
              shown.map((a) => [a.main_account, a.account_name, a.account_type, a.statement, a.line, a.note, a.source]))}>Export CSV</button>
          </div>
          {nEdits > 0 && (
            <div className="bulkbar">
              <span>{nEdits} unsaved change(s)</span>
              <button className="primary" disabled={busy} onClick={() => save(Object.values(edits))}>Save ({nEdits})</button>
              <button onClick={() => setEdits({})}>Discard</button>
            </div>
          )}
          <div className="table-wrap paged">
            <table>
              <thead><tr><th>Account</th><th>Name</th><th className="num">Postings</th><th>Statement line</th><th>Note line</th><th>Mapped by</th><th /></tr></thead>
              <tbody>
                {pageRows.map((a, i) => {
                  const e = edits[a.main_account]
                  return (
                    <motion.tr key={a.main_account} className={e ? 'edited' : ''} {...rowMotion(i, reduce)}>
                      <td data-no-tr>{a.main_account}</td>
                      <td className="ellipsis" title={a.account_name}>{a.account_name}</td>
                      <td className="num muted">{fmt(a.lines)}</td>
                      <td><select className="map-select" disabled={!editable} value={e?.line_code ?? a.line_code} onChange={(ev) => edit(a, 'line_code', ev.target.value)}>{options}</select></td>
                      <td><input className="map-note" disabled={!editable} value={e?.note_line ?? a.note} onChange={(ev) => edit(a, 'note_line', ev.target.value)} /></td>
                      <td className={`small ${a.source === 'Account range' ? 'warn-text' : 'muted'}`}>{a.source}</td>
                      <td>{editable && a.source === 'Manual' && !e &&
                        <button className="small-btn" title="Back to the workbook / account-range mapping"
                                onClick={() => save([{ main_account: a.main_account, line_code: '', note_line: '' }])}>Reset</button>}</td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pager total={shown.length} page={cur} pages={pages} size={size} label="accounts"
                 onPage={setPage} onSize={(n) => { setSize(n); setPage(1) }} />
        </MotionCard>
      </>}
    </div>
  )
}
