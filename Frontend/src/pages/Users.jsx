import { useEffect, useMemo, useState } from 'react'
import { admin, api, fmtTime } from '../api'
import { ROLE_INFO, useAuth } from '../auth'
import Modal from '../components/Modal'
import { MotionCard, motion, rowMotion, useReducedMotion } from '../components/motion'
import { Hero3D } from '../components/three'
import { Tile } from './dash/common'

const ROLES = ['Admin', 'Accountant', 'Finance', 'Viewer']
const blank = { username: '', full_name: '', email: '', role: 'Viewer', password: '', must_change: true,
                all_companies: false, is_active: true, companies: [], all_pages: true, pages: [] }
// which permission a dashboard / report page needs (to grey out pages the chosen role can never open)
const groupPerm = { Dashboards: 'dashboards.view', Reports: 'reports.view', Adjustments: 'adjust.view' }

function newPassword() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz', d = '23456789'
  const pick = (s) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length]
  return Array.from({ length: 8 }, () => pick(a)).join('') + pick(d) + pick(d) + pick(a)
}

function UserForm({ user, companies, pages, matrix, onClose, onSaved }) {
  const isNew = !user.user_id
  const [f, setF] = useState({ ...blank, ...user, password: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const key = (c) => `${c.tenant_key}|${c.company.toLowerCase()}`
  const picked = new Set(f.companies.map(key))
  const toggle = (c) => set('companies', picked.has(key(c)) ? f.companies.filter((x) => key(x) !== key(c))
    : [...f.companies, { tenant_key: c.tenant_key, company: c.company }])
  const tenants = [...new Map(companies.map((c) => [c.tenant_key, c.tenant])).entries()]

  const save = async (e) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      await admin(isNew ? 'users' : `users/${user.user_id}`, { method: isNew ? 'POST' : 'PUT', body: f })
      onSaved(isNew ? `User ${f.username} created.` : `User ${f.username} saved.`)
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  return (
    <Modal title={isNew ? 'New user' : `Edit ${user.username}`} onClose={onClose} wide>
      <form className="stack" onSubmit={save}>
        <div className="form-grid">
          <label>Username<input value={f.username} onChange={(e) => set('username', e.target.value)} autoFocus={isNew} /></label>
          <label>Full name<input value={f.full_name || ''} onChange={(e) => set('full_name', e.target.value)} /></label>
          <label>Email<input type="email" value={f.email || ''} onChange={(e) => set('email', e.target.value)} /></label>
          <label>Role
            <select value={f.role} onChange={(e) => set('role', e.target.value)}>
              {ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
            <span className="muted small">{ROLE_INFO[f.role]}</span>
          </label>
          <label>{isNew ? 'Password' : 'New password (leave empty to keep)'}
            <div className="row tight">
              <input className="grow" value={f.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
              <button type="button" onClick={() => set('password', newPassword())}>Generate</button>
            </div>
            <span className="muted small">At least 8 characters with letters and numbers. Give it to the user safely.</span>
          </label>
          <div className="stack tight">
            <label className="check"><input type="checkbox" checked={f.must_change} onChange={(e) => set('must_change', e.target.checked)} /> Must change password at next sign-in</label>
            <label className="check"><input type="checkbox" checked={f.is_active} onChange={(e) => set('is_active', e.target.checked)} /> Active (can sign in)</label>
          </div>
        </div>
        <fieldset className="company-access">
          <legend>Company access (row-level security)</legend>
          <label className="check"><input type="radio" checked={f.all_companies} onChange={() => set('all_companies', true)} /> All companies, now and in future</label>
          <label className="check"><input type="radio" checked={!f.all_companies} onChange={() => set('all_companies', false)} /> Only these companies:</label>
          {!f.all_companies && tenants.map(([k, name]) => (
            <div key={k} className="company-grid">
              {tenants.length > 1 && <b className="muted small">{name}</b>}
              {companies.filter((c) => c.tenant_key === k).map((c) => (
                <label key={key(c)} className="check company-chip">
                  <input type="checkbox" checked={picked.has(key(c))} onChange={() => toggle(c)} />
                  <b data-no-tr>{c.company.toUpperCase()}</b> <span className="muted small">{c.name}</span>
                </label>
              ))}
            </div>
          ))}
        </fieldset>
        <fieldset className="company-access">
          <legend>Report access</legend>
          <label className="check"><input type="radio" checked={f.all_pages} onChange={() => set('all_pages', true)} /> All dashboards and reports the role allows</label>
          <label className="check"><input type="radio" checked={!f.all_pages} onChange={() => set('all_pages', false)} /> Only these:</label>
          {!f.all_pages && ['Dashboards', 'Reports', 'Adjustments'].map((g) => {
            const roleOk = !matrix || (matrix[f.role] || []).includes(groupPerm[g]) || f.role === 'Admin'
            const list = pages.filter((p) => p.group === g)
            const allOn = list.every((p) => f.pages.includes(p.key))
            return (
              <div key={g} className="page-group">
                <div className="row tight">
                  <b>{g}</b>
                  {!roleOk && <span className="pill warn">role {f.role} has no {g.toLowerCase()}</span>}
                  <button type="button" className="small-btn" disabled={!roleOk}
                          onClick={() => set('pages', allOn ? f.pages.filter((k) => !list.some((p) => p.key === k))
                            : [...new Set([...f.pages, ...list.map((p) => p.key)])])}>{allOn ? 'None' : 'All'}</button>
                </div>
                <div className="company-grid">
                  {list.map((p) => (
                    <label key={p.key} className={`check company-chip ${roleOk ? '' : 'off'}`}>
                      <input type="checkbox" disabled={!roleOk} checked={f.pages.includes(p.key)}
                             onChange={() => set('pages', f.pages.includes(p.key) ? f.pages.filter((k) => k !== p.key) : [...f.pages, p.key])} />
                      {p.label}
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
        </fieldset>
        {err && <div className="alert bad">{err}</div>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !f.username}>{busy ? 'Saving…' : 'Save user'}</button></div>
      </form>
    </Modal>
  )
}

function UsersTab() {
  const { user: me } = useAuth()
  const reduce = useReducedMotion()
  const [rows, setRows] = useState(null)
  const [companies, setCompanies] = useState([])
  const [edit, setEdit] = useState(null)
  const [msg, setMsg] = useState(null)
  const [q, setQ] = useState('')
  const [confirm, setConfirm] = useState(null)

  const norm = (u) => ({ ...u, role: u.role || 'Viewer', companies: Array.isArray(u.companies) ? u.companies : [],
                         pages: Array.isArray(u.pages) ? u.pages : [], all_pages: u.all_pages !== false && u.all_pages !== 0 })
  const load = () => admin('users').then((r) => setRows(Array.isArray(r) ? r.map(norm) : []))
    .catch((e) => setMsg({ bad: true, text: e.message }))
  const [pages, setPages] = useState([])
  const [matrix, setMatrix] = useState(null)
  useEffect(() => {
    load(); api('companies-all').then((r) => setCompanies(Array.isArray(r) ? r : [])).catch(() => {})
    admin('pages').then((r) => setPages(Array.isArray(r) ? r : [])).catch(() => {})
    admin('roles').then((r) => setMatrix(r?.matrix || null)).catch(() => {})
  }, [])

  const shown = useMemo(() => (rows || []).filter((u) => `${u.username} ${u.full_name || ''} ${u.email || ''} ${u.role}`.toLowerCase().includes(q.toLowerCase())), [rows, q])
  const count = (r) => (rows || []).filter((u) => u.role === r && u.is_active).length
  const del = async (u) => {
    try { await admin(`users/${u.user_id}`, { method: 'DELETE' }); setMsg({ text: `User ${u.username} deleted.` }); load() }
    catch (e) { setMsg({ bad: true, text: e.message }) } finally { setConfirm(null) }
  }
  const coName = (c) => String(c.company || '').toUpperCase()

  return (
    <>
      <div className="tiles">{ROLES.map((r) => <Tile key={r} label={{ Admin: 'Admins', Accountant: 'Accountants', Finance: 'Finance users', Viewer: 'Viewers' }[r]} value={String(count(r))} sub={ROLE_INFO[r]} />)}</div>
      {msg && <div className={`alert ${msg.bad ? 'bad' : 'good'}`}>{msg.text}</div>}
      <MotionCard as="section" hover={false} className="card stack">
        <div className="row">
          <input className="grow" placeholder="Search users…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="primary" onClick={() => setEdit({})}>+ New user</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>User</th><th>Role</th><th>Companies (RLS)</th><th>Reports</th><th>Status</th><th>Last sign-in</th><th /></tr></thead>
            <tbody>
              {!rows && <tr><td colSpan={7} className="muted">Loading…</td></tr>}
              {shown.map((u, i) => (
                <motion.tr key={u.user_id} {...rowMotion(i, reduce)}>
                  <td><b data-no-tr>{u.full_name || u.username}</b><div className="muted small" data-no-tr>{u.username}{u.email ? ` · ${u.email}` : ''}</div></td>
                  <td><span className={`role-badge role-${u.role.toLowerCase()}`}>{u.role}</span></td>
                  <td className="small">{u.all_companies ? <span className="pill ok">All companies</span>
                    : u.companies.map((c) => <span key={`${c.tenant_key}${c.company}`} className="pill" data-no-tr>{coName(c)}</span>)}</td>
                  <td className="small">{u.all_pages ? <span className="pill ok">All the role allows</span>
                    : <span className="pill" title={u.pages.map((k) => pages.find((p) => p.key === k)?.label || k).join(', ')}>{u.pages.length} of {pages.length || 13}</span>}</td>
                  <td>{!u.is_active ? <span className="pill bad">Disabled</span>
                    : u.locked_until && new Date(String(u.locked_until).endsWith('Z') ? u.locked_until : `${u.locked_until}Z`) > new Date() ? <span className="pill warn">Locked</span>
                      : u.must_change ? <span className="pill warn">Must change password</span> : <span className="pill ok">Active</span>}</td>
                  <td className="small muted">{u.last_login_at ? fmtTime(u.last_login_at) : 'never'}</td>
                  <td className="act">
                    {confirm === u.user_id
                      ? <><span className="small">Delete?</span> <button className="danger small-btn" onClick={() => del(u)}>Yes</button> <button className="small-btn" onClick={() => setConfirm(null)}>No</button></>
                      : <><button className="small-btn" onClick={() => setEdit(u)}>Edit</button>{' '}
                        {u.user_id !== me?.user_id && <button className="small-btn" onClick={() => setConfirm(u.user_id)}>Delete</button>}</>}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </MotionCard>
      {edit && <UserForm user={edit} companies={companies} pages={pages} matrix={matrix} onClose={() => setEdit(null)}
                         onSaved={(text) => { setEdit(null); setMsg({ text }); load() }} />}
    </>
  )
}

function RolesTab() {
  const [d, setD] = useState(null)
  const [m, setM] = useState({})
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { admin('roles').then((r) => { setD(r); setM(r.matrix) }).catch((e) => setMsg({ bad: true, text: e.message })) }, [])
  const flip = (role, p) => setM((x) => ({ ...x, [role]: x[role].includes(p) ? x[role].filter((y) => y !== p) : [...x[role], p] }))
  const dirty = d && JSON.stringify(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v].sort()]))) !==
    JSON.stringify(Object.fromEntries(Object.entries(d.matrix).map(([k, v]) => [k, [...v].sort()])))
  const save = async () => {
    setBusy(true); setMsg(null)
    try { const r = await admin('roles', { method: 'PUT', body: { matrix: m } }); setD(r); setM(r.matrix); setMsg({ text: 'Permissions saved. Users get them within 20 seconds.' }) }
    catch (e) { setMsg({ bad: true, text: e.message }) } finally { setBusy(false) }
  }
  if (!d) return msg ? <div className="alert bad">{msg.text}</div> : <div className="card muted">Loading…</div>
  return (
    <MotionCard as="section" hover={false} className="card stack">
      <div className="row"><h2 className="grow">What each role may do</h2>
        {dirty && <button onClick={() => setM(d.matrix)}>Discard</button>}
        <button className="primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save permissions'}</button></div>
      {msg && <div className={`alert ${msg.bad ? 'bad' : 'good'}`}>{msg.text}</div>}
      <div className="table-wrap">
        <table className="matrix">
          <thead><tr><th>Permission</th>{d.roles.map((r) => <th key={r} className="center"><span className={`role-badge role-${r.toLowerCase()}`}>{r}</span></th>)}</tr></thead>
          <tbody>
            {d.permissions.map((p) => (
              <tr key={p.key}>
                <td>{p.label}<div className="muted small" data-no-tr>{p.key}</div></td>
                {d.roles.map((r) => (
                  <td key={r} className="center">
                    <input type="checkbox" aria-label={`${r}: ${p.label}`} checked={r === 'Admin' || m[r]?.includes(p.key)}
                           disabled={r === 'Admin'} onChange={() => flip(r, p.key)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Admin always has every permission. Company access (which rows a user sees) is set per user on the Users tab and is enforced by SQL Server row-level security.</p>
    </MotionCard>
  )
}

export default function Users() {
  const [tab, setTab] = useState('users')
  return (
    <div className="page">
      <header className="hero hero-3d">
        <Hero3D />
        <div><h1>User Management</h1><p>Users, what each role may do, which companies (row-level security) and which dashboards and reports each user can see.</p></div>
      </header>
      <div className="tabs" role="tablist">
        {[['users', 'Users'], ['roles', 'Roles & permissions']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'users' && <UsersTab />}
      {tab === 'roles' && <RolesTab />}
    </div>
  )
}
