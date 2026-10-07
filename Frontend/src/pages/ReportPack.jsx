import { useEffect, useState } from 'react'
import { MONTHS, admin, api, download, fmtTime } from '../api'
import { MotionCard } from '../components/motion'
import Modal from '../components/Modal'
import { Hero3D } from '../components/three'

const REPORTS = [['IS', 'Income Statement'], ['BS', 'Financial Position'], ['CF', 'Cash Flow']]
const blank = { name: 'Monthly report pack', enabled: true, tenant_key: null, companies: [], reports: ['IS', 'BS', 'CF'], basis: 'final', day_of_month: 5, send_hour: 8, recipients: '' }

function ScheduleForm({ init, companies, onClose, onSaved }) {
  const [v, setV] = useState(init)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const toggle = (k, x) => setV({ ...v, [k]: v[k].includes(x) ? v[k].filter((y) => y !== x) : [...v[k], x] })
  const save = async () => {
    try {
      await admin('pack/schedules', { method: 'POST', body: { ...v, day_of_month: Number(v.day_of_month), send_hour: Number(v.send_hour) } })
      onSaved()
    } catch (e) { setErr(e.message) }
  }
  const tenants = [...new Map(companies.map((c) => [c.tenant_key, c.tenant])).entries()]
  return (
    <Modal wide title={v.schedule_id ? 'Edit schedule' : 'New schedule'} onClose={onClose}>
      <div className="form-grid">
        <label>Name<input value={v.name} onChange={set('name')} maxLength={100} /></label>
        <label>Tenant<select value={v.tenant_key || ''} onChange={(e) => setV({ ...v, tenant_key: Number(e.target.value), companies: [] })}>
          <option value="">Choose…</option>{tenants.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
        <div className="full"><span className="lbl">Companies</span>
          <div className="row tight">
            <label className="check"><input type="checkbox" checked={v.companies.includes('*')} onChange={() => toggle('companies', '*')} /> All companies combined</label>
            {companies.filter((c) => c.tenant_key === v.tenant_key).map((c) => (
              <label key={c.company} className="check"><input type="checkbox" checked={v.companies.includes(c.company)} onChange={() => toggle('companies', c.company)} /> <span data-no-tr>{c.company.toUpperCase()}</span></label>))}
          </div></div>
        <div className="full"><span className="lbl">Statements</span>
          <div className="row tight">{REPORTS.map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={v.reports.includes(k)} onChange={() => toggle('reports', k)} /> {l}</label>)}</div></div>
        <label>Basis<select value={v.basis} onChange={set('basis')}><option value="final">Final (adjustments + eliminations)</option><option value="adjusted">With adjustments</option><option value="ledger">D365 ledger only</option></select></label>
        <label>Send on day<input type="number" min={1} max={28} value={v.day_of_month} onChange={set('day_of_month')} /></label>
        <label>At hour (server time)<input type="number" min={0} max={23} value={v.send_hour} onChange={set('send_hour')} /></label>
        <label className="check"><input type="checkbox" checked={v.enabled} onChange={set('enabled')} /> Enabled</label>
        <label className="full">Recipients (comma separated)<input value={v.recipients} onChange={set('recipients')} placeholder="cfo@company.com, finance@company.com" /></label>
      </div>
      <p className="muted small">Each month on that day and hour the pack for the previous month is e-mailed as a PDF.</p>
      {err && <div className="alert bad">{err}</div>}
      <button className="primary" onClick={save} disabled={!v.tenant_key || !v.companies.length || !v.reports.length || !v.recipients.trim()}>Save schedule</button>
    </Modal>
  )
}

