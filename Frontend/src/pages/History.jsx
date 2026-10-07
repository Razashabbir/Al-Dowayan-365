import { useEffect, useState } from 'react'
import { admin, fmt, fmtTime, shortMsg } from '../api'
import { TenantFilter } from './Jobs'

const PAGE = 100
const pill = (s) => ({ OK: 'pill ok', FAILED: 'pill bad', Running: 'pill run' }[s] || 'pill')

export default function History() {
  const [tenant, setTenant] = useState(null)
  const [status, setStatus] = useState('')
  const [entity, setEntity] = useState('')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => { const t = setTimeout(() => { setQuery(entity); setOffset(0) }, 350); return () => clearTimeout(t) }, [entity])
  useEffect(() => { setOffset(0) }, [tenant, status])
  useEffect(() => {
    admin('history', { params: { tenant, status, entity: query, limit: PAGE, offset } })
      .then(setData).catch((e) => setError(e.message))
  }, [tenant, status, query, offset])

  return (
    <div className="page">
      <div className="hero">
        <div><h1>History</h1><p>Every D365 table load, newest first — with row counts, timings and error messages.</p></div>
        <div className="filters">
          <TenantFilter value={tenant} onChange={setTenant} />
          <label>Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option><option>OK</option><option>FAILED</option><option>Running</option>
            </select>
          </label>
        </div>
      </div>
      {error && <div className="alert bad">{error}</div>}

      <section className="card stack">
        <div className="row">
          <input className="grow" placeholder="Filter by D365 table…" value={entity} onChange={(e) => setEntity(e.target.value)} />
          {data && (
            <div className="row tight">
              <span className="muted small">{fmt(data.total)} loads · {offset + 1}–{Math.min(offset + PAGE, data.total)}</span>
              <button onClick={() => setOffset(Math.max(0, offset - PAGE))} disabled={!offset}>‹ Newer</button>
              <button onClick={() => setOffset(offset + PAGE)} disabled={offset + PAGE >= data.total}>Older ›</button>
            </div>
          )}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Job</th><th>Tenant</th><th>D365 Table</th><th>Status</th>
              <th className="num">Rows</th><th className="num">Seconds</th><th>Details</th></tr></thead>
            <tbody>
              {data?.items.map((r) => (
                <tr key={r.id}>
                  <td className="small">{fmtTime(r.run_at)}</td><td>#{r.job_id}</td><td className="small">{r.tenant}</td>
                  <td>{r.entity}</td><td><span className={pill(r.status)}>{r.status}</span></td>
                  <td className="num">{fmt(r.rows_loaded)}</td><td className="num">{r.duration_sec ?? ''}</td>
                  <td className="wrap small" title={r.message || ''}>{shortMsg(r.message)}</td>
                </tr>
              ))}
              {data && !data.items.length && <tr><td colSpan={8} className="muted">Nothing found.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
