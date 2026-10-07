import { Fragment, useEffect, useState } from 'react'
import { MONTHS, admin, fmt } from '../../api'
import { useAuth } from '../../auth'
import { MotionCard, motion, rowMotion, useReducedMotion } from '../../components/motion'
import { DashFrame, Tile, useDashScope } from '../dash/common'

const fsNum = (v) => (v == null || Math.abs(v) < 0.5 ? '–' : v < 0 ? `(${fmt(-v)})` : fmt(v))
const STATUS = { Matched: 'ok', Difference: 'bad', Hidden: 'warn' }

function PackTable({ rows, cols, title }) {
  const reduce = useReducedMotion()
  return (
    <MotionCard as="section" hover={false} className="card fs-card">
      <h2>{title}</h2>
      <div className="table-wrap">
        <table className="fs worksheet">
          <thead><tr><th />{cols.map((c) => <th key={c.company} className="num" data-no-tr>{c.company.toUpperCase()}{c.currency ? <small className="muted"> {c.currency}</small> : ''}</th>)}
            <th className="num">Eliminations</th><th className="num">Group</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (r.kind === 'H'
              ? <motion.tr key={r.code} className="fs-h" {...rowMotion(i, reduce)}><td colSpan={cols.length + 3}>{r.label}</td></motion.tr>
              : <motion.tr key={r.code} className={r.kind === 'T' ? `fs-t ${['PFY', 'TA', 'TEL', 'TCI'].includes(r.code) ? 'fs-grand' : ''}` : 'fs-l'} {...rowMotion(i, reduce)}>
                  <td>{r.label}</td>{r.values.map((v, j) => <td key={j} className="num">{fsNum(v)}</td>)}
                  <td className={`num ${Math.abs(r.elim) > 0.5 ? 'ws-adj' : 'muted'}`}>{fsNum(r.elim)}</td><td className="num strong">{fsNum(r.group)}</td>
                </motion.tr>))}
          </tbody>
        </table>
      </div>
    </MotionCard>
  )
}

