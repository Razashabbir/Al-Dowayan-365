import { useEffect, useState } from 'react'
import { CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, fmt, fmtShort, MONTHS } from '../../api'
import { useApp } from '../../theme'
import { CountUp, MotionCard, motion, Reveal } from '../../components/motion'
import { Chart3D, Hero3D } from '../../components/three'

/** Tenant + company come from the top bar; year (and optionally month) are chosen on the page. */
export function useDashScope() {
  const { scope } = useApp()
  const tenant = scope?.tenant
  const company = scope?.company
  const [years, setYears] = useState(null)
  const [year, setYear] = useState('')
  const [month, setMonth] = useState(() => new Date().getMonth() + 1)
  const [tenantName, setTenantName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { api('tenants').then((t) => setTenantName(t.find((x) => x.tenant_key === tenant)?.name || '')).catch(() => {}) }, [tenant])
  useEffect(() => {
    if (!tenant || !company) return
    setYears(null); setError('')
    api('years', { tenant, company }).then((y) => {
      const list = y.map((r) => r.year)
      setYears(list)
      setYear(list[0] || '')
      setMonth(list[0] === new Date().getFullYear() ? new Date().getMonth() + 1 : 12)
    }).catch((e) => setError(e.message))
  }, [tenant, company])

  return { tenant, company, years, year, setYear, month, setMonth, tenantName, error, setError,
           ready: !!(tenant && company && year) }
}

/** Page header strip with the year (and month) pickers, plus the standard empty / error states. */
export function DashFrame({ title, subtitle, scope, withMonth = false, withYear = true, children, loading, extra, actions }) {
  const { company, years, year, setYear, month, setMonth, tenantName, error } = scope
  return (
    <div className="page">
      <motion.header className="hero hero-3d" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
                     transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
        <Hero3D />
        <div>
          <h1>{title}</h1>
          <p>{subtitle}{tenantName && company ? ` · ${tenantName} · ${company}` : ''}</p>
        </div>
        <div className="filters">
          {extra}
          {withMonth && (
            <label>Month
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </label>
          )}
          {withYear && (
            <label>Year
              <select value={year} onChange={(e) => setYear(Number(e.target.value))} disabled={!years?.length}>
                {(years || []).map((y) => <option key={y}>{y}</option>)}
              </select>
            </label>
          )}
        </div>
      </motion.header>
      {actions}
      {!company && !error && <div className="alert">Pick a company in the top-right company list.</div>}
      {company && (error || (years && !years.length)) && <WhyEmpty tenant={scope.tenant} company={company} error={error} />}
      {company && years?.length > 0 && loading && !error && <div className="card muted">Loading…</div>}
      {company && years?.length > 0 && !loading && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>{children}</motion.div>
      )}
    </div>
  )
}

export function Tile({ label, value, sub, tone }) {
  return (
    <MotionCard className="tile">
      <span className="label">{label}</span>
      <strong className={tone || ''}>{typeof value === 'string' || typeof value === 'number' ? <CountUp value={value} /> : value}</strong>
      {sub && <div className="sub">{sub}</div>}
    </MotionCard>
  )
}

export function Change({ cur, prev, invert = false }) {
  if (!prev) return <span className="muted">no prior year</span>
  const pct = ((cur - prev) / Math.abs(prev)) * 100
  const good = invert ? pct <= 0 : pct >= 0
  return <span className={good ? 'up' : 'down'}>{pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}% vs last year</span>
}

/** Shared chart scaffolding: one y-axis, quiet grid, formatted tooltip. */
export function ChartBox({ title, height = 280, children, legend = true, three }) {
  const [mode, setMode] = useState('2d')
  const flat = (
    <ResponsiveContainer width="100%" height={height}>
        {children({
          grid: <CartesianGrid stroke="var(--grid)" vertical={false} />,
          x: (key = 'name') => <XAxis dataKey={key} tick={{ fill: 'var(--muted)', fontSize: 12 }} />,
          y: <YAxis tickFormatter={fmtShort} tick={{ fill: 'var(--muted)', fontSize: 12 }} width={60} />,
          tip: <Tooltip formatter={(v) => fmt(v)} contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }} />,
          legend: legend ? <Legend /> : null,
        })}
    </ResponsiveContainer>
  )
  return (
    <>
      <div className="chart-head">
        <h2>{title}</h2>
        {three && (
          <div className="seg no-print" role="group" aria-label="Chart view">
            <button className={mode === '2d' ? 'on' : ''} onClick={() => setMode('2d')}>2D</button>
            <button className={mode === '3d' ? 'on' : ''} onClick={() => setMode('3d')}>3D</button>
          </div>
        )}
      </div>
      <Reveal y={16}>
        {mode === '3d' && three ? <Chart3D {...three} height={height + 20} fallback={flat} /> : flat}
      </Reveal>
    </>
  )
}

export const monthRows = (series) => MONTHS.map((name, i) => {
  const r = { name }
  Object.entries(series).forEach(([k, arr]) => { r[k] = arr?.[i] ?? null })
  return r
})

export function downloadCsv(filename, header, lines) {
  const esc = (v) => (typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v ?? '')
  const csv = [header.join(','), ...lines.map((l) => l.map(esc).join(','))].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  Object.assign(document.createElement('a'), { href: url, download: filename }).click()
}

export const pct = (v) => (v == null ? '–' : `${v.toFixed(1)}%`)
export { fmt }

/** Explains an empty dashboard: asks the API which step (load → build → company) is missing. */
export function WhyEmpty({ tenant, company, error }) {
  const [d, setD] = useState(null)
  const [fail, setFail] = useState(null)
  useEffect(() => {
    setD(null); setFail(null)
    api('diagnose', { tenant, company }).then(setD).catch((e) => setFail(e))
  }, [tenant, company, error])

  if (fail?.status === 404) {
    return <div className="alert bad why"><strong>The API is still running the old code.</strong>
      <span>Stop uvicorn (Ctrl+C in its window), start it again, then press Ctrl+F5 here.</span></div>
  }
  if (fail) return <div className="alert bad why"><strong>Could not load data.</strong><span>{error || fail.message}</span></div>
  if (!d) return <div className="card muted">Checking why there is no data…</div>
  const n = (v) => (v == null ? 'not loaded' : fmt(v))
  return (
    <div className="alert bad why">
      <strong>{d.problem || (error ? 'Could not load data.' : `No ledger data for company ${company}.`)}</strong>
      <span>{d.fix || error || 'ETL › Jobs › Rebuild reports.'}</span>
      <small data-no-tr>
        Ledger lines {n(d.gl_entries)} · Journal headers {n(d.gl_headers)} · Main accounts {n(d.main_accounts)} ·
        Dashboard rows {fmt(d.fact_rows)}{d.companies?.length ? ` (${d.companies.map((c) => `${c.company}: ${fmt(c.rows)}`).join(', ')})` : ''}
      </small>
    </div>
  )
}
