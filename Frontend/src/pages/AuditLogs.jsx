import { useEffect, useState } from 'react'
import { admin, fmtTime } from '../api'
import Pager from '../components/Pager'
import { MotionCard, motion, rowMotion, useReducedMotion } from '../components/motion'
import { Hero3D } from '../components/three'
import { downloadCsv, Tile } from './dash/common'

const SOURCES = [
  ['all', 'All'], ['Security', 'Security'], ['Activity', 'Report views'], ['Changes', 'Changes'], ['ETL', 'ETL'], ['System', 'System'],
]
const SRC_INFO = {
  Security: 'Sign-ins, failed sign-ins, passwords, users and roles',
  Activity: 'Which dashboard or report each user opened',
  Changes: 'Every change made in the app: ETL runs, rebuilds, tenants, mapping',
  ETL: 'Sync jobs and every D365 table loaded or failed',
  System: 'API start-ups, warnings and errors (api.log)',
}

/** Audit Logs: everything that happened, newest first, with filters. */
export default function AuditLogs() {
  const reduce = useReducedMotion()
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [f, setF] = useState({ source: 'all', q: '', user: '', level: '', days: 7 })
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(50)
  const [auto, setAuto] = useState(false)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(null)

  const params = { ...f, limit: size, offset: (page - 1) * size }
  const load = () => {
    setBusy(true)
    admin('logs', { params, timeoutMs: 60000 }).then((r) => { setD(r); setErr('') }).catch((e) => setErr(e.message)).finally(() => setBusy(false))
  }
  useEffect(() => { const t = setTimeout(load, f.q ? 300 : 0); return () => clearTimeout(t) }, [f, page, size]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!auto) return undefined
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [auto, f, page, size]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setPage(1) }
  const pages = d ? Math.max(1, Math.ceil(d.total / size)) : 1
  const exportCsv = async () => {
    const all = await admin('logs', { params: { ...f, limit: 500, offset: 0 }, timeoutMs: 60000 })
    downloadCsv(`audit_logs_${f.source}_${f.days}d.csv`, ['When (UTC)', 'Source', 'Level', 'User', 'Action', 'Detail', 'IP'],
      all.rows.map((r) => [r.at, r.source, r.level, r.user || '', r.action, r.detail, r.ip || '']))
  }
  const s = d?.stats

  return (
    <div className="page">
      <header className="hero hero-3d">
        <Hero3D />
        <div><h1>Audit Logs</h1><p>Every sign-in, report view, change, ETL run and system event - newest first.</p></div>
        <div className="row tight">
          <label className="check light"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Live (15 s)</label>
          <button onClick={load} disabled={busy}>{busy ? 'Loading…' : 'Refresh'}</button>
        </div>
      </header>
      {err && <div className="alert bad">{err}</div>}

      {s && (
        <div className="tiles">
          <Tile label="Events (24 h)" value={String(s.events_24h)} />
          <Tile label="Sign-ins (24 h)" value={String(s.signins_24h)} />
          <Tile label="Failed sign-ins (24 h)" value={String(s.failed_signins_24h)} tone={s.failed_signins_24h ? 'down' : 'up'} />
          <Tile label="Report views (24 h)" value={String(s.views_24h)} />
          <Tile label={`ETL errors (${d.days} d)`} value={String(s.etl_errors)} tone={s.etl_errors ? 'down' : 'up'} />
          <Tile label={`API errors (${d.days} d)`} value={String(s.api_errors)} tone={s.api_errors ? 'down' : 'up'} />
        </div>
      )}

      <MotionCard as="section" hover={false} className="card stack">
        <div className="seg-wide" role="tablist">
          {SOURCES.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={f.source === k} className={f.source === k ? 'on' : ''} onClick={() => set('source', k)}
                    title={SRC_INFO[k] || 'Everything'}>
              {l}{d && k !== 'all' ? <span className="count">{d.counts[k] || 0}</span> : null}
            </button>
          ))}
        </div>
        {f.source !== 'all' && <p className="muted small" style={{ margin: 0 }}>{SRC_INFO[f.source]}</p>}
        <div className="row">
          <input className="grow" placeholder="Search action, detail, user or IP…" value={f.q} onChange={(e) => set('q', e.target.value)} />
          <select value={f.user} onChange={(e) => set('user', e.target.value)} aria-label="User">
            <option value="">All users</option>{(d?.users || []).map((u) => <option key={u} data-no-tr>{u}</option>)}
          </select>
          <select value={f.level} onChange={(e) => set('level', e.target.value)} aria-label="Level">
            <option value="">All levels</option><option value="info">Info</option><option value="warn">Warning</option><option value="error">Error</option>
          </select>
          <select value={f.days} onChange={(e) => set('days', Number(e.target.value))} aria-label="Period">
            {[1, 7, 30, 90, 365].map((n) => <option key={n} value={n}>{n === 1 ? 'Last 24 hours' : `Last ${n} days`}</option>)}
          </select>
          <button className="export-only" onClick={exportCsv}>Export CSV</button>
        </div>
        <div className="table-wrap paged">
          <table>
            <thead><tr><th>When</th><th>Source</th><th>Level</th><th>User</th><th>Action</th><th>Detail</th><th>IP</th></tr></thead>
            <tbody>
              {!d && !err && <tr><td colSpan={7} className="muted">Loading…</td></tr>}
              {d && !d.rows.length && <tr><td colSpan={7} className="muted">Nothing found for these filters.</td></tr>}
              {d?.rows.map((r, i) => (
                <motion.tr key={`${page}-${i}`} className={`log-${r.level} clickable`} onClick={() => setOpen(open === i ? null : i)} {...rowMotion(i, reduce)}>
                  <td className="small nowrap">{fmtTime(r.at)}</td>
                  <td><span className={`src src-${r.source.toLowerCase()}`}>{r.source === 'Activity' ? 'Report view' : r.source}</span></td>
                  <td><span className={`pill ${r.level === 'error' ? 'bad' : r.level === 'warn' ? 'warn' : 'ok'}`}>{r.level}</span></td>
                  <td data-no-tr>{r.user || '–'}</td>
                  <td className="small" data-no-tr><code>{r.action}</code></td>
                  <td className={`small ${open === i ? 'wrap-all' : 'ellipsis'}`} title={r.detail} data-no-tr>{r.detail}</td>
                  <td className="small muted" data-no-tr>{r.ip || ''}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
        {d && <Pager total={d.total} page={page} pages={pages} size={size} label="events"
                     onPage={setPage} onSize={(n) => { setSize(n); setPage(1) }} />}
      </MotionCard>
    </div>
  )
}