function Pack({ tenant, year, month, setError }) {
  const [d, setD] = useState(null)
  useEffect(() => { setD(null); admin('consol/pack', { params: { tenant, year, month }, timeoutMs: 180000 }).then(setD).catch((e) => setError(e.message)) }, [tenant, year, month]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="card muted">Building the group pack…</div>
  return <>
    {d.warnings.map((w) => <div key={w} className="alert">{w}</div>)}
    <div className="tiles">
      <Tile label={`Group profit · ${d.headings[0]}`} value={fsNum(d.profit.group)} sub={`owners ${fsNum(d.profit.owners)} · NCI ${fsNum(d.profit.nci)}`} />
      <Tile label="Group equity" value={fsNum(d.equity.group)} sub={`owners ${fsNum(d.equity.owners)} · NCI ${fsNum(d.equity.nci)}`} />
      <Tile label="Translation difference" value={fsNum(d.translation_difference)} sub="profit at closing vs average rate (OCI)" />
      <Tile label="Balance check" value={fsNum(d.check)} tone={Math.abs(d.check) < 1 ? 'up' : 'down'} sub={Math.abs(d.check) < 1 ? 'assets = equity + liabilities' : 'group does not balance'} />
    </div>
    <MotionCard as="section" hover={false} className="card">
      <div className="row"><h2 className="grow">Companies in the group · group currency {d.group_currency}</h2><button className="export-only no-print" onClick={() => window.print()}>Print / PDF</button></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Company</th><th>Currency</th><th className="num">Average rate</th><th className="num">Closing rate</th><th className="num">Ownership</th></tr></thead>
        <tbody>{d.companies.map((c) => <tr key={c.company}><td data-no-tr>{c.company.toUpperCase()} {c.name}</td><td>{c.currency}</td><td className="num">{c.average}</td><td className="num">{c.closing}</td><td className="num">{c.ownership}%</td></tr>)}</tbody>
      </table></div>
    </MotionCard>
    <PackTable title={`Consolidated statement of profit or loss · ${d.headings[0]}`} rows={d.income_statement} cols={d.companies} />
    <PackTable title={`Consolidated statement of financial position · ${d.as_of}`} rows={d.financial_position} cols={d.companies} />
    <p className="muted small">Each company = D365 ledger + posted adjustments, translated (profit or loss at the average rate, financial position at the closing rate).
      Eliminations = posted Elimination entries. Intercompany status: {d.ic.matched} matched, {d.ic.differences} with differences.</p>
  </>
}

function Matching({ tenant, year, month, setError, go }) {
  const { can } = useAuth()
  const [d, setD] = useState(null)
  const [open, setOpen] = useState({})
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = () => admin('consol/matching', { params: { tenant, year, month } }).then(setD).catch((e) => setError(e.message))
  useEffect(() => { setD(null); setRes(null); load() }, [tenant, year, month]) // eslint-disable-line react-hooks/exhaustive-deps
  const propose = async () => {
    setBusy(true)
    try { setRes(await admin('consol/eliminate', { method: 'POST', body: { tenant_key: tenant, year, month } })) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  if (!d) return <div className="card muted">Matching intercompany balances…</div>
  if (!d.configured) return <div className="card empty"><h2>No intercompany accounts yet</h2><p className="muted">Mark the due-to / due-from and intercompany revenue / cost accounts under the Setup tab.</p></div>
  return <>
    <div className="tiles">
      <Tile label="Pairs matched" value={String(d.matched)} tone="up" sub={`within ${fmt(d.tolerance)} tolerance`} />
      <Tile label="Pairs with differences" value={String(d.differences)} tone={d.differences ? 'down' : 'up'} sub={`as at ${d.as_of}`} />
    </div>
    <MotionCard as="section" hover={false} className="card">
      <div className="row">
        <h2 className="grow">Intercompany matching · {MONTHS[month - 1]} {year}</h2>
        {can('consol.manage') && can('adjust.edit') && <button className="primary" disabled={busy || !d.matched} onClick={propose}>{busy ? 'Creating…' : 'Propose eliminations for matched pairs'}</button>}
      </div>
      {res && <div className="alert good">{res.created.length} draft elimination entr{res.created.length === 1 ? 'y' : 'ies'} created{res.created.length ? ` (${res.created.map((c) => `#${c.entry_id}`).join(', ')})` : ''}.
        {res.skipped.length > 0 && <> Skipped: {res.skipped.join('; ')}.</>} <button className="linkish" onClick={() => go('/adjustments/journal')}>Open Adjustments › review and post</button></div>}
      <div className="table-wrap"><table>
        <thead><tr><th>Companies</th><th>Type</th><th className="num">Side A</th><th className="num">Side B</th><th className="num">Difference</th><th>Status</th></tr></thead>
        <tbody>{d.pairs.map((p) => {
          const k = `${p.a}-${p.b}-${p.kind}`
          return (
            <Fragment key={k}>
              <tr className="clickable" onClick={() => setOpen((o) => ({ ...o, [k]: !o[k] }))}>
                <td data-no-tr><span className="tw">{open[k] ? '▾' : '▸'}</span>{p.a.toUpperCase()} ↔ {p.b.toUpperCase()}</td><td>{p.kind === 'Balance' ? 'Balances' : 'Revenue / cost'}</td>
                <td className="num">{fsNum(p.a_amount)}</td><td className="num">{fsNum(p.b_amount)}</td>
                <td className={`num ${Math.abs(p.difference) > d.tolerance ? 'down' : ''}`}>{fsNum(p.difference)}</td>
                <td><span className={`pill ${STATUS[p.status]}`}>{p.status}</span> {p.note && <span className="muted small">{p.note}</span>}</td>
              </tr>
              {open[k] && p.lines.map((l) => <tr key={l.company + l.main_account} className="fs-a"><td colSpan={2} data-no-tr>{l.company.toUpperCase()} · {l.main_account} → {l.counterparty.toUpperCase()}</td><td className="num" colSpan={3}>{fsNum(l.amount)}</td><td /></tr>)}
            </Fragment>
          )
        })}</tbody>
      </table></div>
      <p className="muted small">Debit balances are positive, credit balances in brackets: a receivable in one company and the payable in the other net to zero. Proposed eliminations are drafts - review and post them under Adjustments.</p>
    </MotionCard>
  </>
}

function Setup({ tenant, year, month, setError }) {
  const { can } = useAuth()
  const manage = can('consol.manage')
  const [d, setD] = useState(null)
  const [cos, setCos] = useState([])
  const [ic, setIc] = useState([])
  const [rate, setRate] = useState({ currency: 'USD', year, month, closing: '', average: '' })
  const [sug, setSug] = useState(null)
  const [msg, setMsg] = useState('')
  const load = () => admin('consol/setup', { params: { tenant } }).then((r) => { setD(r); setCos(r.companies); setIc(r.ic_accounts) }).catch((e) => setError(e.message))
  useEffect(() => { load() }, [tenant]) // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn, ok) => { setMsg(''); try { await fn(); setMsg(ok); load() } catch (e) { setError(e.message) } }
  if (!d) return <div className="card muted">Loading…</div>
  const others = (c) => cos.filter((x) => x.company !== c)
  return <>
    {msg && <div className="alert good">{msg}</div>}
    <div className="grid-2">
      <MotionCard as="section" hover={false} className="card">
        <h2>Companies</h2>
        <table><thead><tr><th>Company</th><th>Currency</th><th className="num">Ownership %</th><th>Include</th></tr></thead>
          <tbody>{cos.map((c, i) => (
            <tr key={c.company}><td data-no-tr>{c.company.toUpperCase()} <span className="muted">{c.name}</span></td>
              <td><input className="sm-input" value={c.currency} maxLength={3} disabled={!manage} onChange={(e) => setCos((l) => l.map((x, j) => (j === i ? { ...x, currency: e.target.value.toUpperCase() } : x)))} /></td>
              <td className="num"><input className="sm-input num" type="number" min={0} max={100} value={c.ownership} disabled={!manage} onChange={(e) => setCos((l) => l.map((x, j) => (j === i ? { ...x, ownership: Number(e.target.value) } : x)))} /></td>
              <td><input type="checkbox" checked={c.include} disabled={!manage} onChange={(e) => setCos((l) => l.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))} /></td></tr>))}</tbody></table>
        {manage && <button className="primary" onClick={() => run(() => admin('consol/companies', { method: 'PUT', body: { tenant_key: tenant, items: cos } }), 'Companies saved.')}>Save companies</button>}
        <p className="muted small">Group currency = {d.group_currency} (System Configuration). Companies in another currency need exchange rates.</p>
      </MotionCard>
      <MotionCard as="section" hover={false} className="card">
        <h2>Exchange rates <span className="muted small">1 unit = x {d.group_currency}</span></h2>
        <div className="table-wrap" style={{ maxHeight: 260 }}><table><thead><tr><th>Currency</th><th>Month</th><th className="num">Closing</th><th className="num">Average YTD</th><th /></tr></thead>
          <tbody>{d.rates.map((r) => <tr key={`${r.currency}${r.year}${r.month}`}><td>{r.currency}</td><td>{MONTHS[r.month - 1]} {r.year}</td><td className="num">{r.closing}</td><td className="num">{r.average}</td>
            <td>{manage && <button className="linkish" onClick={() => run(() => admin(`consol/rates/${r.currency}/${r.year}/${r.month}`, { method: 'DELETE' }), 'Rate deleted.')}>×</button>}</td></tr>)}
            {!d.rates.length && <tr><td colSpan={5} className="muted">No rates - all companies are treated as {d.group_currency}.</td></tr>}</tbody></table></div>
        {manage && <div className="row tight rate-add">
          <input className="sm-input" value={rate.currency} maxLength={3} onChange={(e) => setRate({ ...rate, currency: e.target.value.toUpperCase() })} />
          <select value={rate.month} onChange={(e) => setRate({ ...rate, month: Number(e.target.value) })}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          <input className="sm-input" type="number" value={rate.year} onChange={(e) => setRate({ ...rate, year: Number(e.target.value) })} />
          <input className="sm-input" type="number" step="0.0001" placeholder="closing" value={rate.closing} onChange={(e) => setRate({ ...rate, closing: e.target.value })} />
          <input className="sm-input" type="number" step="0.0001" placeholder="average" value={rate.average} onChange={(e) => setRate({ ...rate, average: e.target.value })} />
          <button disabled={!(rate.closing > 0 && rate.average > 0)} onClick={() => run(() => admin('consol/rates', { method: 'PUT', body: [{ ...rate, closing: Number(rate.closing), average: Number(rate.average) }] }), 'Rate saved.')}>Add rate</button>
        </div>}
      </MotionCard>
    </div>
    <MotionCard as="section" hover={false} className="card">
      <div className="row"><h2 className="grow">Intercompany accounts</h2>
        <button onClick={() => admin('consol/suggest', { params: { tenant, year, month } }).then(setSug).catch((e) => setError(e.message))}>Find intercompany accounts</button></div>
      <table><thead><tr><th>Company</th><th>Account</th><th>Counterparty</th><th>Type</th><th /></tr></thead>
        <tbody>{ic.map((x, i) => (
          <tr key={i}><td data-no-tr>{x.company.toUpperCase()}</td><td data-no-tr>{x.main_account}</td>
            <td><select value={x.counterparty} disabled={!manage} onChange={(e) => setIc((l) => l.map((y, j) => (j === i ? { ...y, counterparty: e.target.value } : y)))}>
              {others(x.company).map((o) => <option key={o.company} value={o.company}>{o.company.toUpperCase()}</option>)}</select></td>
            <td><select value={x.kind} disabled={!manage} onChange={(e) => setIc((l) => l.map((y, j) => (j === i ? { ...y, kind: e.target.value } : y)))}>
              <option value="Balance">Balance (due to / from)</option><option value="PL">Revenue / cost</option></select></td>
            <td>{manage && <button className="linkish" onClick={() => setIc((l) => l.filter((_, j) => j !== i))}>Remove</button>}</td></tr>))}
          {!ic.length && <tr><td colSpan={5} className="muted">None yet - use “Find intercompany accounts”.</td></tr>}</tbody></table>
      {sug && <div className="sug-box">
        <h3>Accounts that look intercompany</h3>
        {!sug.length && <p className="muted small">No account name contains due from / due to / related party / intercompany.</p>}
        {sug.filter((s) => !ic.some((x) => x.company === s.company && x.main_account === s.main_account)).map((s) => (
          <div key={s.company + s.main_account} className="row tight sug-row">
            <span data-no-tr><b>{s.company.toUpperCase()}</b> {s.main_account} {s.account_name}</span><span className="muted small">{fsNum(s.balance)}</span><span className="grow" />
            {manage && <button onClick={() => setIc((l) => [...l, { company: s.company, main_account: s.main_account, kind: s.kind,
              counterparty: (others(s.company).find((o) => (s.account_name || '').toLowerCase().includes(o.company)) || others(s.company)[0] || {}).company }])}>Add</button>}
          </div>))}
      </div>}
      {manage && <button className="primary" onClick={() => run(() => admin('consol/ic-accounts', { method: 'PUT', body: { tenant_key: tenant, items: ic.filter((x) => x.counterparty) } }), 'Intercompany accounts saved.')}>Save intercompany accounts</button>}
    </MotionCard>
  </>
}

export default function Consolidation({ go }) {
  const scope = useDashScope()
  const { tenant, year, month, ready, setError } = scope
  const [tab, setTab] = useState('pack')
  return (
    <DashFrame title="Consolidation" subtitle="Intercompany matching, currency translation and the group pack" scope={scope} withMonth loading={false}>
      <div className="tabs" role="tablist">
        {[['pack', 'Group pack'], ['ic', 'Intercompany matching'], ['setup', 'Setup']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {ready && tab === 'pack' && <Pack tenant={tenant} year={year} month={month} setError={setError} />}
      {ready && tab === 'ic' && <Matching tenant={tenant} year={year} month={month} setError={setError} go={go} />}
      {ready && tab === 'setup' && <Setup tenant={tenant} year={year} month={month} setError={setError} />}
    </DashFrame>
  )
}
