import { useEffect, useState } from 'react'
import { admin, fmt, fmtTime } from '../api'
import { MotionCard, motion, rowMotion, useReducedMotion } from '../components/motion'
import { Hero3D } from '../components/three'
import { Tile } from './dash/common'

const LABEL = { ok: 'Healthy', warn: 'Needs attention', bad: 'Problem' }
const dot = (s) => <span className={`dot dot-${s}`} aria-label={LABEL[s]} />

function Gauge({ pct, label }) {
  const v = Math.max(0, Math.min(100, pct || 0))
  const tone = v < 70 ? 'ok' : v < 90 ? 'warn' : 'bad'
  return (
    <div className="gauge" title={`${v.toFixed(0)}%`}>
      <div className="gauge-track"><motion.div className={`gauge-fill g-${tone}`} initial={{ width: 0 }} animate={{ width: `${v}%` }}
                                               transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} /></div>
      <span className="small muted">{label}</span>
    </div>
  )
}

export default function Health() {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [auto, setAuto] = useState(true)
  const [busy, setBusy] = useState(false)
  const reduce = useReducedMotion()

  const load = () => {
    setBusy(true)
    admin('health', { timeoutMs: 60000 }).then((r) => { setD(r); setErr('') }).catch((e) => setErr(e.message)).finally(() => setBusy(false))
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!auto) return undefined
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [auto])

  const areas = d ? [...new Set(d.checks.map((c) => c.area))] : []
  const n = (s) => d?.checks.filter((c) => c.status === s).length || 0
  const up = d?.api.uptime_sec || 0

  return (
    <div className="page">
      <header className="hero hero-3d">
        <Hero3D />
        <div>
          <h1>System Health</h1>
          <p>{d ? `Checked ${fmtTime(d.checked_at)} · ${d.checks.length} checks` : 'API, database, security, ETL and data checks'}</p>
        </div>
        <div className="row tight">
          <label className="check light"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Every 30 s</label>
          <button onClick={load} disabled={busy}>{busy ? 'Checking…' : 'Check now'}</button>
        </div>
      </header>
      {err && <div className="alert bad">{err}</div>}
      {!d && !err && <div className="card muted">Running checks…</div>}
      {d && <>
        <motion.div className={`health-banner hb-${d.status}`} initial={reduce ? false : { opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
          {dot(d.status)} <b>{LABEL[d.status]}</b>
          <span>{n('ok')} healthy · {n('warn')} need attention · {n('bad')} problem(s)</span>
        </motion.div>

        <div className="tiles">
          <Tile label="Database response" value={d.db.online ? `${d.db.ping_ms} ms` : 'Offline'} tone={d.db.online ? 'up' : 'down'}
                sub={d.db.server ? `${d.db.server} · SQL ${d.db.version}` : ''} />
          <Tile label="Database size" value={`${fmt(d.db.data_mb)} MB`}
                sub={d.db.express_pct != null ? <Gauge pct={d.db.express_pct} label={`${d.db.express_pct}% of the 10 GB Express limit`} /> : d.db.edition} />
          <Tile label="Transaction log" value={`${fmt(d.db.log_mb)} MB`} sub={`recovery ${d.db.recovery || '–'}`} />
          <Tile label="API uptime" value={`${Math.floor(up / 3600)} h ${Math.floor((up % 3600) / 60)} m`} sub={`version ${d.api.version} · Python ${d.api.python}`} />
          <Tile label="API errors (24 h)" value={String(d.errors.length)} tone={d.errors.length ? 'down' : 'up'} sub="from api\logs\api.log" />
          <Tile label="Active users" value={String(d.users.active ?? 0)} sub={`${d.users.admins ?? 0} admin · ${d.users.failed_logins_24h ?? 0} failed sign-ins (24 h)`} />
        </div>

        <div className="health-grid">
          {areas.map((a) => (
            <MotionCard key={a} as="section" className="card health-card">
              <h2>{a}</h2>
              <ul className="checks">
                {d.checks.filter((c) => c.area === a).map((c, i) => (
                  <motion.li key={c.name} className={`check-${c.status}`} {...rowMotion(i, reduce)}>
                    {dot(c.status)}<div><b>{c.name}</b><span className="muted small">{c.detail}</span></div>
                  </motion.li>
                ))}
              </ul>
            </MotionCard>
          ))}
        </div>

        <div className="grid-2">
          <MotionCard as="section" hover={false} className="card">
            <h2>Tenants and data freshness</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Tenant</th><th>Last ETL</th><th>Last posting</th><th className="num">Ledger lines</th><th>Dashboard data</th></tr></thead>
                <tbody>{d.tenants.map((t) => (
                  <tr key={t.tenant_key}>
                    <td><b>{t.name}</b>{!t.is_active && <span className="muted small"> · paused</span>}</td>
                    <td className="small">{t.last_sync_status && <span className={`pill ${t.last_sync_status === 'OK' ? 'ok' : t.last_sync_status === 'Failed' ? 'bad' : 'warn'}`}>{t.last_sync_status}</span>} {fmtTime(t.last_sync_at)}</td>
                    <td className="small">{t.last_posting?.slice(0, 10) || '–'}</td>
                    <td className="num">{fmt(t.fact_rows)}</td>
                    <td className="small">{t.report_msg === 'Dashboard data refreshed.' ? <span className="pill ok">built {fmtTime(t.report_at)}</span>
                      : <span className="pill warn">{t.report_msg || 'never built'}</span>}</td>
                  </tr>))}
                </tbody>
              </table>
            </div>
          </MotionCard>
          <MotionCard as="section" hover={false} className="card">
            <h2>Largest tables</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Table</th><th className="num">Rows</th><th className="num">MB</th><th /></tr></thead>
                <tbody>{d.tables.map((t) => {
                  const max = Math.max(...d.tables.map((x) => Number(x.mb) || 0), 1)
                  return (
                    <tr key={t.table}>
                      <td data-no-tr>{t.table}</td><td className="num">{fmt(t.rows)}</td><td className="num">{fmt(Number(t.mb))}</td>
                      <td style={{ width: 120 }}><div className="bar-mini"><motion.span initial={{ width: 0 }} animate={{ width: `${(Number(t.mb) / max) * 100}%` }} transition={{ duration: 0.8 }} /></div></td>
                    </tr>)
                })}</tbody>
              </table>
            </div>
          </MotionCard>
        </div>

        <MotionCard as="section" hover={false} className="card">
          <h2>Recent API errors</h2>
          {d.errors.length ? (
            <ul className="error-list">{d.errors.map((e, i) => <li key={i}><span className="small muted">{e.at}</span> <code data-no-tr>{e.message}</code></li>)}</ul>
          ) : <p className="muted">No errors in the last 24 hours.</p>}
        </MotionCard>
      </>}
    </div>
  )
}
