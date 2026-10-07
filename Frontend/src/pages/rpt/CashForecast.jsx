import { useEffect, useState } from 'react'
import { Bar, ComposedChart, Line, ReferenceLine } from 'recharts'
import { admin, api, fmt } from '../../api'
import { useAuth } from '../../auth'
import { MotionCard, motion, rowMotion, useReducedMotion } from '../../components/motion'
import Modal from '../../components/Modal'
import { ChartBox, DashFrame, Tile, downloadCsv, useDashScope } from '../dash/common'

const FIELDS = [
  ['ar_delay_days', 'Customers pay (days after due)', 'Positive = late, negative = early'],
  ['ar_collect_pct', 'Receivables collected (%)', 'Share of open receivables expected to come in'],
  ['ar_doubtful_days', 'Leave out receivables overdue more than (days)', 'Treated as doubtful - not forecast'],
  ['ap_delay_days', 'We pay vendors (days after due)', 'Positive = we pay late'],
  ['overdue_weeks', 'Spread overdue items over (weeks)', 'Overdue receipts and payments are spread over the first weeks'],
  ['default_terms', 'Payment terms when no due date (days)', 'Due date = invoice date + these days'],
  ['min_cash', 'Minimum cash balance', 'Weeks closing below it are flagged'],
]
const FREQ = { once: 'Once', weekly: 'Weekly', monthly: 'Monthly' }
const KIND = { ar: 'Customer', ap: 'Vendor', in: 'Receipt', out: 'Payment' }
const dm = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
const today = () => new Date().toISOString().slice(0, 10)

