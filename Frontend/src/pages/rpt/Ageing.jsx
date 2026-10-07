import { useEffect, useState } from 'react'
import { Bar, BarChart, Cell } from 'recharts'
import { MONTHS, admin, api, fmt } from '../../api'
import { useAuth } from '../../auth'
import { MotionCard, motion, rowMotion, useReducedMotion } from '../../components/motion'
import { ChartBox, DashFrame, Tile, downloadCsv, useDashScope } from '../dash/common'

const COLORS = ['#94a3b8', '#16a34a', '#eab308', '#f97316', '#dc2626']
const TABLE = { customer: 'cust_open_trans', vendor: 'vend_open_trans' }

/** Shown until the open-transaction table is loaded: finds the D365 entity and loads it. */
function LoadSource({ tenant, side, go, onLoaded }) {
  const { can } = useAuth()
  const [src, setSrc] = useState(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [manual, setManual] = useState('')

  const load = () => api('ageing/sources', { tenant }).then(setSrc).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [tenant]) // eslint-disable-line react-hooks/exhaustive-deps

  const searchCatalog = async () => {
    setBusy('catalog'); setErr('')
    try { await admin(`tenants/${tenant}/catalog`, { timeoutMs: 300000 }); await load() } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const pick = async (entity) => {
    setBusy(entity); setErr(''); setMsg('')
    try {
      const cur = await admin(`tenants/${tenant}/entities`)
      const items = cur.filter((e) => e.table !== TABLE[side] && e.name !== entity)
        .map((e) => ({ name: e.name, mode: e.mode, date_field: e.date_field, enabled: e.enabled, table: e.table }))
      items.push({ name: entity, mode: 'full', enabled: true, table: TABLE[side] })
      await admin(`tenants/${tenant}/entities`, { method: 'PUT', body: items })
      const job = await admin(`tenants/${tenant}/sync`, { method: 'POST', body: { entities: [entity], full_reload: true } })
      setMsg(`Loading ${entity} into stg.${TABLE[side]} (job #${job.job_id}). This page fills in when the job has finished.`)
      const t = setInterval(async () => {
        const s = await api('ageing/sources', { tenant }).catch(() => null)
        if (s?.sides?.[side]?.loaded && s.sides[side].rows) { clearInterval(t); onLoaded() }
      }, 10000)
      setTimeout(() => clearInterval(t), 30 * 60000)
    } catch (e) { setErr(e.message) } finally { setBusy('') }
  }

  const cands = src?.candidates?.[side] || []
  return (
    <MotionCard as="section" hover={false} className="card">
      <h2>{side === 'customer' ? 'Customer' : 'Vendor'} open transactions are not loaded yet</h2>
      <p className="muted">Ageing needs the D365 open-transaction entity of {side === 'customer' ? 'customers' : 'vendors'} (one row per open invoice / payment with its due date).
        It is loaded into <code data-no-tr>stg.{TABLE[side]}</code>.</p>
      {!can('etl.run') && <div className="alert">Ask a user who may run ETL to open this page and load the table.</div>}
      {can('etl.run') && <>
        {cands.length > 0 ? (
          <div className="stack tight-stack">
            <p className="small">D365 entities that look right (open-transaction entities first):</p>
            <div className="row tight">{cands.map((c) => <button key={c} className={c.toLowerCase().includes('open') ? 'primary' : ''} disabled={!!busy} onClick={() => pick(c)} data-no-tr>{busy === c ? 'Starting…' : c}</button>)}</div>
          </div>
        ) : (
          <p className="small">{src?.catalog_cached ? 'No matching entity in the D365 catalogue - type the entity name below.' : 'The D365 catalogue has not been read yet.'}
            {' '}{!src?.catalog_cached && <button onClick={searchCatalog} disabled={!!busy}>{busy === 'catalog' ? 'Reading the catalogue (about a minute)…' : 'Search the D365 catalogue'}</button>}</p>
        )}
        <div className="row tight">
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder={side === 'customer' ? 'e.g. CustTransOpenBiEntities' : 'e.g. VendTransOpenBiEntities'} />
          <button disabled={!manual.trim() || !!busy} onClick={() => pick(manual.trim())}>Load this entity</button>
          <button className="linkish" onClick={() => go('/etl/jobs')}>Open ETL › Jobs</button>
        </div>
      </>}
      {msg && <div className="alert good">{msg}</div>}
      {err && <div className="alert bad">{err}</div>}
    </MotionCard>
  )
}

export default function Ageing({ go }) {
  const scope = useDashScope()
  const { tenant, company, year, month, ready, setError } = scope
  const [side, setSide] = useState('customer')
  const [basis, setBasis] = useState('due')
  const [d, setD] = useState(null)
  const [q, setQ] = useState('')
  const [tick, setTick] = useState(0)
  const reduce = useReducedMotion()

  useEffect(() => {
    if (!ready) return
    setD(null)
    api('ageing', { tenant, company, side, year, month, basis }).then(setD).catch((e) => setError(e.message))
  }, [tenant, company, side, year, month, basis, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = d?.rows?.filter((r) => !q || `${r.account} ${r.name}`.toLowerCase().includes(q.toLowerCase())) || []
  const exportCsv = () => downloadCsv(`${side}_ageing_${company}_${d.as_of}.csv`, ['Account', 'Name', ...d.buckets, 'Total', 'Oldest (days)'],
    d.rows.map((r) => [r.account, r.name, ...r.buckets, r.total, r.oldest_days]))

  return (
    <DashFrame title="Customer & Vendor Ageing" subtitle="Open balances in 0–30, 31–60, 61–90 and 90+ day buckets" scope={scope} withMonth loading={!d}
               extra={<label>Age by<select value={basis} onChange={(e) => setBasis(e.target.value)}><option value="due">Due date</option><option value="invoice">Invoice date</option></select></label>}>
      <div className="tabs" role="tablist">
        {[['customer', 'Customers (receivables)'], ['vendor', 'Vendors (payables)']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={side === k} className={side === k ? 'on' : ''} onClick={() => setSide(k)}>{l}</button>
        ))}
      </div>
      {d && !d.loaded && <LoadSource tenant={tenant} side={side} go={go} onLoaded={() => setTick((x) => x + 1)} />}
      {d?.loaded && <>
        <div className="tiles">
          <Tile label={`Open ${side === 'customer' ? 'receivables' : 'payables'}`} value={fmt(d.total)} sub={`${d.accounts} ${side}s · as at ${d.as_of}`} />
          <Tile label="Overdue" value={fmt(d.overdue)} tone={d.overdue > 0 ? 'down' : 'up'} sub={d.total ? `${((d.overdue / d.total) * 100).toFixed(1)}% of the balance` : ''} />
          <Tile label="More than 90 days" value={fmt(d.over_90)} tone={d.over_90 > 0 ? 'down' : 'up'} sub={d.total ? `${((d.over_90 / d.total) * 100).toFixed(1)}%` : ''} />
          <Tile label="Not yet due" value={fmt(d.totals[0])} sub={`aged by ${d.basis}`} />
        </div>
        <MotionCard as="section" hover={false} className="card">
          <ChartBox title="Balance by age bucket" legend={false} height={240}>
            {(c) => (
              <BarChart data={d.buckets.map((b, i) => ({ name: b, amount: d.totals[i] }))}>
                {c.grid}{c.x()}{c.y}{c.tip}
                <Bar dataKey="amount" name="Amount" radius={[6, 6, 0, 0]}>{d.buckets.map((b, i) => <Cell key={b} fill={COLORS[i]} />)}</Bar>
              </BarChart>
            )}
          </ChartBox>
        </MotionCard>
        <MotionCard as="section" hover={false} className="card">
          <div className="row fs-tools no-print">
            <h2 className="grow">By {side} · as at {MONTHS[month - 1]} {year}</h2>
            <input type="search" placeholder={`Search ${side}…`} value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="export-only" onClick={exportCsv}>Export CSV</button>
          </div>
          {d.note && <div className="alert">{d.note}</div>}
          <div className="table-wrap">
            <table className="ageing">
              <thead><tr><th>{side === 'customer' ? 'Customer' : 'Vendor'}</th>{d.buckets.map((b, i) => <th key={b} className="num"><span className="age-dot" style={{ background: COLORS[i] }} />{b}</th>)}
                <th className="num">Total</th><th className="num">Oldest</th><th>Spread</th></tr></thead>
              <tbody>
                {rows.slice(0, 300).map((r, i) => (
                  <motion.tr key={r.account} {...rowMotion(i, reduce)}>
                    <td><span data-no-tr>{r.account}</span> <span className="muted" data-no-tr>{r.name}</span></td>
                    {r.buckets.map((v, j) => <td key={j} className={`num ${j === 4 && v > 0.5 ? 'down' : ''}`}>{Math.abs(v) < 0.5 ? '–' : fmt(v)}</td>)}
                    <td className="num strong">{fmt(r.total)}</td><td className="num muted">{r.oldest_days ? `${r.oldest_days} d` : '–'}</td>
                    <td><div className="age-bar">{r.buckets.map((v, j) => (v > 0 && r.total > 0 ? <span key={j} style={{ width: `${(v / r.total) * 100}%`, background: COLORS[j] }} /> : null))}</div></td>
                  </motion.tr>
                ))}
                <tr className="fs-t"><td>Total</td>{d.totals.map((v, j) => <td key={j} className="num">{fmt(v)}</td>)}<td className="num">{fmt(d.total)}</td><td /><td /></tr>
              </tbody>
            </table>
          </div>
          {rows.length > 300 && <p className="muted small">Showing the 300 largest of {rows.length} - use search or Export CSV for all.</p>}
          <p className="muted small">Source: {d.table} (D365 open transactions, last ETL). Days are counted to {d.as_of}.</p>
        </MotionCard>
      </>}
    </DashFrame>
  )
}
