import { useEffect, useRef, useState } from 'react'
import { admin, fmt, fmtTime } from '../api'
import EntityCatalog from './EntityCatalog'

const pill = (s) => ({ OK: 'pill ok', Partial: 'pill warn', Failed: 'pill bad', FAILED: 'pill bad', Running: 'pill run' }[s] || 'pill')

export default function SyncPanel({ tenant, onFinished }) {
  const k = tenant.tenant_key
  const [entities, setEntities] = useState([])
  const [picked, setPicked] = useState(new Set())
  const [full, setFull] = useState(false)
  const [job, setJob] = useState(null)
  const [jobs, setJobs] = useState([])
  const [tables, setTables] = useState([])
  const [error, setError] = useState('')
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const timer = useRef(null)

  const refresh = () => {
    admin(`tenants/${k}/jobs`, { params: { limit: 8 } }).then((j) => {
      setJobs(j)
      if (j[0]?.status === 'Running' && !timer.current) watch(j[0].job_id) // resume watching after reload
    }).catch(() => {})
    admin(`tenants/${k}/tables`).then(setTables).catch(() => {})
  }

  const loadEntities = () => admin(`tenants/${k}/entities`)
    .then((e) => { const on = e.filter((x) => x.enabled); setEntities(on); setPicked(new Set(on.map((x) => x.name))) })
    .catch((e) => setError(e.message))

  useEffect(() => {
    loadEntities()
    refresh()
    return () => clearInterval(timer.current)
  }, [k]) // eslint-disable-line react-hooks/exhaustive-deps

  const watch = (id) => {
    clearInterval(timer.current)
    const tick = async () => {
      try {
        const j = await admin(`jobs/${id}`)
        setJob(j)
        if (j.status !== 'Running') {
          clearInterval(timer.current); timer.current = null
          refresh(); onFinished?.()
        }
      } catch (e) { setError(e.message) }
    }
    tick()
    timer.current = setInterval(tick, 2000)
  }

  const start = async () => {
    setError('')
    try {
      const all = picked.size === entities.length
      const { job_id } = await admin(`tenants/${k}/sync`, {
        method: 'POST', body: { entities: all ? null : [...picked], full_reload: full },
      })
      watch(job_id)
    } catch (e) { setError(e.message) }
  }

  const [report, setReport] = useState(null)
  const rebuild = async () => {
    setReport({ busy: true })
    try { setReport(await admin(`tenants/${k}/refresh-reporting`, { method: 'POST', timeoutMs: 600000 })) }
    catch (e) { setReport({ ok: false, message: e.message }) }
  }

  const toggle = (n) => { const s = new Set(picked); s.has(n) ? s.delete(n) : s.add(n); setPicked(s) }
  const running = job?.status === 'Running'
  const done = job?.steps?.filter((s) => s.status !== 'Running').length || 0
  const pct = job?.total_entities ? Math.round((done / job.total_entities) * 100) : 0

  return (
    <section className="card stack">
      <div className="row">
        <h2>Get data from D365</h2>
        <div className="row tight">
          <span className="muted small">{entities.length} entities selected</span>
          <button onClick={() => setCatalogOpen(true)} disabled={running}>Choose entities…</button>
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Creates missing SQL tables from the OData metadata, then loads the rows into stg.*. Untick an entity to skip it in this run only.
      </p>

      <div className="entity-grid">
        {(showAll ? entities : entities.slice(0, 12)).map((e) => (
          <label key={e.name} className="check entity">
            <input type="checkbox" checked={picked.has(e.name)} onChange={() => toggle(e.name)} disabled={running} />
            <span><strong>{e.name}</strong><span className="muted small"> → stg.{e.table}</span></span>
            <span className={`tag ${e.mode}`} title={e.date_field || ''}>{e.mode === 'incremental' ? `incr. ${e.date_field}` : 'full'}</span>
          </label>
        ))}
      </div>
      {entities.length > 12 && (
        <div className="row tight">
          <button className="linkish" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show fewer' : `Show all ${entities.length} entities`}
          </button>
          <button className="linkish" onClick={() => setPicked(new Set(entities.map((x) => x.name)))} disabled={running}>Tick all</button>
          <button className="linkish" onClick={() => setPicked(new Set())} disabled={running}>Untick all</button>
          <span className="muted small">{picked.size} ticked for this run</span>
        </div>
      )}

      <div className="row">
        <label className="check">
          <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} disabled={running} />
          Full reload (re-download all history instead of only recent changes)
        </label>
        <div className="row tight">
          <button onClick={rebuild} disabled={running || report?.busy}
                  title="Rebuild the dashboard tables from the data already in SQL (no download from D365)">
            {report?.busy ? 'Rebuilding…' : 'Rebuild reports'}
          </button>
          <button className="primary" onClick={start} disabled={running || !picked.size}>
            {running ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </div>
      {report && !report.busy && <div className={`alert ${report.ok ? 'good' : 'bad'}`}>{report.message}</div>}
      {error && <div className="alert bad">{error}</div>}

      {job && (
        <div className="job">
          <div className="row">
            <span>Job #{job.job_id} <span className={pill(job.status)}>{job.status}</span></span>
            <span className="muted small">{job.message}</span>
          </div>
          {running && <div className="progress"><div style={{ width: `${Math.max(pct, 4)}%` }} /></div>}
          {job.steps?.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Entity</th><th>Status</th><th className="num">Rows</th><th className="num">Seconds</th><th>Details</th></tr></thead>
                <tbody>
                  {job.steps.map((s) => (
                    <tr key={s.entity}>
                      <td>{s.entity}</td>
                      <td><span className={pill(s.status)}>{s.status === 'Running' ? 'Loading…' : s.status}</span></td>
                      <td className="num">{s.status === 'Running' ? (s.rows_loaded ? `${fmt(s.rows_loaded)}…` : '') : fmt(s.rows_loaded)}</td>
                      <td className="num">{s.duration_sec ?? ''}</td>
                      <td className="wrap small">{s.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="two-col">
        <div>
          <h3>Data loaded for this connection</h3>
          {tables.length ? (
            <table>
              <thead><tr><th>Table</th><th className="num">Rows</th><th>Last loaded</th></tr></thead>
              <tbody>{tables.map((t) => (
                <tr key={t.table}><td>{t.table}</td><td className="num">{fmt(t.rows)}</td><td className="small">{fmtTime(t.last_loaded)}</td></tr>
              ))}</tbody>
            </table>
          ) : <p className="muted small">No tables yet — run the first sync.</p>}
        </div>
        <div>
          <h3>Recent syncs</h3>
          {jobs.length ? (
            <table>
              <thead><tr><th>#</th><th>Started</th><th>Status</th><th className="num">Rows</th></tr></thead>
              <tbody>{jobs.map((j) => (
                <tr key={j.job_id} className="clickable" onClick={() => watch(j.job_id)} title={j.message || ''}>
                  <td>{j.job_id}</td><td className="small">{fmtTime(j.started_at)}{j.requested_by === 'scheduler' ? ' · auto' : ''}</td>
                  <td><span className={pill(j.status)}>{j.status}</span></td><td className="num">{fmt(j.rows_loaded)}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <p className="muted small">Never synced.</p>}
        </div>
      </div>
      {catalogOpen && (
        <EntityCatalog tenant={tenant} onClose={() => setCatalogOpen(false)} onSaved={loadEntities} />
      )}
    </section>
  )
}