/** Add or edit one cash item (payroll, rent, loan, VAT, capex …). */
function ItemForm({ scope, item, categories, onClose, onDone }) {
  const [f, setF] = useState(() => item || { name: '', category: 'Other', direction: 'out', amount: '', frequency: 'monthly', start_date: today(), end_date: '', note: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    setBusy(true); setErr('')
    const body = { ...f, tenant_key: scope.tenant, company: scope.company, amount: Number(f.amount), end_date: f.end_date || null, note: f.note || null }
    try {
      await admin(item?.item_id ? `cash-forecast/items/${item.item_id}` : 'cash-forecast/items', { method: item?.item_id ? 'PUT' : 'POST', body })
      onDone()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal title={item?.item_id ? 'Edit cash item' : 'New cash item'} onClose={onClose}>
      <div className="form-grid">
        <label className="full">Name<input value={f.name} maxLength={100} onChange={set('name')} placeholder="e.g. Salaries, Office rent, Loan instalment" /></label>
        <label>Type<select value={f.direction} onChange={set('direction')}><option value="out">Payment (cash out)</option><option value="in">Receipt (cash in)</option></select></label>
        <label>Category<select value={f.category} onChange={set('category')}>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>Amount<input type="number" min="0" step="0.01" value={f.amount} onChange={set('amount')} /></label>
        <label>Repeats<select value={f.frequency} onChange={set('frequency')}>{Object.entries(FREQ).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>{f.frequency === 'once' ? 'Date' : 'First date'}<input type="date" value={f.start_date} onChange={set('start_date')} /></label>
        {f.frequency !== 'once' && <label>Until (optional)<input type="date" value={f.end_date || ''} onChange={set('end_date')} /></label>}
        <label className="full">Note<input value={f.note || ''} maxLength={300} onChange={set('note')} /></label>
      </div>
      {f.frequency === 'monthly' && <p className="muted small">Repeats every month on day {Number(f.start_date?.slice(8, 10)) || '–'} (the last day in shorter months).</p>}
      {err && <div className="alert bad">{err}</div>}
      <div className="row tight"><span className="grow" /><button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy || !f.name.trim() || !(Number(f.amount) > 0) || !f.start_date} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></div>
    </Modal>
  )
}

/** Monthly payroll / rent proposed from the ledger; each one can be added as a cash item. */
function Suggestions({ scope, onClose, onDone }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [added, setAdded] = useState({})
  useEffect(() => { api('cash-forecast/suggest', { tenant: scope.tenant, company: scope.company }).then(setD).catch((e) => setErr(e.message)) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const add = async (s, i) => {
    try {
      await admin('cash-forecast/items', { method: 'POST', body: { tenant_key: scope.tenant, company: scope.company, name: s.name, category: s.category, direction: s.direction,
        amount: s.amount, frequency: s.frequency, start_date: s.start_date, note: `From ledger: ${s.accounts.map((a) => a.main_account).join(', ')}` } })
      setAdded({ ...added, [i]: true }); onDone()
    } catch (e) { setErr(e.message) }
  }
  return (
    <Modal wide title="Suggest cash items from the ledger" onClose={onClose}>
      {!d && !err && <p className="muted">Reading the ledger…</p>}
      {d && <p className="muted small">Average monthly expense {d.from} to {d.to} on accounts whose names look like salaries or rent. Check the amount - accruals and non-cash items are included.</p>}
      {d && !d.suggestions.length && <p className="muted">No salary or rent accounts with postings in that period.</p>}
      {d?.suggestions.map((s, i) => (
        <section key={s.category} className="card cff-sug">
          <div className="row tight"><b className="grow">{s.name}</b><span className="strong">{fmt(s.amount)} / month</span>
            <button className="primary" disabled={added[i]} onClick={() => add(s, i)}>{added[i] ? 'Added' : 'Add'}</button></div>
          <p className="muted small">First payment {s.start_date}, then monthly. Accounts: {s.accounts.map((a) => `${a.main_account} ${a.account_name || ''} (${fmt(a.monthly)})`).join(' · ')}</p>
        </section>
      ))}
      {err && <div className="alert bad">{err}</div>}
    </Modal>
  )
}

export default function CashForecast({ go }) {
  const scope = useDashScope()
  const { tenant, company, ready, setError } = scope
  const { can } = useAuth()
  const edit = can('forecast.edit')
  const reduce = useReducedMotion()
  const [weeks, setWeeks] = useState(13)
  const [what, setWhat] = useState({})          // assumption values being tried (not saved)
  const [d, setD] = useState(null)
  const [items, setItems] = useState(null)
  const [cats, setCats] = useState([])
  const [form, setForm] = useState(null)
  const [sug, setSug] = useState(false)
  const [wk, setWk] = useState(null)
  const [msg, setMsg] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => { setWhat({}) }, [tenant, company])
  useEffect(() => {
    if (!ready) return
    setD(null)
    const p = Object.fromEntries(Object.entries(what).filter(([, v]) => v !== '' && v != null))
    api('cash-forecast', { tenant, company, weeks, ...p }).then(setD).catch((e) => setError(e.message))
  }, [tenant, company, ready, weeks, what, tick]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready) return
    api('cash-forecast/items', { tenant, company }).then((r) => { setItems(r.items); setCats(r.categories) }).catch((e) => setError(e.message))
  }, [tenant, company, ready, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => setTick((x) => x + 1)
  const s = d?.settings
  const [draft, setDraft] = useState({})
  useEffect(() => { if (s) setDraft(s) }, [d]) // eslint-disable-line react-hooks/exhaustive-deps
  const changed = s && FIELDS.some(([k]) => Number(draft[k]) !== Number(d.saved_settings[k]))
  const apply = () => setWhat(Object.fromEntries(FIELDS.map(([k]) => [k, draft[k]])))
  const saveDefault = async () => {
    try {
      await admin('cash-forecast/settings', { method: 'PUT', body: { tenant_key: tenant, company, ...Object.fromEntries(FIELDS.map(([k]) => [k, Number(draft[k])])) } })
      setWhat({}); refresh(); setMsg('Assumptions saved for this company.'); setTimeout(() => setMsg(''), 2500)
    } catch (e) { setError(e.message) }
  }
  const del = async (it) => {
    if (!window.confirm(`Delete "${it.name}"?`)) return
    try { await admin(`cash-forecast/items/${it.item_id}`, { method: 'DELETE' }); refresh() } catch (e) { setError(e.message) }
  }

  const ROWS = d ? [
    ['Opening cash', 'opening', 'fs-h'],
    ['Customer collections', 'ar_in', ''], ['Other receipts', 'other_in', ''],
    ['Vendor payments', 'ap_out', 'neg'], ['Other payments', 'other_out', 'neg'],
    ['Net cash flow', 'net', 'fs-t'], ['Closing cash', 'closing', 'fs-t fs-grand'],
  ] : []
  const exportCsv = () => downloadCsv(`cash_forecast_${company}_${d.as_of}.csv`, ['Line', ...d.weeks.map((w) => `Wk ${w.n} ${w.start}`), 'Total'],
    ROWS.map(([l, k, cls]) => [l, ...d.weeks.map((w) => (cls === 'neg' ? -w[k] : w[k])),
      k === 'opening' ? d.opening : k === 'closing' ? d.closing : (cls === 'neg' ? -d.totals[k] : d.totals[k])]))
  const stale = d?.gl_last_date && (Date.now() - new Date(`${d.gl_last_date}T00:00:00`)) / 86400000 > 7
  const lo = d?.left_out

  return (
    <DashFrame title="Cash Flow Forecast" subtitle="Weekly cash position from today: open receivables and payables plus planned cash items"
               scope={scope} withYear={false} loading={!d}
               extra={<label>Horizon<select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
                 {[8, 13, 26].map((n) => <option key={n} value={n}>{n} weeks</option>)}</select></label>}>
      {d && <>
        {d.first_below && <div className="alert bad">Cash falls below the minimum of {fmt(s.min_cash)} in week {d.first_below} ({dm(d.weeks[d.first_below - 1].start)}).</div>}
        {stale && <div className="alert">The last ledger posting is {d.gl_last_date} - opening cash may be out of date. Run ETL to refresh it.</div>}
        {(!d.sources.ar.loaded || !d.sources.ap.loaded) && (
          <div className="alert">{[!d.sources.ar.loaded && 'Customer', !d.sources.ap.loaded && 'vendor'].filter(Boolean).join(' and ')} open transactions are not loaded, so
            {!d.sources.ar.loaded ? ' collections' : ''}{!d.sources.ar.loaded && !d.sources.ap.loaded ? ' and' : ''}{!d.sources.ap.loaded ? ' payments' : ''} are missing.{' '}
            <button className="linkish" onClick={() => go('/reports/ageing')}>Load them on Customer &amp; Vendor Ageing</button></div>
        )}
        {d.what_if && <div className="alert">What-if: these figures use assumptions that are not saved. <button className="linkish" onClick={() => setWhat({})}>Back to saved assumptions</button></div>}

        <div className="tiles">
          <Tile label="Cash today" value={fmt(d.opening)} sub={`${d.cash_accounts.length} bank / cash account(s) · ledger to ${d.gl_last_date || '–'}`} />
          <Tile label={`Net flow · ${weeks} weeks`} value={fmt(d.totals.net)} tone={d.totals.net >= 0 ? 'up' : 'down'}
                sub={`in ${fmt(d.totals.ar_in + d.totals.other_in)} · out ${fmt(d.totals.ap_out + d.totals.other_out)}`} />
          <Tile label={`Cash on ${dm(d.horizon)}`} value={fmt(d.closing)} tone={d.closing >= s.min_cash ? 'up' : 'down'} sub={`end of week ${weeks}`} />
          <Tile label="Lowest point" value={fmt(d.lowest.closing)} tone={d.lowest.closing >= s.min_cash ? '' : 'down'}
                sub={`week ${d.lowest.week} (${dm(d.lowest.start)})${s.min_cash ? ` · minimum ${fmt(s.min_cash)}` : ''}`} />
        </div>

        <MotionCard as="section" hover={false} className="card">
          <ChartBox title="Weekly receipts, payments and closing cash">
            {(c) => (
              <ComposedChart data={d.weeks.map((w) => ({ name: `W${w.n}`, receipts: w.ar_in + w.other_in, payments: -(w.ap_out + w.other_out), closing: w.closing }))} stackOffset="sign">
                {c.grid}{c.x()}{c.y}{c.tip}{c.legend}
                <ReferenceLine y={0} stroke="var(--border)" />
                {s.min_cash ? <ReferenceLine y={s.min_cash} stroke="var(--bad-fg)" strokeDasharray="5 4" label={{ value: 'Minimum', fill: 'var(--muted)', fontSize: 11, position: 'insideTopLeft' }} /> : null}
                <Bar dataKey="receipts" name="Receipts" stackId="f" fill="var(--up)" fillOpacity={0.75} radius={[4, 4, 0, 0]} />
                <Bar dataKey="payments" name="Payments" stackId="f" fill="var(--down)" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                <Line dataKey="closing" name="Closing cash" stroke="var(--c1)" strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            )}
          </ChartBox>
        </MotionCard>

        <MotionCard as="section" hover={false} className="card">
          <div className="row fs-tools no-print">
            <h2 className="grow">Week by week · from {d.as_of}</h2>
            <span className="muted small">Click a week for its receipts and payments</span>
            <button className="export-only" onClick={exportCsv}>Export CSV</button>
          </div>
          <div className="table-wrap">
            <table className="cff-table">
              <thead><tr><th>Line</th>{d.weeks.map((w) => (
                <th key={w.n} className={`num ${w.below_min ? 'down' : ''}`}><button className="linkish" onClick={() => setWk(w)}>W{w.n}<br /><small className="muted">{dm(w.start)}</small></button></th>))}
                <th className="num">Total</th></tr></thead>
              <tbody>
                {ROWS.map(([label, k, cls]) => (
                  <tr key={k} className={cls === 'neg' ? '' : cls}>
                    <td>{label}</td>
                    {d.weeks.map((w) => {
                      const v = cls === 'neg' ? -w[k] : w[k]
                      return <td key={w.n} className={`num ${k === 'closing' && w.below_min ? 'down strong' : ''}`}>{Math.abs(v) < 0.5 ? '–' : fmt(v)}</td>
                    })}
                    <td className="num strong">{k === 'opening' ? fmt(d.opening) : k === 'closing' ? fmt(d.closing) : fmt(cls === 'neg' ? -d.totals[k] : d.totals[k])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Opening cash = ledger balance today of the asset accounts whose name contains bank or cash. Collections and payments come from {d.sources.ar.items} customer and {d.sources.ap.items} vendor
            items (last ETL), netted per customer / vendor: payments and credit notes not yet settled in D365 are applied to the oldest invoices, leaving {d.sources.ar.open_items} customer
            invoices ({d.sources.ar.accounts} customers) and {d.sources.ap.open_items} vendor invoices ({d.sources.ap.accounts} vendors) to forecast.
            {(() => {
              const cr = [d.sources.ar.advances > 0.5 && `customer credit balances ${fmt(d.sources.ar.advances)}`, d.sources.ap.advances > 0.5 && `vendor advances ${fmt(d.sources.ap.advances)}`].filter(Boolean)
              return cr.length ? ` Not forecast as cash: ${cr.join(' and ')}.` : ''
            })()}{' '}
            {(lo.ar_doubtful > 0.5 || lo.ar_beyond > 0.5 || lo.ap_beyond > 0.5 || lo.ar_uncollected > 0.5) && <>Not in the forecast:
              {lo.ar_doubtful > 0.5 && ` ${fmt(lo.ar_doubtful)} doubtful receivables (over ${s.ar_doubtful_days} days overdue);`}
              {lo.ar_uncollected > 0.5 && ` ${fmt(lo.ar_uncollected)} receivables not expected to be collected (${s.ar_collect_pct}%);`}
              {lo.ar_beyond > 0.5 && ` ${fmt(lo.ar_beyond)} receivables due after ${d.horizon};`}
              {lo.ap_beyond > 0.5 && ` ${fmt(lo.ap_beyond)} payables due after ${d.horizon}.`}</>}
          </p>
        </MotionCard>

        <div className="cff-cols">
          <MotionCard as="section" hover={false} className="card">
            <div className="row"><h2 className="grow">Assumptions</h2>
              {s.updated_at && <span className="muted small">saved by {s.updated_by || '–'}</span>}</div>
            <div className="form-grid">
              {FIELDS.map(([k, l, hint]) => (
                <label key={k} title={hint}>{l}
                  <input type="number" step={k === 'min_cash' ? '1000' : '1'} value={draft[k] ?? ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
                </label>
              ))}
            </div>
            <div className="row tight">
              <button onClick={apply}>Try these (what-if)</button>
              {edit && <button className="primary" disabled={!changed} onClick={saveDefault}>Save for {company?.toUpperCase()}</button>}
              <span className="grow" />{msg && <span className="up small">{msg}</span>}
            </div>
            {!edit && <p className="muted small">You can try other values; saving them needs the permission “Cash flow forecast”.</p>}
          </MotionCard>

          <MotionCard as="section" hover={false} className="card">
            <div className="row"><h2 className="grow">Other cash items</h2>
              {edit && <><button onClick={() => setSug(true)}>Suggest from ledger</button><button className="primary" onClick={() => setForm({})}>+ Cash item</button></>}</div>
            <p className="muted small">Cash that does not go through customer or vendor invoices: salaries, rent, loan instalments, VAT and zakat, capital expenditure, financing.</p>
            {items && !items.length && <p className="muted">No cash items yet.{edit ? ' Add salaries and rent first - “Suggest from ledger” proposes them.' : ''}</p>}
            {items?.length > 0 && (
              <div className="table-wrap">
                <table className="cff-items">
                  <thead><tr><th>Item</th><th>Repeats</th><th>From</th><th className="num">Amount</th>{edit && <th />}</tr></thead>
                  <tbody>
                    {items.map((it, i) => (
                      <motion.tr key={it.item_id} {...rowMotion(i, reduce)}>
                        <td><b>{it.name}</b> <span className="pill">{it.category}</span>{it.note && <div className="muted small">{it.note}</div>}</td>
                        <td>{FREQ[it.frequency]}{it.end_date ? ` until ${it.end_date}` : ''}</td>
                        <td>{it.start_date}</td>
                        <td className={`num ${it.direction === 'in' ? 'up' : 'down'}`}>{it.direction === 'in' ? '+' : '−'}{fmt(it.amount)}</td>
                        {edit && <td className="nowrap"><button className="linkish" onClick={() => setForm({ ...it, end_date: it.end_date || '' })}>Edit</button>{' '}
                          <button className="linkish" onClick={() => del(it)}>Delete</button></td>}
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </MotionCard>
        </div>
      </>}

      {form && <ItemForm scope={scope} item={form.item_id ? form : null} categories={cats} onClose={() => setForm(null)} onDone={() => { setForm(null); refresh() }} />}
      {sug && <Suggestions scope={scope} onClose={() => setSug(false)} onDone={refresh} />}
      {wk && (
        <Modal wide title={`Week ${wk.n} · ${dm(wk.start)} – ${dm(wk.end)}`} onClose={() => setWk(null)}>
          <div className="tiles">
            <Tile label="Opening" value={fmt(wk.opening)} /><Tile label="Net" value={fmt(wk.net)} tone={wk.net >= 0 ? 'up' : 'down'} />
            <Tile label="Closing" value={fmt(wk.closing)} tone={wk.below_min ? 'down' : ''} />
          </div>
          {!wk.lines.length ? <p className="muted">No receipts or payments expected this week.</p> : (
            <table className="cff-items">
              <thead><tr><th>Type</th><th>From / to</th><th className="num">Amount</th></tr></thead>
              <tbody>{wk.lines.map((l, i) => {
                const out = l.kind === 'ap' || l.kind === 'out'
                return <tr key={i}><td>{KIND[l.kind]}</td><td data-no-tr>{l.label}</td><td className={`num ${out ? 'down' : 'up'}`}>{out ? '−' : '+'}{fmt(l.amount)}</td></tr>
              })}</tbody>
            </table>
          )}
          {wk.more_lines > 0 && <p className="muted small">The {wk.lines.length} largest are shown; {wk.more_lines} smaller ones are in the totals.</p>}
          <p className="muted small">Overdue items are spread evenly over the first {s.overdue_weeks} weeks, so they appear here as part amounts.</p>
        </Modal>
      )}
    </DashFrame>
  )
}
