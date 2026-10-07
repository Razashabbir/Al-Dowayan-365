import { useEffect, useState } from 'react'
import { admin, fmtTime } from '../api'
import { useAuth } from '../auth'
import { MotionCard, motion, useReducedMotion } from '../components/motion'
import { Hero3D } from '../components/three'
import { Tile } from './dash/common'

const KIND = { etl_failed: 'ETL failed', etl_stale: 'ETL not run', tb_unbalanced: 'Trial balance', bs_unbalanced: 'Financial position',
  expense_spike: 'Expense spike', recon: 'Reconciliation', pack_failed: 'Report pack' }
const SEV = { bad: 'Problem', warn: 'Warning', info: 'Info' }

function SettingsCard({ s, onSaved }) {
  const [v, setV] = useState({ alerts_spike_pct: s.alerts_spike_pct, alerts_spike_min: s.alerts_spike_min, alerts_stale_days: s.alerts_stale_days, recon_hour: s.recon_hour, ic_tolerance: s.ic_tolerance })
  const [err, setErr] = useState('')
  const save = async () => {
    try { await admin('alerts/settings', { method: 'PUT', body: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)])) }); onSaved() } catch (e) { setErr(e.message) }
  }
  const f = (k, label, extra = {}) => <label>{label}<input type="number" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} {...extra} /></label>
  return (
    <MotionCard as="section" hover={false} className="card">
      <h2>Rules</h2>
      <div className="form-grid">
        {f('alerts_spike_pct', 'Expense spike: % above the 3-month average', { min: 5 })}
        {f('alerts_spike_min', 'Expense spike: minimum amount', { min: 0 })}
        {f('alerts_stale_days', 'Warn when no successful ETL for (days)', { min: 1 })}
        {f('recon_hour', 'Nightly reconciliation hour (0-23, server time)', { min: 0, max: 23 })}
        {f('ic_tolerance', 'Intercompany matching tolerance', { min: 0, step: 0.01 })}
      </div>
      {err && <div className="alert bad">{err}</div>}
      <button className="primary" onClick={save}>Save rules</button>
    </MotionCard>
  )
}

export default function Alerts({ go }) {
  const { can } = useAuth()
  const [d, setD] = useState(null)
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const reduce = useReducedMotion()
  const load = () => admin('alerts', { params: { status: all ? 'all' : 'active' } }).then(setD).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [all]) // eslint-disable-line react-hooks/exhaustive-deps
  const run = async () => {
    setBusy(true); setErr('')
    try { await admin('alerts/run', { method: 'POST', timeoutMs: 300000 }); await load(); window.dispatchEvent(new Event('alerts-changed')) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const ack = async (a) => { await admin(`alerts/${a.alert_id}/ack`, { method: 'POST' }).catch((e) => setErr(e.message)); load(); window.dispatchEvent(new Event('alerts-changed')) }

  return (
    <div className="page">
      <header className="hero hero-3d">
        <Hero3D />
        <div><h1>Alerts</h1><p>Warnings when an ETL run fails, the books do not balance, an expense spikes or the reconciliation finds differences - checked every hour</p></div>
        <div className="row tight">
          <label className="check light"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show resolved</label>
          <button className="hero-cta" onClick={run} disabled={busy}>{busy ? 'Checking…' : 'Check now'}</button>
        </div>
      </header>
      {err && <div className="alert bad">{err}</div>}
      {!d && !err && <div className="card muted">Loading…</div>}
      {d && <>
        <div className="tiles">
          <Tile label="Open alerts" value={String(d.open)} tone={d.open ? 'down' : 'up'} />
          <Tile label="Problems" value={String(d.bad)} tone={d.bad ? 'down' : 'up'} sub="ETL failed or books out of balance" />
          <Tile label="Acknowledged" value={String(d.alerts.filter((a) => a.status === 'Acknowledged').length)} sub="still detected, someone is on it" />
        </div>
        <div className="alert-list">
          {!d.alerts.length && <div className="card empty"><h2>All clear</h2><p className="muted">No open alerts.</p></div>}
          {d.alerts.map((a, i) => (
            <motion.article key={a.alert_id} className={`card alert-card sev-${a.severity} st-${a.status.toLowerCase()}`}
                            initial={reduce ? false : { opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 12) * 0.04 }}>
              <span className={`dot dot-${a.severity === 'bad' ? 'bad' : 'warn'}`} />
              <div className="grow">
                <div className="row tight"><b>{a.title}</b><span className="pill">{KIND[a.kind] || a.kind}</span><span className={`pill ${a.severity === 'bad' ? 'bad' : 'warn'}`}>{SEV[a.severity]}</span>
                  {a.status !== 'Open' && <span className="pill ok">{a.status}</span>}</div>
                {a.detail && <p className="muted small">{a.detail}</p>}
                <span className="muted small">first {fmtTime(a.first_at)} · last seen {fmtTime(a.last_at)}{a.ack_by ? ` · acknowledged by ${a.ack_by}` : ''}{a.resolved_at ? ` · resolved ${fmtTime(a.resolved_at)}` : ''}</span>
              </div>
              <div className="stack tight-stack">
                {a.link && <button onClick={() => go(a.link)}>Open</button>}
                {a.status === 'Open' && <button onClick={() => ack(a)}>Acknowledge</button>}
              </div>
            </motion.article>
          ))}
        </div>
        {can('config.manage') && <SettingsCard s={d.settings} onSaved={load} />}
      </>}
    </div>
  )
}
