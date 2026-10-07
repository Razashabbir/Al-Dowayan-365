import { useEffect, useState } from 'react'
import { MONTHS, admin, api, fmtTime } from '../../api'
import { useAuth } from '../../auth'
import { MotionCard, motion, useReducedMotion } from '../../components/motion'
import Modal from '../../components/Modal'
import { IconPadlock } from '../../components/Icons'
import { DashFrame, useDashScope } from '../dash/common'

function TasksEditor({ onClose }) {
  const [items, setItems] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { admin('close/tasks').then((t) => setItems(t.filter((x) => x.is_active))).catch((e) => setErr(e.message)) }, [])
  const set = (i, k, v) => setItems((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  const save = async () => {
    try { await admin('close/tasks', { method: 'PUT', body: items.map((x, i) => ({ ...x, sort: (i + 1) * 10, is_active: true })) }); onClose(true) } catch (e) { setErr(e.message) }
  }
  return (
    <Modal wide title="Month-end checklist" onClose={() => onClose(false)}>
      {!items && <p className="muted">Loading…</p>}
      {items && (
        <div className="stack tight-stack">
          {items.map((x, i) => (
            <div key={x.task_id || `n${i}`} className="row tight cl-edit">
              <input value={x.area} maxLength={60} onChange={(e) => set(i, 'area', e.target.value)} placeholder="Area" />
              <input className="grow" value={x.title} maxLength={200} onChange={(e) => set(i, 'title', e.target.value)} placeholder="Task" />
              <button onClick={() => setItems((l) => l.filter((_, j) => j !== i))} aria-label="Remove">×</button>
            </div>
          ))}
          <div className="row tight">
            <button onClick={() => setItems((l) => [...l, { area: 'Other', title: '' }])}>+ Task</button>
            <span className="grow" />
            <button className="primary" onClick={save} disabled={items.some((x) => !x.title.trim() || !x.area.trim())}>Save checklist</button>
          </div>
        </div>
      )}
      {err && <div className="alert bad">{err}</div>}
    </Modal>
  )
}

export default function PeriodClose() {
  const scope = useDashScope()
  const { tenant, company, year, ready, setError } = scope
  const { can } = useAuth()
  const manage = can('close.manage')
  const [d, setD] = useState(null)
  const [sel, setSel] = useState(null)
  const [cl, setCl] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState(false)
  const [msg, setMsg] = useState('')
  const reduce = useReducedMotion()

  const load = () => admin('close', { params: { tenant, company, year } }).then(setD).catch((e) => setError(e.message))
  const loadCl = (m) => { setCl(null); admin('close/checklist', { params: { tenant, company, year, month: m }, timeoutMs: 90000 }).then(setCl).catch((e) => setError(e.message)) }
  useEffect(() => { if (ready) { load(); setSel(null) } }, [tenant, company, year]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sel) loadCl(sel) }, [sel]) // eslint-disable-line react-hooks/exhaustive-deps

  const tick = async (t, done) => {
    try { await admin('close/task', { method: 'POST', body: { tenant_key: tenant, company, year, month: sel, task_id: t.task_id, done } }); loadCl(sel); load() } catch (e) { setError(e.message) }
  }
  const act = async (what, all) => {
    setBusy(true); setMsg('')
    try {
      const companies = all ? (await api('companies-all')).filter((c) => c.tenant_key === tenant).map((c) => c.company) : [company]
      await admin(`close/${what}`, { method: 'POST', body: { tenant_key: tenant, companies, year, month: sel, note } })
      setMsg(what === 'lock' ? `${MONTHS[sel - 1]} ${year} is closed - adjustments dated in it are now refused.` : `${MONTHS[sel - 1]} ${year} is open again.`)
      setNote(''); load(); loadCl(sel)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const cur = d?.months.find((m) => m.month === sel)
  const allDone = cl && cl.tasks.every((t) => t.done_by)

  return (
    <DashFrame title="Period Close" subtitle="Month-end checklist and locking closed months against new adjustments" scope={scope} loading={!d}
               extra={manage && <button onClick={() => setEdit(true)}>Edit checklist</button>}>
      {edit && <TasksEditor onClose={(changed) => { setEdit(false); if (changed) { load(); if (sel) loadCl(sel) } }} />}
      {d && <>
        <div className="close-grid">
          {d.months.map((m, i) => {
            const pct = m.tasks_total ? Math.round((m.tasks_done / m.tasks_total) * 100) : 0
            return (
              <motion.button key={m.month} className={`close-month ${m.status === 'Closed' ? 'closed' : ''} ${sel === m.month ? 'on' : ''}`} onClick={() => setSel(m.month)}
                             initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                <span className="cm-head"><b>{m.label}</b>{m.status === 'Closed' ? <span className="cm-lock"><IconPadlock /></span> : <span className="pill">Open</span>}</span>
                <span className="cm-bar"><motion.span initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8 }} /></span>
                <span className="small muted">{m.tasks_done}/{m.tasks_total} tasks{m.status === 'Closed' && m.closed_by ? ` · ${m.closed_by}` : ''}</span>
              </motion.button>
            )
          })}
        </div>
        {!sel && <p className="muted">Choose a month to see its checklist and close it.</p>}
        {sel && (
          <MotionCard as="section" hover={false} className="card">
            <div className="row">
              <h2 className="grow">{MONTHS[sel - 1]} {year} · {company?.toUpperCase()} {cur?.status === 'Closed' ? <span className="pill bad">Closed</span> : <span className="pill ok">Open</span>}</h2>
              {cur?.status === 'Closed' && <span className="muted small">closed by {cur.closed_by} · {fmtTime(cur.closed_at)}{cur.note ? ` · ${cur.note}` : ''}</span>}
            </div>
            {msg && <div className="alert good">{msg}</div>}
            {!cl && <p className="muted">Loading checklist and checks…</p>}
            {cl && <div className="grid-2">
              <div>
                <h3>Checklist</h3>
                <ul className="cl-list">
                  {cl.tasks.map((t) => (
                    <li key={t.task_id} className={t.done_by ? 'done' : ''}>
                      <label className="check"><input type="checkbox" checked={!!t.done_by} disabled={!manage || cur?.status === 'Closed'} onChange={(e) => tick(t, e.target.checked)} />
                        <span><span className="muted small">{t.area}</span> {t.title}</span></label>
                      {t.done_by && <span className="muted small">{t.done_by} · {fmtTime(t.done_at)}</span>}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Automatic checks</h3>
                <ul className="checks">
                  {cl.checks.map((c) => <li key={c.name}><span className={`dot dot-${c.ok ? 'ok' : 'warn'}`} /> <b>{c.name}</b> <span className="muted small">{c.detail}</span></li>)}
                </ul>
                {manage && (
                  <div className="stack tight-stack close-actions">
                    <label>Note<input value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} placeholder="optional" /></label>
                    {cur?.status === 'Closed' ? (
                      <div className="row tight">
                        <button disabled={busy} onClick={() => act('reopen', false)}>Reopen {company?.toUpperCase()}</button>
                        <button disabled={busy} onClick={() => act('reopen', true)}>Reopen all companies</button>
                      </div>
                    ) : (
                      <div className="row tight">
                        <button className="primary" disabled={busy} onClick={() => act('lock', false)}>Close &amp; lock {company?.toUpperCase()}</button>
                        <button disabled={busy} onClick={() => act('lock', true)}>Close all companies</button>
                        {!allDone && <span className="muted small">Not every checklist task is ticked.</span>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>}
          </MotionCard>
        )}
      </>}
    </DashFrame>
  )
}
