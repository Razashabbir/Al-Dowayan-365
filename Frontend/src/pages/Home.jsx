import { useEffect, useState } from 'react'
import { Bar, BarChart, ComposedChart, Line, XAxis, YAxis } from 'recharts'
import { admin, fmt, fmtDuration, fmtShort, fmtTime, shortMsg } from '../api'
import { useApp } from '../theme'
import { useAuth } from '../auth'
import { MotionCard } from '../components/motion'
import { Hero3D } from '../components/three'
import { ChartBox, monthRows, Tile } from './dash/common'
import { ADJ_ITEMS, ADMIN_ITEMS, CLOSE_ITEMS, DASH_ITEMS, ETL_ITEMS, REPORT_ITEMS } from '../components/Sidebar'
import { useBookmarks } from '../components/bookmarks'
import { motion, useReducedMotion } from '../components/motion'

const ALL_ITEMS = [...ETL_ITEMS, ...DASH_ITEMS, ...REPORT_ITEMS, ...ADJ_ITEMS, ...CLOSE_ITEMS, ...ADMIN_ITEMS]

/** The user's bookmarked pages (star in the top bar). */
function Bookmarks({ go }) {
  const bm = useBookmarks()
  const { setScope } = useApp()
  const reduce = useReducedMotion()
  if (!bm) return null
  const open = (b) => { if (b.company && b.tenant_key) setScope({ tenant: b.tenant_key, company: b.company }); go(b.path) }
  return (
    <MotionCard as="section" hover={false} className="card bm-card">
      <div className="row"><h2 className="grow">My bookmarks</h2>
        <span className="muted small">Save any page with the bookmark button in the top bar</span></div>
      {!bm.list.length && <p className="muted bm-empty">No bookmarks yet - open a dashboard or report and click the bookmark button next to the company list.</p>}
      <div className="bm-grid">
        {bm.list.map((b, i) => {
          const it = ALL_ITEMS.find((x) => x.path === b.path)
          const Icon = it?.icon
          return (
            <motion.div key={b.bookmark_id} className="bm-tile" initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * 0.04 }}>
              <button className="bm-open nav-item" onClick={() => open(b)} title={b.path}>
                {Icon ? <Icon /> : <span className="bm-dot" />}<span className="bm-text"><b>{b.title}</b>
                  <small className="muted">{b.company ? `Company ${b.company.toUpperCase()}` : b.path}</small></span>
              </button>
              <button className="bm-del" aria-label={`Remove ${b.title}`} title="Remove bookmark" onClick={() => bm.remove(b.bookmark_id)}>×</button>
            </motion.div>
          )
        })}
      </div>
    </MotionCard>
  )
}

const pill = (s) => ({ OK: 'pill ok', Partial: 'pill warn', Failed: 'pill bad', Running: 'pill run' }[s] || 'pill')
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0)
const day = (d) => (d ? String(d).slice(0, 10) : '–')

/** Home: summary of the whole project - group figures, every company, data health, ETL, dashboards and reports. */
const greeting = (h) => (h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 17 ? 'Good afternoon' : 'Good evening')

