import { useEffect, useMemo, useState } from 'react'
import { admin, api, fmt, fmtTime } from '../../api'
import { useAuth } from '../../auth'
import { useApp } from '../../theme'
import Modal from '../../components/Modal'
import { MotionCard, motion, rowMotion, useReducedMotion } from '../../components/motion'
import { Hero3D } from '../../components/three'
import { Tile } from '../dash/common'

const TYPES = ['Adjustment', 'Reclassification', 'Elimination']
const TYPE_INFO = {
  Adjustment: 'Audit / year-end adjustment of one company',
  Reclassification: 'Moves an amount between statement lines of one company',
  Elimination: 'Consolidation entry across companies - only applied when all companies are combined',
}
// ready-made elimination entries (statement lines; amounts filled in by the user)
const TEMPLATES = [
  { name: 'Intercompany revenue and cost', type: 'Elimination', lines: [
    { line_code: 'REV_PROJ', side: 'debit', memo: 'Eliminate intercompany revenue' },
    { line_code: 'COS_INV', side: 'credit', memo: 'Eliminate intercompany cost' }] },
  { name: 'Intercompany balances (due to / due from)', type: 'Elimination', lines: [
    { line_code: 'DUE_TO', side: 'debit', memo: 'Due to related party' },
    { line_code: 'DUE_FROM', side: 'credit', memo: 'Due from related party' }] },
  { name: 'Investment in subsidiary against its equity', type: 'Elimination', lines: [
    { line_code: 'SHARE', side: 'debit', memo: "Subsidiary's share capital" },
    { line_code: 'INV_SUB', side: 'credit', memo: 'Investment in subsidiary' }] },
  { name: 'Share in result of subsidiary', type: 'Elimination', lines: [
    { line_code: 'SUB', side: 'debit', memo: 'Remove equity-accounted result' },
    { line_code: 'INV_SUB', side: 'credit', memo: 'Investment in subsidiary' }] },
]
const pillOf = (s) => (s === 'Posted' ? 'ok' : 'warn')
const num = (v) => (v === '' || v == null ? 0 : Number(String(v).replace(/,/g, '')) || 0)

function LineRow({ l, i, set, remove, companies, accounts, lines, locked, readOnly }) {
  const byLine = !!l.useLine
  return (
    <tr>
      <td>
        <select className="co-select" value={l.company} disabled={readOnly || locked} onChange={(e) => set(i, { company: e.target.value })}
                aria-label="Company" data-no-tr>
          {!companies.some((c) => c.company === l.company) && l.company && <option value={l.company}>{l.company.toUpperCase()}</option>}
          {companies.map((c) => <option key={c.company} value={c.company} title={c.name}>{c.company.toUpperCase()}{c.name ? ` · ${c.name}` : ''}</option>)}
        </select>
      </td>
      <td className="adj-target">
        <div className="seg">
          <button type="button" className={!byLine ? 'on' : ''} disabled={readOnly} onClick={() => set(i, { useLine: false, line_code: '' })}>Account</button>
          <button type="button" className={byLine ? 'on' : ''} disabled={readOnly} onClick={() => set(i, { useLine: true, main_account: '' })}>FS line</button>
        </div>
        {byLine
          ? <select value={l.line_code || ''} disabled={readOnly} onChange={(e) => set(i, { line_code: e.target.value })} aria-label="Statement line">
              <option value="">Choose a statement line…</option>
              {['IS', 'BS'].map((st) => <optgroup key={st} label={st === 'IS' ? 'Income statement' : 'Financial position'}>
                {lines.filter((x) => x.statement === st).map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</optgroup>)}
            </select>
          : <>
              <input list="adj-accounts" placeholder="Account number or name" value={l.main_account || ''} disabled={readOnly}
                     onChange={(e) => set(i, { main_account: e.target.value.split(' ')[0] })} />
              <span className="muted small">{accounts.find((a) => a.main_account === l.main_account)?.account_name || l.account_name || ''}</span>
            </>}
      </td>
      <td><input className="num-in" inputMode="decimal" value={l.debit} disabled={readOnly}
                 onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} /></td>
      <td><input className="num-in" inputMode="decimal" value={l.credit} disabled={readOnly}
                 onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} /></td>
      <td><input value={l.memo || ''} disabled={readOnly} onChange={(e) => set(i, { memo: e.target.value })} placeholder="Memo" /></td>
      <td>{!readOnly && <button type="button" className="small-btn" onClick={() => remove(i)} aria-label="Remove line">✕</button>}</td>
    </tr>
  )
}

