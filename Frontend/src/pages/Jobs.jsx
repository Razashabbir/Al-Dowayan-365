import { useCallback, useEffect, useRef, useState } from 'react'
import { admin, fmt, fmtDuration, fmtTime, shortMsg } from '../api'
import Pager, { paginate } from '../components/Pager'
import { useApp } from '../theme'

const STATUS_TEXT = { OK: 'Loaded successfully', FAILED: 'Failed', Running: 'Loading…', Partial: 'Partly loaded', Failed: 'Failed' }
/** The ETL note of one table ("full; added 8 columns") in words, for the hover message of the Result column. */
function explainRun(status, message) {
  const head = STATUS_TEXT[status] || status || 'Not run yet'
  if (!message) return head
  if (status === 'FAILED' || status === 'Failed') return `${head}: ${message}`
  if (/^skipped/i.test(message)) return `Skipped: ${message.replace(/^skipped:?\s*/i, '')}`
  const parts = message.split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
    let m
    if (p === 'full') return 'All rows reloaded'
    if ((m = p.match(/^(.+?) from (\d{4}-\d{2}-\d{2})/))) return `Rows changed since ${m[2]} reloaded (by ${m[1]})`
    if (p === 'table created') return 'SQL table created'
    if (p === 'table ok') return 'SQL table already up to date'
    if ((m = p.match(/^added (\d+) columns?$/))) return `${m[1]} new D365 field${m[1] === '1' ? '' : 's'} added to the SQL table`
    return p.charAt(0).toUpperCase() + p.slice(1)
  })
  return [head, ...parts].join('\n• ')
}

const snake = (name) => name.replace(/(?<!^)(?=[A-Z][a-z])/g, '_').toLowerCase().slice(0, 120)

const utc = (s) => new Date(String(s).endsWith('Z') ? s : `${s}Z`).getTime()   // SQL datetimes come back as UTC without a zone

const pill = (s) => ({ OK: 'pill ok', Partial: 'pill warn', Failed: 'pill bad', FAILED: 'pill bad', Running: 'pill run' }[s] || 'pill')
/** Status text; while running it shows animated dots: Running. -> Running.. -> Running... */
const Status = ({ s }) => (s === 'Running'
  ? <span className="loading-dots" aria-label="Running">Running<i>.</i><i>.</i><i>.</i></span> : s)

