import { Fragment, useEffect, useState } from 'react'
import { Bar, ComposedChart, Line } from 'recharts'
import { MONTHS, admin, api, download, fmt } from '../../api'
import { useAuth } from '../../auth'
import { MotionCard, motion, rowMotion, useReducedMotion } from '../../components/motion'
import Modal from '../../components/Modal'
import { ChartBox, DashFrame, Tile, downloadCsv, monthRows, useDashScope } from '../dash/common'

const pctTxt = (v) => (v == null ? '–' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`)

function readFile(f) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(new Error('The file could not be read.'))
    r.readAsDataURL(f)
  })
}

/** Budgets: upload / generate / template / delete. */
function BudgetSetup({ scope, onDone, onClose }) {
  const { tenant, company, years } = scope
  const [year, setYear] = useState(() => (years?.[0] || new Date().getFullYear()))
  const [name, setName] = useState(`Budget ${year}`)
  const [growth, setGrowth] = useState(5)
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const yrs = [...new Set([new Date().getFullYear() + 1, new Date().getFullYear(), ...(years || [])])].sort((a, b) => b - a)

  const run = async (fn) => { setBusy(true); setErr(''); try { await fn(); onDone() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  const upload = () => run(async () => {
    const b64 = await readFile(file)
    await admin('budget/upload', { method: 'POST', body: { tenant_key: tenant, company, year: Number(year), name, filename: file.name, content_b64: b64 } })
  })
  const generate = () => run(() => admin('budget/generate', { method: 'POST', body: { tenant_key: tenant, company, year: Number(year), name, growth_pct: Number(growth) } }))

  return (
    <Modal wide title={`New budget · ${company?.toUpperCase()}`} onClose={onClose}>
      <div className="form-grid">
        <label>Budget year<select value={year} onChange={(e) => { setYear(e.target.value); setName(`Budget ${e.target.value}`) }}>{yrs.map((y) => <option key={y}>{y}</option>)}</select></label>
        <label>Name<input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></label>
      </div>
      <div className="bud-ways">
        <section className="card">
          <h3>1 · Upload a file</h3>
          <p className="muted small">CSV or Excel: a column <b>Account</b> and columns <b>Jan … Dec</b>, revenue and expenses as positive amounts. Start from the template - it lists every P&amp;L account with last year's actuals.</p>
          <button onClick={() => download(`/api/report/budget/template?tenant=${tenant}&company=${company}&year=${year}`, `budget_${company}_${year}.csv`).catch((e) => setErr(e.message))}>Download template</button>
          <label className="file-btn">{file ? file.name : 'Choose file…'}<input type="file" accept=".csv,.xlsx,.xlsm" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
          <button className="primary" disabled={!file || busy || !name.trim()} onClick={upload}>{busy ? 'Uploading…' : 'Upload budget'}</button>
        </section>
        <section className="card">
          <h3>2 · Generate from last year</h3>
          <p className="muted small">Takes {year - 1} actuals per account and month and applies a growth %.</p>
          <label>Growth %<input type="number" step="0.5" value={growth} onChange={(e) => setGrowth(e.target.value)} /></label>
          <button className="primary" disabled={busy || !name.trim()} onClick={generate}>{busy ? 'Working…' : `Generate from ${year - 1} actuals`}</button>
        </section>
      </div>
      {err && <div className="alert bad">{err}</div>}
      <p className="muted small">A budget with the same name and year is replaced.</p>
    </Modal>
  )
}

export default function BudgetActual() {
  const scope = useDashScope()
  const { tenant, company, ready, setError } = scope
  const { can } = useAuth()
  const [list, setList] = useState(null)
  const [bid, setBid] = useState('')
  const [month, setMonth] = useState(12)
  const [d, setD] = useState(null)
  const [setup, setSetup] = useState(false)
  const [only, setOnly] = useState(false)
  const reduce = useReducedMotion()

  const loadList = () => api('budget/list', { tenant, company }).then((l) => {
    setList(l)
    if (!l.some((b) => String(b.budget_id) === String(bid))) setBid(l[0]?.budget_id || '')
  }).catch((e) => setError(e.message))
  useEffect(() => { if (tenant && company) { setList(null); setD(null); loadList() } }, [tenant, company]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!bid) { setD(null); return }
    setD(null)
    api('budget/variance', { tenant, company, budget_id: bid, month }).then(setD).catch((e) => setError(e.message))
  }, [bid, month]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const b = list?.find((x) => String(x.budget_id) === String(bid))
    if (b && b.year === new Date().getFullYear()) setMonth(Math.max(1, new Date().getMonth()))
  }, [bid]) // eslint-disable-line react-hooks/exhaustive-deps

  const del = async () => {
    if (!window.confirm('Delete this budget?')) return
    try { await admin(`budget/${bid}`, { method: 'DELETE' }); setBid(''); loadList() } catch (e) { setError(e.message) }
  }
  const t = d?.totals
  const lines = d ? d.lines.filter((l) => !only || Math.abs(l.variance) > 0.5) : []
  const exportCsv = () => downloadCsv(`budget_vs_actual_${company}_${d.budget.year}_${month}.csv`,
    ['Account', 'Name', 'Type', 'Actual YTD', 'Budget YTD', 'Variance', 'Variance %', 'Full-year budget'],
    d.lines.map((l) => [l.main_account, l.account_name, l.group, l.actual_ytd, l.budget_ytd, l.variance, l.variance_pct, l.full_year_budget]))

  return (
    <DashFrame title="Budget vs Actual" subtitle="Upload budgets and see variances by account and month" scope={scope} loading={!list}
               extra={<>
                 <label>Budget
                   <select value={bid} onChange={(e) => setBid(e.target.value)} disabled={!list?.length}>
                     {!list?.length && <option value="">No budget yet</option>}
                     {(list || []).map((b) => <option key={b.budget_id} value={b.budget_id}>{b.year} · {b.name}</option>)}
                   </select>
                 </label>
                 <label>Up to<select value={month} onChange={(e) => setMonth(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
                 {can('budget.edit') && <button className="hero-cta" onClick={() => setSetup(true)} disabled={!ready}>+ Budget</button>}
               </>}>
      {setup && <BudgetSetup scope={scope} onClose={() => setSetup(false)} onDone={() => { setSetup(false); loadList() }} />}
      {list && !list.length && (
        <div className="card empty"><h2>No budget for {company?.toUpperCase()} yet</h2>
          <p className="muted">Upload a budget file or generate one from last year's actuals.</p>
          {can('budget.edit') ? <button className="primary" onClick={() => setSetup(true)}>Create a budget</button> : <p className="muted small">Ask a user with the permission “Upload budgets”.</p>}
        </div>
      )}
      {bid && !d && <div className="card muted">Loading…</div>}
      {d && <>
        <div className="tiles">
          <Tile label={`Revenue · Jan–${MONTHS[month - 1]}`} value={fmt(t.Revenue.actual)} sub={<span className={t.Revenue.actual >= t.Revenue.budget ? 'up' : 'down'}>budget {fmt(t.Revenue.budget)} · {pctTxt(t.Revenue.budget ? (t.Revenue.actual / t.Revenue.budget - 1) * 100 : null)}</span>} />
          <Tile label={`Expenses · Jan–${MONTHS[month - 1]}`} value={fmt(t.Expense.actual)} sub={<span className={t.Expense.actual <= t.Expense.budget ? 'up' : 'down'}>budget {fmt(t.Expense.budget)} · {pctTxt(t.Expense.budget ? (t.Expense.actual / t.Expense.budget - 1) * 100 : null)}</span>} />
          <Tile label="Net result vs budget" value={fmt(t.Net.actual - t.Net.budget)} tone={t.Net.actual >= t.Net.budget ? 'up' : 'down'} sub={`actual ${fmt(t.Net.actual)} · budget ${fmt(t.Net.budget)}`} />
          <Tile label={`Full-year budget ${d.budget.year}`} value={fmt(t.Net.full_year_budget)} sub={`${d.budget.source || ''}`} />
        </div>
        <MotionCard as="section" hover={false} className="card">
          <ChartBox title={`Net result by month - actual vs budget ${d.budget.year}`}>
            {(c) => (
              <ComposedChart data={monthRows({ actual: d.months.map((m, i) => (i < month ? m.net_actual : null)), budget: d.months.map((m) => m.net_budget),
                                                rev: d.months.map((m, i) => (i < month ? m.revenue_actual : null)), revb: d.months.map((m) => m.revenue_budget) })}>
                {c.grid}{c.x()}{c.y}{c.tip}{c.legend}
                <Bar dataKey="actual" name="Net actual" fill="var(--c1)" radius={[4, 4, 0, 0]} />
                <Line dataKey="budget" name="Net budget" stroke="var(--c3)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
                <Line dataKey="rev" name="Revenue actual" stroke="var(--c2)" strokeWidth={2} dot={{ r: 2 }} />
                <Line dataKey="revb" name="Revenue budget" stroke="var(--c2)" strokeWidth={1.5} strokeDasharray="3 3" dot={false} />
              </ComposedChart>
            )}
          </ChartBox>
        </MotionCard>
        <MotionCard as="section" hover={false} className="card">
          <div className="row fs-tools no-print">
            <h2 className="grow">By account · Jan–{MONTHS[month - 1]} {d.budget.year}</h2>
            <label className="check"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Only accounts with a variance</label>
            {can('budget.edit') && <button onClick={del}>Delete budget</button>}
            <button className="export-only" onClick={exportCsv}>Export CSV</button>
          </div>
          <div className="table-wrap">
            <table className="fs bud-table">
              <thead><tr><th>Account</th><th className="num">Actual</th><th className="num">Budget</th><th className="num">Variance</th><th className="num">%</th>
                <th className="num">{MONTHS[month - 1]} actual</th><th className="num">{MONTHS[month - 1]} budget</th><th className="num">Full-year budget</th></tr></thead>
              <tbody>
                {['Revenue', 'Expense'].map((g) => (
                  <Fragment key={g}>
                    <tr className="fs-h"><td colSpan={8}>{g === 'Revenue' ? 'Revenue' : 'Expenses'}</td></tr>
                    {lines.filter((l) => l.group === g).map((l, i) => (
                      <motion.tr key={l.main_account} {...rowMotion(i, reduce)}>
                        <td><span data-no-tr>{l.main_account}</span> {l.account_name}</td>
                        <td className="num">{fmt(l.actual_ytd)}</td><td className="num">{fmt(l.budget_ytd)}</td>
                        <td className={`num ${l.variance > 0.5 ? 'up' : l.variance < -0.5 ? 'down' : ''}`}>{fmt(l.variance)}</td>
                        <td className="num muted">{pctTxt(l.variance_pct)}</td>
                        <td className="num">{fmt(l.actual_month)}</td><td className="num">{fmt(l.budget_month)}</td><td className="num muted">{fmt(l.full_year_budget)}</td>
                      </motion.tr>
                    ))}
                    <tr className="fs-t"><td>Total {g === 'Revenue' ? 'revenue' : 'expenses'}</td><td className="num">{fmt(t[g].actual)}</td><td className="num">{fmt(t[g].budget)}</td>
                      <td className={`num ${(g === 'Revenue' ? 1 : -1) * (t[g].actual - t[g].budget) >= 0 ? 'up' : 'down'}`}>{fmt((g === 'Revenue' ? 1 : -1) * (t[g].actual - t[g].budget))}</td>
                      <td /><td /><td /><td className="num muted">{fmt(t[g].full_year_budget)}</td></tr>
                  </Fragment>
                ))}
                <tr className="fs-t fs-grand"><td>Net result</td><td className="num">{fmt(t.Net.actual)}</td><td className="num">{fmt(t.Net.budget)}</td>
                  <td className={`num ${t.Net.actual - t.Net.budget >= 0 ? 'up' : 'down'}`}>{fmt(t.Net.actual - t.Net.budget)}</td><td /><td /><td /><td className="num muted">{fmt(t.Net.full_year_budget)}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="muted small">Variance is favourable (green) when revenue is above budget or expenses are below it. Actuals exclude year-end closing entries.</p>
        </MotionCard>
      </>}
    </DashFrame>
  )
}