function EntryEditor({ entry, tenant, company, companies, accounts, lines, onClose, onSaved }) {
  const { can } = useAuth()
  const isNew = !entry.entry_id
  const readOnly = !isNew && (entry.status === 'Posted' || !can('adjust.edit'))
  const blankLine = (c) => ({ company: c, main_account: '', line_code: '', useLine: false, debit: '', credit: '', memo: '' })
  const [f, setF] = useState(() => ({
    entry_type: entry.entry_type || 'Adjustment',
    entry_date: (entry.entry_date || `${new Date().getFullYear() - 1}-12-31`).slice(0, 10),
    description: entry.description || '', reference: entry.reference || '',
    lines: entry.lines?.length ? entry.lines.map((l) => ({ ...l, useLine: !l.main_account, debit: l.debit || '', credit: l.credit || '' }))
      : [blankLine(company), blankLine(company)],
  }))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const single = f.entry_type !== 'Elimination'
  const setLine = (i, patch) => setF((x) => {
    const ls = x.lines.map((l, j) => (j === i ? { ...l, ...patch } : l))
    if (single && patch.company) return { ...x, lines: ls.map((l) => ({ ...l, company: patch.company })) }
    return { ...x, lines: ls }
  })
  const oneCompanyElim = f.entry_type === 'Elimination' && new Set(f.lines.map((l) => l.company)).size < 2
  const dr = f.lines.reduce((s, l) => s + num(l.debit), 0)
  const cr = f.lines.reduce((s, l) => s + num(l.credit), 0)
  const diff = Math.round((dr - cr) * 100) / 100

  const useTemplate = (name) => {
    const t = TEMPLATES.find((x) => x.name === name)
    if (!t) return
    const cs = companies.map((c) => c.company)
    setF((x) => ({ ...x, entry_type: t.type, description: x.description || t.name,
      lines: t.lines.map((l, k) => ({ ...blankLine(cs[k % cs.length] || company), useLine: true, line_code: l.line_code, memo: l.memo })) }))
  }

  const save = async (post) => {
    setBusy(true); setErr('')
    const body = { tenant_key: tenant, entry_type: f.entry_type, entry_date: f.entry_date, description: f.description, reference: f.reference,
      lines: f.lines.map((l) => ({ company: l.company, main_account: l.useLine ? null : (l.main_account || null),
        line_code: l.useLine ? (l.line_code || null) : null, debit: num(l.debit), credit: num(l.credit), memo: l.memo || '' })) }
    try {
      const r = await admin(isNew ? 'adj/entries' : `adj/entries/${entry.entry_id}`, { method: isNew ? 'POST' : 'PUT', body })
      if (post) await admin(`adj/entries/${r.entry_id}/post`, { method: 'POST' })
      onSaved(post ? `Entry #${r.entry_id} posted - it is now in the statements for ${f.entry_date.slice(0, 4)} (period ${f.entry_date}).`
        : `Entry #${r.entry_id} saved as a draft - drafts are not in the statements until you post them.`)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal title={isNew ? 'New adjustment / elimination' : `Entry #${entry.entry_id} · ${entry.status}`} onClose={onClose} wide>
      <div className="stack">
        <div className="form-grid adj-head">
          <label>Type
            <select value={f.entry_type} disabled={readOnly} onChange={(e) => setF({ ...f, entry_type: e.target.value })}>
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
            <span className="muted small">{TYPE_INFO[f.entry_type]}</span>
          </label>
          <label>Period (entry date)<input type="date" value={f.entry_date} disabled={readOnly} onChange={(e) => setF({ ...f, entry_date: e.target.value })} /></label>
          <label className="full">Description<input value={f.description} disabled={readOnly} onChange={(e) => setF({ ...f, description: e.target.value })}
                                                    placeholder="e.g. PwC AJE 3 - accrue zakat" /></label>
          <label>Reference<input value={f.reference} disabled={readOnly} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="e.g. AJE-3, Elim-1" /></label>
          {!readOnly && <label>Start from a template
            <select value="" onChange={(e) => useTemplate(e.target.value)}>
              <option value="">Choose…</option>{TEMPLATES.map((t) => <option key={t.name}>{t.name}</option>)}
            </select></label>}
        </div>
        <datalist id="adj-accounts">{accounts.map((a) => <option key={a.main_account} value={`${a.main_account} ${a.account_name || ''}`} />)}</datalist>
        <div className="table-wrap">
          <table className="adj-lines">
            <thead><tr><th>Company</th><th>Account / statement line</th><th className="num">Debit</th><th className="num">Credit</th><th>Memo</th><th /></tr></thead>
            <tbody>
              {f.lines.map((l, i) => (
                <LineRow key={i} l={l} i={i} set={setLine} remove={(k) => setF((x) => ({ ...x, lines: x.lines.filter((_, j) => j !== k) }))}
                         companies={companies} accounts={accounts} lines={lines} locked={single && i > 0} readOnly={readOnly} />
              ))}
            </tbody>
            <tfoot><tr>
              <td colSpan={2}>{!readOnly && <button type="button" onClick={() => setF((x) => ({ ...x, lines: [...x.lines, blankLine(x.lines[0]?.company || company)] }))}>+ Add line</button>}</td>
              <td className="num">{fmt(dr)}</td><td className="num">{fmt(cr)}</td>
              <td colSpan={2} className={diff ? 'down' : 'up'}>{diff ? `Not balanced: ${fmt(diff)}` : 'Balanced ✓'}</td>
            </tr></tfoot>
          </table>
        </div>
        {!readOnly && oneCompanyElim && (
          <div className="alert">All lines are in one company. An <b>Elimination</b> only applies when all companies are combined -
            for an audit adjustment of one company choose type <b>Adjustment</b> (or <b>Reclassification</b> to move an amount between lines).</div>
        )}
        {readOnly && entry.entry_type === 'Elimination' && (
          <div className="alert">This is an elimination: it changes the statements only when Companies is “All companies (combined)”.</div>
        )}
        {err && <div className="alert bad">{err}</div>}
        {!isNew && <p className="muted small">Created by {entry.created_by || '–'} {fmtTime(entry.created_at)}{entry.posted_at ? ` · posted by ${entry.posted_by} ${fmtTime(entry.posted_at)}` : ''}</p>}
        <div className="row"><span className="grow" /><button onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</button>
          {!readOnly && <button disabled={busy || !f.description} onClick={() => save(false)}>Save draft</button>}
          {!readOnly && can('adjust.post') && <button className="primary" disabled={busy || !!diff || !dr || !f.description || oneCompanyElim} onClick={() => save(true)}>Save & post</button>}
        </div>
      </div>
    </Modal>
  )
}

/** Adjustments & Eliminations journal. */
export default function Journal() {
  const { scope } = useApp()
  const { can } = useAuth()
  const reduce = useReducedMotion()
  const tenant = scope?.tenant
  const [rows, setRows] = useState(null)
  const [companies, setCompanies] = useState([])
  const [accounts, setAccounts] = useState([])
  const [lines, setLines] = useState([])
  const [f, setF] = useState({ year: '', entry_type: '', status: '', q: '' })
  const [edit, setEdit] = useState(null)
  const [msg, setMsg] = useState(null)
  const [confirm, setConfirm] = useState(null)

  const load = () => { if (tenant) admin('adj/entries', { params: { tenant, ...f } }).then(setRows).catch((e) => setMsg({ bad: true, text: e.message })) }
  useEffect(load, [tenant, f]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!tenant) return
    api('companies-all').then((r) => setCompanies((r || []).filter((c) => c.tenant_key === tenant))).catch(() => {})
    admin('adj/accounts', { params: { tenant } }).then(setAccounts).catch(() => {})
    api('fs/layout').then((r) => setLines(r.lines)).catch(() => {})
  }, [tenant])

  const act = async (e, what) => {
    try {
      if (what === 'delete') await admin(`adj/entries/${e.entry_id}`, { method: 'DELETE' })
      else await admin(`adj/entries/${e.entry_id}/${what}`, { method: 'POST', body: {} })
      setMsg({ text: `Entry #${e.entry_id}: ${{ post: 'posted', unpost: 'back to draft', reverse: 'reversed', delete: 'deleted' }[what]}.` }); load()
    } catch (ex) { setMsg({ bad: true, text: ex.message }) } finally { setConfirm(null) }
  }
  const open = async (e) => { try { setEdit(await admin(`adj/entries/${e.entry_id}`)) } catch (ex) { setMsg({ bad: true, text: ex.message }) } }
  const sum = (pred) => (rows || []).filter(pred).reduce((s, r) => s + r.total, 0)
  const cnt = (pred) => (rows || []).filter(pred).length
  const years = useMemo(() => Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i), [])

  return (
    <div className="page">
      <header className="hero hero-3d">
        <Hero3D />
        <div><h1>Adjustments & Eliminations</h1><p>Audit adjustments, reclassifications and consolidation eliminations on top of the D365 ledger.</p></div>
        {can('adjust.edit') && <button className="hero-cta" onClick={() => setEdit({})}>+ New entry</button>}
      </header>
      {msg && <div className={`alert ${msg.bad ? 'bad' : 'good'}`}>{msg.text}</div>}
      {rows && <div className="tiles">
        <Tile label="Posted adjustments" value={fmt(sum((r) => r.status === 'Posted' && r.entry_type !== 'Elimination'))}
              sub={`${cnt((r) => r.status === 'Posted' && r.entry_type !== 'Elimination')} entries`} />
        <Tile label="Posted eliminations" value={fmt(sum((r) => r.status === 'Posted' && r.entry_type === 'Elimination'))}
              sub={`${cnt((r) => r.status === 'Posted' && r.entry_type === 'Elimination')} entries`} />
        <Tile label="Drafts" value={String(cnt((r) => r.status === 'Draft'))} tone={cnt((r) => r.status === 'Draft') ? 'down' : ''} sub="not in the statements yet" />
        <Tile label="Reversed" value={String(cnt((r) => r.reversed_by))} />
      </div>}
      <MotionCard as="section" hover={false} className="card stack">
        <div className="row">
          <input className="grow" placeholder="Search description, reference or #…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
          <select value={f.year} onChange={(e) => setF({ ...f, year: e.target.value ? Number(e.target.value) : '' })} aria-label="Year">
            <option value="">All years</option>{years.map((y) => <option key={y}>{y}</option>)}
          </select>
          <select value={f.entry_type} onChange={(e) => setF({ ...f, entry_type: e.target.value })} aria-label="Type">
            <option value="">All types</option>{TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status">
            <option value="">Draft and posted</option><option>Draft</option><option>Posted</option>
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Date</th><th>Type</th><th>Description</th><th>Companies</th><th className="num">Amount</th><th>Status</th><th /></tr></thead>
            <tbody>
              {!rows && <tr><td colSpan={8} className="muted">Loading…</td></tr>}
              {rows && !rows.length && <tr><td colSpan={8} className="muted">No entries{f.year ? ` for ${f.year}` : ''}{f.entry_type || f.status || f.q ? ' with these filters' : ''}. {can('adjust.edit') && 'Use “+ New entry”.'}</td></tr>}
              {rows?.map((r, i) => (
                <motion.tr key={r.entry_id} {...rowMotion(i, reduce)}>
                  <td data-no-tr>#{r.entry_id}</td>
                  <td className="small nowrap">{String(r.entry_date).slice(0, 10)}</td>
                  <td><span className={`adj-type t-${r.entry_type.toLowerCase()}`}>{r.entry_type}</span></td>
                  <td><b>{r.description}</b>{r.reference && <div className="muted small" data-no-tr>{r.reference}</div>}
                    {r.reverses_id && <div className="muted small">reverses #{r.reverses_id}</div>}
                    {r.reversed_by && <div className="muted small">reversed by #{r.reversed_by}</div>}</td>
                  <td className="small">{r.companies.map((c) => <span key={c} className="pill" data-no-tr>{c.toUpperCase()}</span>)}</td>
                  <td className="num">{fmt(r.total)}</td>
                  <td><span className={`pill ${pillOf(r.status)}`}>{r.status}</span><div className="muted small">{r.created_by}</div></td>
                  <td className="act">
                    {confirm?.id === r.entry_id
                      ? <><span className="small">{confirm.what}?</span> <button className="danger small-btn" onClick={() => act(r, confirm.what)}>Yes</button> <button className="small-btn" onClick={() => setConfirm(null)}>No</button></>
                      : <>
                        <button className="small-btn" onClick={() => open(r)}>{r.status === 'Draft' && can('adjust.edit') ? 'Edit' : 'View'}</button>{' '}
                        {r.status === 'Draft' && can('adjust.post') && <button className="small-btn" onClick={() => act(r, 'post')}>Post</button>}{' '}
                        {r.status === 'Posted' && can('adjust.post') && !r.reversed_by && <>
                          <button className="small-btn" onClick={() => setConfirm({ id: r.entry_id, what: 'reverse' })}>Reverse</button>{' '}
                          <button className="small-btn" onClick={() => setConfirm({ id: r.entry_id, what: 'unpost' })}>Unpost</button></>}
                        {r.status === 'Draft' && can('adjust.edit') && <button className="small-btn" onClick={() => setConfirm({ id: r.entry_id, what: 'delete' })}>Delete</button>}
                      </>}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">Only <b>posted</b> entries change the statements. Adjustments and reclassifications apply to their company; eliminations apply when the
          statements show all companies combined. See the effect line by line under Adjustments › Adjusted Statements.</p>
      </MotionCard>
      {edit && companies.length > 0 && (
        <EntryEditor entry={edit} tenant={tenant} company={scope.company} companies={companies} accounts={accounts} lines={lines}
                     onClose={() => setEdit(null)} onSaved={(text) => { setEdit(null); setMsg({ text }); setF((x) => ({ ...x, year: '', status: '', entry_type: '', q: '' })); load() }} />
      )}
    </div>
  )
}