export default function ReportPack() {
  const [d, setD] = useState(null)
  const [companies, setCompanies] = useState([])
  const [smtp, setSmtp] = useState(null)
  const [form, setForm] = useState(null)
  const [period, setPeriod] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(0)

  const load = () => admin('pack').then((r) => { setD(r); setSmtp(r.smtp); setPeriod((p) => p || r.next_period) }).catch((e) => setErr(e.message))
  useEffect(() => { load(); api('companies-all').then(setCompanies).catch(() => {}) }, [])
  const saveSmtp = async () => { setErr(''); try { await admin('pack/smtp', { method: 'PUT', body: { ...smtp, smtp_port: Number(smtp.smtp_port) } }); setMsg('E-mail settings saved.'); load() } catch (e) { setErr(e.message) } }
  const send = async (s, to) => {
    setBusy(s.schedule_id); setErr(''); setMsg('')
    try { const r = await admin(`pack/schedules/${s.schedule_id}/send`, { method: 'POST', body: { period, to: to || undefined }, timeoutMs: 300000 }); setMsg(`${s.name}: ${r.message}.`) } catch (e) { setErr(e.message) } finally { setBusy(0); load() }
  }
  const del = async (s) => { if (window.confirm(`Delete “${s.name}”?`)) { await admin(`pack/schedules/${s.schedule_id}`, { method: 'DELETE' }).catch((e) => setErr(e.message)); load() } }
  const setS = (k) => (e) => setSmtp({ ...smtp, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const [py, pm] = (period || '').split('-').map(Number)

  return (
    <div className="page">
      <header className="hero hero-3d">
        <Hero3D />
        <div><h1>Report Pack</h1><p>Monthly PDF statements e-mailed automatically - Income Statement, Financial Position and Cash Flow</p></div>
        <div className="row tight">
          <label>Period<input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></label>
          <button className="hero-cta" onClick={() => setForm({ ...blank, tenant_key: companies[0]?.tenant_key || null })}>+ Schedule</button>
        </div>
      </header>
      {form && <ScheduleForm init={form} companies={companies} onClose={() => setForm(null)} onSaved={() => { setForm(null); load() }} />}
      {err && <div className="alert bad">{err}</div>}
      {msg && <div className="alert good">{msg}</div>}
      {d && !d.pdf_ready && <div className="alert">The PDF needs the reportlab package: in the api folder run <code data-no-tr>pip install reportlab</code> and restart uvicorn.</div>}
      {d && <>
        <MotionCard as="section" hover={false} className="card">
          <h2>Schedules</h2>
          {!d.schedules.length && <p className="muted">No schedule yet - add one with + Schedule.</p>}
          <div className="table-wrap"><table>
            <thead><tr><th>Name</th><th>Companies</th><th>Statements</th><th>When</th><th>Recipients</th><th>Last run</th><th /></tr></thead>
            <tbody>{d.schedules.map((s) => (
              <tr key={s.schedule_id}>
                <td><b>{s.name}</b> {!s.enabled && <span className="pill">off</span>}</td>
                <td data-no-tr>{s.companies.split(',').map((c) => (c === '*' ? 'All combined' : c.toUpperCase())).join(', ')}</td>
                <td>{s.reports.split(',').join(', ')} · {s.basis}</td>
                <td>day {s.day_of_month}, {String(s.send_hour).padStart(2, '0')}:00</td>
                <td className="small">{s.recipients}</td>
                <td className="small">{s.last_run_at ? fmtTime(s.last_run_at) : '–'}<div className={s.last_status?.startsWith('OK') ? 'up' : 'down'}>{s.last_status}</div></td>
                <td className="row tight">
                  <button disabled={!!busy} onClick={() => download(`/api/admin/pack/schedules/${s.schedule_id}/preview?period=${period}`, 'pack.pdf', true).catch((e) => setErr(e.message))}>Preview PDF</button>
                  <button disabled={!!busy} onClick={() => send(s)}>{busy === s.schedule_id ? 'Sending…' : `Send ${pm ? MONTHS[pm - 1] : ''} ${py || ''}`}</button>
                  <button onClick={() => setForm({ ...s, companies: s.companies.split(','), reports: s.reports.split(','), enabled: !!s.enabled })}>Edit</button>
                  <button className="linkish" onClick={() => del(s)}>Delete</button>
                </td>
              </tr>))}</tbody>
          </table></div>
        </MotionCard>
        <div className="grid-2">
          {smtp && <MotionCard as="section" hover={false} className="card">
            <h2>E-mail settings</h2>
            <div className="form-grid">
              <label>SMTP server<input value={smtp.smtp_host} onChange={setS('smtp_host')} placeholder="smtp.office365.com" /></label>
              <label>Port<input type="number" value={smtp.smtp_port} onChange={setS('smtp_port')} /></label>
              <label>Sender address<input value={smtp.smtp_from} onChange={setS('smtp_from')} placeholder="reports@company.com" /></label>
              <label>User name<input value={smtp.smtp_user} onChange={setS('smtp_user')} placeholder="usually the sender address" /></label>
              <label className="check"><input type="checkbox" checked={smtp.smtp_tls} onChange={setS('smtp_tls')} /> STARTTLS</label>
            </div>
            <div className={`alert ${smtp.password_set ? 'good' : ''}`}>{smtp.password_set ? 'SMTP password found in api\\.env.'
              : <>Put the SMTP password in <b data-no-tr>api\.env</b> as <code data-no-tr>SMTP_PASSWORD=...</code> and restart uvicorn - it is never stored in the database.</>}</div>
            <button className="primary" onClick={saveSmtp}>Save e-mail settings</button>
          </MotionCard>}
          <MotionCard as="section" hover={false} className="card">
            <h2>Sent</h2>
            <div className="table-wrap" style={{ maxHeight: 360 }}><table>
              <thead><tr><th>When</th><th>Schedule</th><th>Period</th><th>Status</th></tr></thead>
              <tbody>{d.log.map((l) => <tr key={l.id}><td className="small">{fmtTime(l.sent_at)}</td><td>{l.name || '–'}</td><td>{l.period}</td>
                <td><span className={`pill ${l.status === 'OK' ? 'ok' : 'bad'}`}>{l.status}</span> <span className="muted small">{l.message}</span></td></tr>)}
                {!d.log.length && <tr><td colSpan={4} className="muted">Nothing sent yet.</td></tr>}</tbody>
            </table></div>
          </MotionCard>
        </div>
      </>}
    </div>
  )
}