/** Tenant dropdown, also used by Counts and History. */
export function TenantFilter({ value, onChange, allLabel = 'All tenants', required = false, onLoaded }) {
  const [tenants, setTenants] = useState([])
  useEffect(() => { admin('tenants').then((t) => { setTenants(t); onLoaded?.(t) }).catch(() => {}) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label>Tenant
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        {!required && <option value="">{allLabel}</option>}
        {tenants.map((t) => <option key={t.tenant_key} value={t.tenant_key}>{t.name}</option>)}
      </select>
    </label>
  )
}

/* ------------------------------------------------------------------ one job, live ---- */
function JobDetail({ id, onClose, onRetry, onFinished }) {
  const [job, setJob] = useState(null)
  const [onlyFailed, setOnlyFailed] = useState(false)
  const [, setNow] = useState(0)
  const timer = useRef(null)
  const skew = useRef(0)                       // server clock - browser clock (ms)

  useEffect(() => {
    let was = null
    const tick = () => admin(`jobs/${id}`).then((j) => {
      if (j.server_now) skew.current = utc(j.server_now) - Date.now()
      setJob(j)
      if (j.status !== 'Running') {
        clearInterval(timer.current)
        if (was === 'Running') onFinished?.()
      }
      was = j.status
    }).catch(() => {})
    tick()
    timer.current = setInterval(tick, 2500)
    return () => clearInterval(timer.current)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // running steps: count their seconds up live, every second
  const running = job?.status === 'Running'
  useEffect(() => {
    if (!running) return undefined
    const t = setInterval(() => setNow((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [running])
  const since = (ms) => Math.max(0, Math.floor((Date.now() + skew.current - ms) / 1000))
  const seconds = (s) => (s.status === 'Running' && s.run_at ? since(utc(s.run_at)) : s.duration_sec ?? '')

  if (!job) return <section className="card"><p className="muted">Loading job {id}…</p></section>
  const failed = job.steps.filter((s) => s.status === 'FAILED')
  const steps = onlyFailed ? failed : job.steps
  const done = job.steps.filter((s) => s.status !== 'Running').length
  // finished tables count fully; a table still loading counts by rows loaded / rows D365 reported (expected_rows)
  const part = (s) => (s.status !== 'Running' ? 1
    : s.expected_rows > 0 ? Math.min(0.99, (Number(s.rows_loaded) || 0) / s.expected_rows) : 0)
  const progress = job.total_entities ? job.steps.reduce((a, s) => a + part(s), 0) / job.total_entities : 0
  const pct = Math.min(100, Math.floor(progress * 100))
  const unknown = job.steps.some((s) => s.status === 'Running' && !(s.expected_rows > 0))   // older run without row totals
  // every table loaded but the job still running = the reporting tables are being built; it started when the last table ended
  const building = running && job.steps.length > 0 && done >= job.steps.length && done >= job.total_entities
  const buildStart = building ? Math.max(...job.steps.map((s) => utc(s.run_at) + (Number(s.duration_sec) || 0) * 1000)) : 0

  return (
    <section className="card stack">
      <div className="row">
        <h2>Job #{job.job_id} <span className={pill(job.status)}>{job.status}{running && job.started_at ? ` · ${fmtDuration(since(utc(job.started_at)))}` : ''}</span></h2>
        <div className="row tight">
          {failed.length > 0 && job.status !== 'Running' && (
            <button className="primary" onClick={() => onRetry(failed.map((s) => s.entity))}>
              Retry {failed.length} failed D365 table{failed.length > 1 ? 's' : ''}
            </button>
          )}
          <label className="check"><input type="checkbox" checked={onlyFailed} onChange={(e) => setOnlyFailed(e.target.checked)} /> Only failed</label>
          {onClose && <button onClick={onClose}>Close</button>}
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Started {fmtTime(job.started_at)}{job.finished_at ? ` · finished ${fmtTime(job.finished_at)}` : ''} ·
        {' '}{done} of {job.total_entities} D365 tables · <span title={job.message || ''}>{shortMsg(job.message)}</span>
      </p>
      {job.status === 'Running' && (
        <div className="progress-row">
          <div className="progress live" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${Math.max(progress * 100, 2)}%` }} /></div>
          <span className="progress-pct" title={unknown ? 'This run started before row totals were recorded - the % counts finished tables only' : undefined}>{pct}%</span>
        </div>)}
      <div className="table-wrap">
        <table>
          <thead><tr><th>D365 Table</th><th>Status</th><th className="num">Rows</th><th className="num">Seconds</th><th>Details</th></tr></thead>
          <tbody>
            {steps.map((s) => (
              <tr key={s.entity}>
                <td>{s.entity}</td>
                <td><span className={pill(s.status)}>{s.status === 'Running'
                  ? <span className="loading-dots" aria-label="Loading">Loading<i>.</i><i>.</i><i>.</i></span> : s.status}</span></td>
                <td className="num">{s.status === 'Running'
                  ? (s.expected_rows > 0 ? `${fmt(s.rows_loaded || 0)} of ${fmt(s.expected_rows)}` : s.rows_loaded ? `${fmt(s.rows_loaded)}…` : '')
                  : fmt(s.rows_loaded)}</td>
                <td className="num">{seconds(s)}</td>
                <td className="wrap small" title={explainRun(s.status, s.message)}>{shortMsg(s.message)}</td>
              </tr>
            ))}
            {building && !onlyFailed && (
              <tr>
                <td>Dashboard data (reporting tables)</td>
                <td><span className={pill('Running')}>Building…</span></td>
                <td className="num" />
                <td className="num">{since(buildStart)}</td>
                <td className="wrap small muted">Rebuilding the dashboard and report tables from the loaded data</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/* --------------------------------------------------------------------- page ---- */
export default function Jobs() {
  const { scope } = useApp()
  const [tenant, setTenant] = useState(() => {
    try { const t = sessionStorage.getItem('ad-jobs-tenant'); if (t) return Number(t) } catch { /* */ }
    return scope?.tenant ?? null
  })
  const [tables, setTables] = useState(null)
  const [runningJob, setRunningJob] = useState(null)
  const [openJob, setOpenJob] = useState(null)
  const [runs, setRuns] = useState(null)
  const [status, setStatus] = useState('')
  const [full, setFull] = useState(false)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [checked, setChecked] = useState(() => new Set())   // tables ticked by the user
  const [catalog, setCatalog] = useState(null)
  const [catErr, setCatErr] = useState('')
  const [size, setSize] = useState(20)

  const tenantRow = useRef(null)
  useEffect(() => { try { if (tenant) sessionStorage.setItem('ad-jobs-tenant', String(tenant)) } catch { /* */ } }, [tenant])

  const loadTables = useCallback(() => {
    if (!tenant) return
    admin(`tenants/${tenant}/table-status`).then((r) => {
      setTables(r.tables)
      setRunningJob(r.running_job)
      if (r.running_job) setOpenJob((o) => o ?? r.running_job)
    }).catch((e) => setMsg({ bad: true, text: e.status === 404 && e.message === 'Not Found'
      ? 'The API is running an older version. Restart uvicorn (Ctrl+C, then: uvicorn main:app --port 8000) and refresh.'
      : e.message }))
  }, [tenant])
  const loadRuns = useCallback(() => {
    if (!tenant) return
    admin('jobs', { params: { tenant, status, limit: 100 } }).then(setRuns).catch(() => {})
  }, [tenant, status])

  useEffect(() => { setTables(null); setOpenJob(null); loadTables() }, [loadTables])
  // a job started elsewhere (scheduler, command line, another browser) also locks the Run ETL buttons
  useEffect(() => {
    if (runningJob) return undefined
    const t = setInterval(loadTables, 10000)
    return () => clearInterval(t)
  }, [runningJob, loadTables])
  useEffect(() => { setCatalog(null); setCatErr(''); setPage(1); setChecked(new Set()) }, [tenant])
  useEffect(() => {
    if (catalog || !tenant) return
    admin(`tenants/${tenant}/catalog`, { timeoutMs: 300000 })
      .then((c) => setCatalog(c.entities)).catch((e) => setCatErr(e.message))
  }, [catalog, tenant])
  useEffect(() => { loadRuns(); const t = setInterval(loadRuns, 10000); return () => clearInterval(t) }, [loadRuns])

  const run = async (entities, label) => {
    setBusy(label); setMsg(null)
    try {
      const missing = (entities || []).filter((n) => !(tables || []).some((t) => t.name === n))
      if (missing.length) {   // a table picked from "All D365 tables": add it to this tenant's list first
        const body = [...(tables || []).map((t) => ({ name: t.name, table: t.table, mode: t.mode, date_field: t.date_field, enabled: t.enabled })),
          ...missing.map((name) => ({ name, mode: 'full', enabled: true }))]
        await admin(`tenants/${tenant}/entities`, { method: 'PUT', body })
        loadTables()
      }
      const { job_id } = await admin(`tenants/${tenant}/sync`, { method: 'POST', body: { entities, full_reload: full } })
      setRunningJob(job_id); setOpenJob(job_id); loadRuns()
      setMsg({ text: `ETL started for ${entities ? entities.join(', ') : 'all D365 tables'} (job #${job_id}).` })
    } catch (e) { setMsg({ bad: true, text: e.message }) }
    setBusy('')
  }
  const rebuild = async () => {
    setBusy('rebuild'); setMsg(null)
    try {
      const r = await admin(`tenants/${tenant}/refresh-reporting`, { method: 'POST', timeoutMs: 600000 })
      setMsg({ bad: !r.ok, text: r.message }); window.dispatchEvent(new Event('companies-changed'))
    } catch (e) { setMsg({ bad: true, text: e.message }) }
    setBusy('')
  }
  const onJobFinished = () => { setRunningJob(null); loadTables(); loadRuns(); window.dispatchEvent(new Event('companies-changed')) }

  const byName = new Map((tables || []).map((t) => [t.name, t]))
  // one list of every D365 table: the most recently run first, then the others already loaded, then the rest of the catalogue
  const known = (tables || []).filter((t) => t.rows != null || t.last_status)
    .sort((a, b) => (b.last_job || 0) - (a.last_job || 0) || String(b.last_run || '').localeCompare(String(a.last_run || '')))
  const knownNames = new Set(known.map((t) => t.name))
  const source = [...known, ...(catalog || []).filter((c) => !knownNames.has(c.name))
    .map((c) => byName.get(c.name) || { name: c.name, table: snake(c.name), mode: 'full' })]
  const ql = q.toLowerCase()
  const shown = source.filter((t) => t.name.toLowerCase().includes(ql) || t.table.includes(ql))
  const { pageRows, page: curPage, pages } = paginate(shown, page, size)
  const toggle = (name) => setChecked((c) => { const n = new Set(c); n.has(name) ? n.delete(name) : n.add(name); return n })
  const pageAllChecked = pageRows.length > 0 && pageRows.every((t) => checked.has(t.name))
  const togglePage = () => setChecked((c) => {
    const n = new Set(c)
    pageRows.forEach((t) => (pageAllChecked ? n.delete(t.name) : n.add(t.name)))
    return n
  })
  const checkedList = [...checked]
  const locked = !!runningJob || !!busy
  const lockWhy = runningJob ? `Job #${runningJob} is running - wait until it finishes` : busy ? 'Please wait…' : ''

  return (
    <div className="page">
      <div className="hero">
        <div><h1>Jobs</h1><p>Run ETL for a tenant's D365 tables, follow progress, and see every run.</p></div>
        <div className="filters">
          <TenantFilter value={tenant} required onChange={setTenant} onLoaded={(list) => {
            tenantRow.current = list
            if (!tenant || !list.some((t) => t.tenant_key === tenant)) setTenant(list[0]?.tenant_key ?? null)
          }} />
        </div>
      </div>

      {!tenant && <div className="card muted">Add a tenant first under ETL › Tenants.</div>}
      {msg && <div className={`alert ${msg.bad ? 'bad' : 'good'}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

      {openJob && (
        <JobDetail key={openJob} id={openJob} onClose={runningJob === openJob ? null : () => setOpenJob(null)}
                   onRetry={(names) => run(names, 'retry')} onFinished={onJobFinished} />
      )}

      {tenant && (
        <section className="card stack" style={{ marginTop: openJob ? 16 : 0 }}>
          <div className="row">
            <h2>D365 Tables {catalog && <span className="muted small">· {catalog.length.toLocaleString()} in this environment</span>}</h2>
            <button onClick={rebuild} disabled={locked}
                    title={lockWhy || 'Rebuild the dashboard tables from data already in SQL (no download)'}>
              {busy === 'rebuild' ? 'Rebuilding…' : 'Rebuild reports'}
            </button>
          </div>
          <div className="row">
            <input className="grow" placeholder="Search D365 tables…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
            <label className="check">
              <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} disabled={locked} />
              Full reload (all history, not only recent changes)
            </label>
          </div>

          {checked.size > 0 && (
            <div className="bulkbar" role="toolbar" aria-label="Ticked D365 tables">
              <button className="primary" onClick={() => run(checkedList, 'checked')} disabled={locked} title={lockWhy || undefined}>
                {busy === 'checked' ? 'Starting…' : `Run ETL (${checked.size})`}
              </button>
              <button onClick={() => setChecked(new Set())}>Clear</button>
            </div>
          )}

          <div className="table-wrap paged" style={{ minHeight: pages > 1 ? 41 + size * 44 : undefined }}>
            <table>
              <thead>
                <tr><th className="chk"><input type="checkbox" checked={pageAllChecked} onChange={togglePage}
                                              aria-label="Tick all tables on this page" title="Tick all tables on this page" /></th>
                  <th>D365 Table</th><th>SQL table</th><th>Load</th><th className="num">Rows in SQL</th>
                  <th>Last run</th><th>Result</th><th></th></tr>
              </thead>
              <tbody>
                {pageRows.map((t) => (
                  <tr key={t.name} className={checked.has(t.name) ? 'picked' : ''}>
                    <td className="chk"><input type="checkbox" checked={checked.has(t.name)} onChange={() => toggle(t.name)}
                                               aria-label={`Tick ${t.name}`} /></td>
                    <td><strong>{t.name}</strong></td>
                    <td className="small muted">stg.{t.table}</td>
                    <td><span className={`tag ${t.mode}`} title={t.date_field || ''}>{t.mode === 'incremental' ? `incr. ${t.date_field}` : 'full'}</span></td>
                    <td className="num">{t.rows == null ? '–' : fmt(t.rows)}</td>
                    <td className="small">{fmtTime(t.last_run)}</td>
                    <td className="wrap small" title={t.last_status ? explainRun(t.last_status, t.last_message) : 'This table has not been loaded yet'}>
                      {t.last_status ? <span className={pill(t.last_status)}><Status s={t.last_status} /></span> : <span className="muted">never</span>}
                      {t.last_status === 'FAILED' && <span className="down"> {shortMsg(t.last_message)}</span>}
                    </td>
                    <td className="act">
                      <button className="run-btn" onClick={() => run([t.name], t.name)} disabled={locked}
                              title={lockWhy || `Run ETL for ${t.name} only`}>
                        {busy === t.name ? 'Starting…' : 'Run ETL'}
                      </button>
                    </td>
                  </tr>
                ))}
                {!catalog && !catErr && tables && (
                  <tr><td colSpan={8} className="muted">Reading the list of all D365 tables (about a minute the first time)…</td></tr>
                )}
                {catErr && <tr><td colSpan={8} className="down">{catErr}</td></tr>}
                {!tables && <tr><td colSpan={8} className="muted">Loading…</td></tr>}
              </tbody>
            </table>
          </div>
          <Pager total={shown.length} page={curPage} pages={pages} size={size}
                 onPage={setPage} onSize={(n) => { setSize(n); setPage(1) }} />
          {runningJob && <p className="muted small" style={{ margin: 0 }}>Run ETL buttons unlock when job #{runningJob} finishes.</p>}
        </section>
      )}

      {tenant && (
        <section className="card" style={{ marginTop: 16 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <h2>ETL runs</h2>
            <label>Status
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All</option><option>Running</option><option>OK</option><option>Partial</option><option>Failed</option>
              </select>
            </label>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>#</th><th>Status</th><th>Started</th><th className="num">Duration</th>
                  <th className="num">OK</th><th className="num">Failed</th><th className="num">Rows</th><th>Trigger</th><th>Message</th></tr>
              </thead>
              <tbody>
                {runs?.map((j) => (
                  <tr key={j.job_id} className={`clickable ${openJob === j.job_id ? 'picked' : ''}`} onClick={() => setOpenJob(j.job_id)}>
                    <td>{j.job_id}</td>
                    <td><span className={pill(j.status)}><Status s={j.status} /></span></td>
                    <td className="small">{fmtTime(j.started_at)}</td>
                    <td className="num">{fmtDuration(j.seconds)}</td>
                    <td className="num">{fmt(j.ok_entities)}</td>
                    <td className={`num ${j.failed_entities ? 'down' : ''}`}>{fmt(j.failed_entities)}</td>
                    <td className="num">{fmt(j.rows_loaded)}</td>
                    <td className="small">{j.requested_by === 'scheduler' ? 'Scheduled' : 'Manual'}{j.full_reload ? ' · full' : ''}</td>
                    <td className="wrap small muted" title={j.message || ''}>{shortMsg(j.message)}</td>
                  </tr>
                ))}
                {runs && !runs.length && <tr><td colSpan={9} className="muted">No runs yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

    </div>
  )
}