/** "Good afternoon, Administrator" above the overview - follows the clock while the page is open. */
function Greeting() {
  const { user } = useAuth()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t) }, [])
  if (!user) return null
  const name = (user.full_name || user.username).trim().split(/\s+/)[0]
  const ar = document.documentElement.lang === 'ar'
  return (
    <motion.div className="greeting" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <h2><span>{greeting(now.getHours())}</span>, <span data-no-tr>{name}</span></h2>
      <span className="muted small" data-no-tr>{now.toLocaleDateString(ar ? 'ar-SA-u-nu-latn' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
    </motion.div>
  )
}

export default function Home({ go }) {
  const { scope, setScope } = useApp()
  const { can, canPage } = useAuth()
  const [o, setO] = useState(null)
  const [s, setS] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = () => {
      if (can('etl.view')) admin('overview').then(setO).catch((e) => setError(e.message))
      admin('summary', { params: { tenant: scope?.tenant } }).then(setS).catch((e) => setError(e.message))
    }
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [scope?.tenant])

  const open = (company, path) => { setScope({ tenant: s.tenant.tenant_key, company }); go(path) }
  const cos = s?.companies || []
  const withData = cos.filter((c) => c.lines > 0)
  const sum = (k) => cos.reduce((a, c) => a + (c[k] || 0), 0)
  const rev = sum('revenue'), exp = sum('expenses'), prevRev = sum('prev_revenue')
  const t = o?.totals
  const db = o?.database
  const ledgerOk = s && s.ledger.lines ? pct(s.ledger.matched, s.ledger.lines) : 0
  const mapOk = s ? pct(s.mapping.workbook, s.mapping.accounts) : 0
  const built = s?.build?.message === 'Dashboard data refreshed.'

  return (
    <div className="page">
      <Greeting />
      <header className="hero hero-3d">
        <Hero3D />
        <div>
          <h1>Project overview</h1>
          <p>{s?.tenant ? `${s.tenant.name} · ${withData.length} of ${cos.length} companies with postings · year ${s.year} · last posting ${day(s.last_posting)}`
            : 'Dynamics 365 → SQL Server → dashboards and financial reports'}</p>
        </div>
        <div className="row tight">
          {can('dashboards.view') && <button onClick={() => go('/dashboards/overview')}>Dashboards</button>}
          {can('reports.view') && <button onClick={() => go('/reports/income-statement')}>Reports</button>}
          {can('etl.view') && <button onClick={() => go('/etl/jobs')}>Run ETL</button>}
        </div>
      </header>
      {error && <div className="alert bad">{error}</div>}
      <Bookmarks go={go} />
      {!s && !error && <p className="muted">Loading…</p>}
      {s && !s.tenant && (
        <div className="card empty"><h2>No tenant yet</h2><p className="muted">Add your Dynamics 365 environment to start.</p>
          <button className="primary" onClick={() => go('/etl/tenants')}>Add a tenant</button></div>
      )}

      {s?.tenant && <>
        <h2 className="section-title">Group figures {s.year} <span className="muted small">all companies added together, before eliminations</span></h2>
        <div className="tiles">
          <Tile label={`Revenue ${s.year}`} value={fmt(rev)}
                sub={prevRev ? <span className={rev >= prevRev ? 'up' : 'down'}>{rev >= prevRev ? '▲' : '▼'} {Math.abs(pct(rev - prevRev, Math.abs(prevRev)))}% vs {s.year - 1}</span> : 'no prior year'} />
          <Tile label={`Expenses ${s.year}`} value={fmt(exp)} />
          <Tile label={`Net profit ${s.year}`} value={fmt(rev - exp)} tone={rev - exp < 0 ? 'down' : 'up'}
                sub={rev ? `${pct(rev - exp, rev)}% margin` : ''} />
          <Tile label="Total assets" value={fmt(sum('assets'))} sub={`at ${day(s.last_posting)}`} />
          <Tile label="Cash & bank" value={fmt(sum('cash'))} sub="accounts named bank / cash" />
        </div>

        <h2 className="section-title">Data health</h2>
        <div className="tiles">
          <Tile label="Ledger lines matched to accounts" value={`${ledgerOk}%`} tone={ledgerOk < 95 ? 'down' : 'up'}
                sub={`${fmt(s.ledger.matched)} of ${fmt(s.ledger.lines)} lines`} />
          <Tile label="Dashboard data" value={built ? 'Up to date' : s.build.message ? 'Not built' : 'Never built'}
                tone={built ? 'up' : 'down'} sub={s.build.at ? `built ${fmtTime(s.build.at)}` : 'ETL › Jobs › Rebuild reports'} />
          <Tile label="Accounts mapped by FS workbook" value={`${mapOk}%`} tone={mapOk < 80 ? 'down' : 'up'}
                sub={<button className="linkish" onClick={() => go('/reports/mapping')}>{fmt(s.mapping.accounts - s.mapping.workbook)} by account range · review</button>} />
          {t && <Tile label="Failed D365 tables (7 days)" value={fmt(t.failures_7d)} tone={t.failures_7d ? 'down' : 'up'}
                      sub={<button className="linkish" onClick={() => go('/etl/history')}>{t.running_jobs ? `${t.running_jobs} job running` : 'see history'}</button>} />}
        </div>
        {!built && s.build.message && <div className="alert bad" style={{ marginBottom: 16 }}>{s.build.message}</div>}

        <div className="grid-2">
          <MotionCard as="section" hover={false} className="card">
            <ChartBox title={`Group revenue vs expenses by month - ${s.year}`} height={260}
                      three={{ data: monthRows({ revenue: s.monthly.revenue, expenses: s.monthly.expenses }),
                               series: [{ key: 'revenue', name: 'Revenue' }, { key: 'expenses', name: 'Expenses' }] }}>
              {(c) => (
                <ComposedChart data={monthRows({ revenue: s.monthly.revenue, expenses: s.monthly.expenses,
                  net: s.monthly.revenue.map((v, i) => (v == null ? null : v - (s.monthly.expenses[i] || 0))) })}>
                  {c.grid}{c.x()}{c.y}{c.tip}{c.legend}
                  <Bar dataKey="revenue" name="Revenue" fill="var(--c1)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expenses" name="Expenses" fill="var(--c2)" radius={[4, 4, 0, 0]} />
                  <Line dataKey="net" name="Net profit" stroke="var(--c3)" strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              )}
            </ChartBox>
          </MotionCard>
          <MotionCard as="section" hover={false} className="card">
            <ChartBox title={`Revenue and net profit by company - ${s.year}`} height={260}>
              {(c) => (
                <BarChart data={withData.map((x) => ({ name: x.company.toUpperCase(), revenue: x.revenue, net: x.net }))} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <XAxis type="number" tickFormatter={fmtShort} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                  <YAxis type="category" dataKey="name" width={60} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                  {c.tip}{c.legend}
                  <Bar dataKey="revenue" name="Revenue" fill="var(--c1)" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="net" name="Net profit" fill="var(--c3)" radius={[0, 4, 4, 0]} />
                </BarChart>
              )}
            </ChartBox>
          </MotionCard>
        </div>

        <MotionCard as="section" hover={false} className="card">
          <h2>Companies</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Company</th><th className="num">Ledger lines</th>
                <th className="num">Revenue {s.year}</th><th className="num">Net profit {s.year}</th>
                <th className="num">Total assets</th><th className="num">Cash & bank</th><th /></tr></thead>
              <tbody>
                {cos.map((c) => (
                  <tr key={c.company}>
                    <td><strong data-no-tr>{c.company.toUpperCase()}</strong> <span className="muted">{c.name}</span>
                      {c.company === s.tenant.default_company?.toLowerCase() && <span className="pill"> default</span>}
                      <div className="small muted">{c.lines ? `${day(c.first_date)} → ${day(c.last_date)}` : 'no postings'}</div></td>
                    <td className="num">{fmt(c.lines)}</td>
                    <td className="num">{fmt(c.revenue)}</td>
                    <td className={`num ${c.net < 0 ? 'down' : ''}`}>{fmt(c.net)}</td>
                    <td className="num">{fmt(c.assets)}</td>
                    <td className="num">{fmt(c.cash)}</td>
                    <td className="co-act">{c.lines > 0 && <>
                      {can('dashboards.view') && <button className="small-btn" onClick={() => open(c.company, '/dashboards/profit-loss')}>Dashboard</button>}{' '}
                      {can('reports.view') && <button className="small-btn" onClick={() => open(c.company, '/reports/income-statement')}>Reports</button>}</>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td>All companies</td><td className="num">{fmt(sum('lines'))}</td>
                <td className="num">{fmt(rev)}</td><td className="num">{fmt(rev - exp)}</td>
                <td className="num">{fmt(sum('assets'))}</td><td className="num">{fmt(sum('cash'))}</td><td /></tr></tfoot>
            </table>
          </div>
        </MotionCard>

        <div className="modules">
          {can('etl.view') && <MotionCard as="section" className="card module">
            <h2>ETL pipeline</h2>
            {t && <ul className="kv-list">
              <li><span>D365 tables loaded</span><b>{fmt(t.tables_loaded)}</b></li>
              <li><span>Rows in SQL</span><b>{fmt(t.total_rows)}</b></li>
              <li><span>Jobs in 7 days</span><b>{fmt(t.jobs_7d)}</b></li>
              <li><span>Database</span><b>{fmt(db.data_mb)} MB</b></li>
            </ul>}
            {db?.edition?.includes('Express') && db.data_mb > 7000 &&
              <div className="alert bad">SQL Express limit is 10 GB - database is at {fmt(db.data_mb)} MB.</div>}
            <div className="row tight"><button onClick={() => go('/etl/jobs')}>Jobs</button><button onClick={() => go('/etl/tenants')}>Tenants</button>
              <button onClick={() => go('/etl/counts')}>Counts</button></div>
          </MotionCard>}
          {can('dashboards.view') && <MotionCard as="section" className="card module">
            <h2>Dashboards</h2>
            <div className="link-list">{DASH_ITEMS.filter((i) => canPage(i.path)).map((i) => (
              <button key={i.path} className="nav-item mod-link" onClick={() => go(i.path)}><i.icon /> {i.label}</button>))}</div>
          </MotionCard>}
          {can('reports.view') && <MotionCard as="section" className="card module">
            <h2>Reports</h2>
            <div className="link-list">{REPORT_ITEMS.filter((i) => canPage(i.path)).map((i) => (
              <button key={i.path} className="nav-item mod-link" onClick={() => go(i.path)}><i.icon /> {i.label}</button>))}</div>
          </MotionCard>}
        </div>

        {o && <div className="grid">
          <MotionCard as="section" hover={false} className="card">
            <h2>Tenants</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th className="num">D365 tables</th><th className="num">Rows</th><th>Last sync</th></tr></thead>
                <tbody>{o.tenants.map((x) => (
                  <tr key={x.tenant_key} className="clickable" onClick={() => go('/etl/tenants')}>
                    <td><strong>{x.name}</strong>{!x.is_active && <span className="muted small"> · paused</span>}</td>
                    <td className="num">{fmt(x.entities)}</td><td className="num">{fmt(x.total_rows)}</td>
                    <td>{x.last_sync_status && <span className={pill(x.last_sync_status)}>{x.last_sync_status}</span>}
                      <span className="small muted"> {fmtTime(x.last_sync_at)}</span></td>
                  </tr>))}
                </tbody>
              </table>
            </div>
          </MotionCard>
          <MotionCard as="section" hover={false} className="card">
            <h2>Recent jobs</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th><th>Tenant</th><th>Status</th><th className="num">Time</th></tr></thead>
                <tbody>
                  {o.recent_jobs.map((j) => (
                    <tr key={j.job_id} className="clickable" onClick={() => go('/etl/jobs')} title={shortMsg(j.message)}>
                      <td>{j.job_id}</td><td>{j.tenant}</td><td><span className={pill(j.status)}>{j.status}</span></td>
                      <td className="num small">{fmtDuration(j.seconds)}</td>
                    </tr>))}
                  {!o.recent_jobs.length && <tr><td colSpan={4} className="muted">No jobs yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </MotionCard>
        </div>}
      </>}
    </div>
  )
}
