import { useEffect, useState } from 'react'
import { admin, fmt, fmtTime } from '../../api'
import { MotionCard, motion, rowMotion, useReducedMotion } from '../../components/motion'
import { Hero3D } from '../../components/three'
import { useApp } from '../../theme'

const PILL = { OK: 'ok', Differences: 'bad', Failed: 'bad', Running: 'run', Diff: 'bad', Info: '', Error: 'bad' }
const n = (v) => (v == null ? '–' : fmt(v))

export default function Reconciliation() {
  const { scope } = useApp()
  const tenant = scope?.tenant
  const [d, setD] = useState(null)
  const [sel, setSel] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const reduce = useReducedMotion()

  const load = () => admin('recon', { params: { tenant } }).then((r) => {
    setD(r)
    if (r.runs.length && !sel) admin(`recon/${r.runs[0].run_id}`).then(setSel).catch((e) => setErr(e.message))
  }).catch((e) => setErr(e.message))
  useEffect(() => { if (tenant) { setSel(null); load() } }, [tenant]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    setBusy(true); setErr('')
    try { setSel(await admin('recon/run', { method: 'POST', body: { tenant_key: tenant }, timeoutMs: 300000 })); load() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="page">
      <header className="hero hero-3d">
        <Hero3D />
        <div><h1>Reconciliation</h1><p>D365 → staging → reporting: line counts, journal headers, trial balance and accounts - every night{d ? ` at ${String(d.recon_hour).padStart(2, '0')}:00` : ''} and on demand</p></div>
        <div className="row tight"><button className="hero-cta" onClick={run} disabled={busy || !tenant}>{busy ? 'Reconciling…' : 'Run now'}</button></div>
      </header>
      {err && <div className="alert bad">{err}</div>}
      {!tenant && <div className="alert">Pick a company in the top bar (its tenant is reconciled).</div>}
      {d && <div className="recon-layout">
        <MotionCard as="aside" hover={false} className="card recon-runs">
          <h2>Runs</h2>
          {!d.runs.length && <p className="muted small">No run yet - click Run now.</p>}
          {d.runs.map((r) => (
            <button key={r.run_id} className={`recon-run ${sel?.run.run_id === r.run_id ? 'on' : ''}`} onClick={() => admin(`recon/${r.run_id}`).then(setSel).catch((e) => setErr(e.message))}>
              <span><span className={`pill ${PILL[r.status]}`}>{r.status}</span> #{r.run_id}</span>
              <small className="muted">{fmtTime(r.started_at)} · {r.triggered_by}</small>
            </button>
          ))}
        </MotionCard>
        <div>
          {sel && <MotionCard as="section" hover={false} className="card">
            <div className="row"><h2 className="grow">Run #{sel.run.run_id} <span className={`pill ${PILL[sel.run.status]}`}>{sel.run.status}</span></h2>
              <span className="muted small">{fmtTime(sel.run.started_at)} · by {sel.run.triggered_by}</span></div>
            <p className={sel.run.status === 'OK' ? 'up' : 'down'}>{sel.run.summary}</p>
            <div className="table-wrap"><table>
              <thead><tr><th>Check</th><th>Company</th><th className="num">D365</th><th className="num">Staging</th><th className="num">Reporting</th><th className="num">Difference</th><th>Status</th></tr></thead>
              <tbody>{sel.lines.map((l, i) => (
                <motion.tr key={l.id} {...rowMotion(i, reduce)}>
                  <td><b>{l.check_name}</b>{l.note && <div className="muted small">{l.note}</div>}</td><td data-no-tr>{(l.company || '').toUpperCase()}</td>
                  <td className="num">{n(l.d365)}</td><td className="num">{n(l.staging)}</td><td className="num">{n(l.reporting)}</td>
                  <td className={`num ${l.status === 'Diff' ? 'down' : ''}`}>{n(l.difference)}</td><td><span className={`pill ${PILL[l.status]}`}>{l.status}</span></td>
                </motion.tr>))}</tbody>
            </table></div>
            <p className="muted small">D365 counts are read live through OData ($count). A difference right after new postings in D365 is normal until the next ETL run.
              Differences also raise an alert (Administration › Alerts).</p>
          </MotionCard>}
        </div>
      </div>}
    </div>
  )
}
