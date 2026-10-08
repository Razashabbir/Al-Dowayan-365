import { useEffect, useRef, useState } from 'react'
import { admin, api } from '../api'
import { IconBell, RoleIcon } from './Icons'
import { BookmarkButton } from './bookmarks'
import { THEMES, resolveTheme, useApp } from '../theme'
import { useAuth } from '../auth'
import Modal from './Modal'
import { ChangePassword } from '../pages/Login'

function ThemePicker() {
  const { themeId, setThemeId, custom, setCustom } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const current = resolveTheme(themeId, custom)
  const swatch = (t) => ({ background: `linear-gradient(135deg, ${t.start}, ${t.mid}, ${t.end})` })

  return (
    <div className="picker" ref={ref}>
      <button className="top-btn" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}
              title="Colour theme">
        <span className="swatch" style={swatch(current)} /> <span className="hide-sm">Theme</span> ▾
      </button>
      {open && (
        <div className="menu" role="listbox" aria-label="Colour theme">
          {THEMES.map((t) => {
            const r = resolveTheme(t.id, custom)
            return (
              <button key={t.id} role="option" aria-selected={themeId === t.id}
                      className={`menu-item ${themeId === t.id ? 'on' : ''}`}
                      onClick={() => { setThemeId(t.id); if (t.id !== 'custom') setOpen(false) }}>
                <span className="swatch" style={swatch(r)} /> {t.name}
              </button>
            )
          })}
          {themeId === 'custom' && (
            <div className="custom-row">
              <label>Start<input type="color" value={custom.start}
                                 onChange={(e) => setCustom({ ...custom, start: e.target.value })} /></label>
              <label>End<input type="color" value={custom.end}
                               onChange={(e) => setCustom({ ...custom, end: e.target.value })} /></label>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CompanyPicker() {
  const { scope, setScope } = useApp()
  const [list, setList] = useState(null)      // null = loading
  const [err, setErr] = useState('')

  useEffect(() => {
    let timer
    const load = () => api('companies-all').then((rows) => {
      setErr(''); setList(rows)
      const valid = scope && rows.some((r) => r.tenant_key === scope.tenant && r.company === scope.company)
      if (!valid && rows.length) {
        const def = rows.find((r) => r.is_default) || rows[0]
        setScope({ tenant: def.tenant_key, company: def.company })
      }
      timer = setTimeout(load, rows.length ? 60000 : 30000)   // stay current after an ETL run or a data reset
    }).catch((e) => { setErr(e.message); setList([]); timer = setTimeout(load, 15000) })
    const again = () => { clearTimeout(timer); load() }
    load()
    window.addEventListener('focus', again)                  // back to the tab: refresh at once
    window.addEventListener('companies-changed', again)      // fired when an ETL job finishes
    return () => { clearTimeout(timer); window.removeEventListener('focus', again); window.removeEventListener('companies-changed', again) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // always visible, so it is clear why there is nothing to pick
  if (!list || !list.length) {
    const why = !list ? 'Loading companies…'
      : err ? `Companies unavailable: ${err}`
        : 'No companies yet - run ETL for LegalEntities (ETL › Jobs)'
    return (
      <select className="top-select co-top" dir="ltr" disabled title={why} aria-label="Company">
        <option>{!list ? 'Loading companies…' : err ? 'Companies: API error' : 'No companies yet'}</option>
      </select>
    )
  }
  const tenants = [...new Map(list.map((r) => [r.tenant_key, r.tenant])).entries()]
  const value = scope ? `${scope.tenant}|${scope.company}` : ''
  const onChange = (e) => {
    const [t, c] = e.target.value.split('|')
    setScope({ tenant: Number(t), company: c })
  }
  const option = (r) => <option key={`${r.tenant_key}|${r.company}`} value={`${r.tenant_key}|${r.company}`}>
    {r.company}{r.name ? ` · ${r.name}` : ''}</option>

  return (
    <select className="top-select co-top" dir="ltr" data-no-tr value={value} onChange={onChange} aria-label="Company" title="Company">
      {tenants.length > 1
        ? tenants.map(([k, name]) => (
          <optgroup key={k} label={name}>{list.filter((r) => r.tenant_key === k).map(option)}</optgroup>))
        : list.map(option)}
    </select>
  )
}

function UserMenu() {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const [pw, setPw] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  if (!user) return null
  const name = user.full_name || user.username
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className="picker" ref={ref}>
      <button className="top-btn user-btn" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} title={name}>
        <span className={`avatar role-av-${user.role.toLowerCase()}`} title={initials} aria-hidden="true"><RoleIcon role={user.role} /></span>
        <span className="hide-sm user-name" data-no-tr>{name}</span>
        <span className={`role-badge role-${user.role.toLowerCase()}`}>{user.role}</span>
      </button>
      {open && (
        <div className="menu user-menu" role="menu">
          <div className="user-head">
            <b data-no-tr>{name}</b>
            <span className="muted small" data-no-tr>{user.username}{user.email ? ` · ${user.email}` : ''}</span>
            <span className="muted small">{user.all_companies ? 'All companies' : `Companies: ${user.companies.map((c) => c.company.toUpperCase()).join(', ')}`}</span>
          </div>
          <button className="menu-item" role="menuitem" onClick={() => { setPw(true); setOpen(false) }}>🔑 Change password</button>
          <button className="menu-item" role="menuitem" onClick={logout}>⎋ Sign out</button>
        </div>
      )}
      {pw && <Modal title="Change password" onClose={() => setPw(false)}><ChangePassword onDone={() => setPw(false)} /></Modal>}
    </div>
  )
}

const SEVL = { bad: 'Problem', warn: 'Warning', info: 'Info' }

/** Bell with the number of open alerts; click = pop-up with the latest alerts (users with the Alerts permission). */
function AlertBell({ go }) {
  const { can } = useAuth()
  const [n, setN] = useState({ open: 0, bad: 0 })
  const [ring, setRing] = useState(false)
  const [open, setOpen] = useState(false)
  const [list, setList] = useState(null)
  const [busy, setBusy] = useState(false)
  const last = useRef(0)
  const ref = useRef(null)
  const load = () => admin('alerts/count').then((r) => {
    if (r.open > last.current) { setRing(true); setTimeout(() => setRing(false), 900) }
    last.current = r.open; setN(r)
  }).catch(() => {})
  const loadList = () => admin('alerts').then((r) => setList(r.alerts.filter((a) => a.status === 'Open'))).catch(() => setList([]))
  useEffect(() => {
    if (!can('alerts.view')) return undefined
    load()
    const t = setInterval(load, 60000)
    const on = () => { load(); if (open) loadList() }
    window.addEventListener('alerts-changed', on)
    return () => { clearInterval(t); window.removeEventListener('alerts-changed', on) }
  }, [can, open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [])
  if (!can('alerts.view')) return null
  const toggle = () => { if (!open) { setList(null); loadList() } setOpen(!open) }
  const ack = async (a) => { await admin(`alerts/${a.alert_id}/ack`, { method: 'POST' }).catch(() => {}); loadList(); load() }
  const check = async () => { setBusy(true); await admin('alerts/run', { method: 'POST', timeoutMs: 300000 }).catch(() => {}); setBusy(false); loadList(); load() }
  return (
    <div className="picker" ref={ref}>
      <button className={`top-btn bell-btn ${ring ? 'ring' : ''} ${open ? 'on' : ''}`} onClick={toggle} aria-haspopup="dialog" aria-expanded={open}
              title={n.open ? `${n.open} open alert(s)` : 'No open alerts'} aria-label="Notifications">
        <IconBell />{n.open > 0 && <span className={`bell-count ${n.bad ? 'bad' : ''}`}>{n.open > 99 ? '99+' : n.open}</span>}
      </button>
      {open && (
        <div className="menu bell-pop" role="dialog" aria-label="Notifications">
          <div className="bell-head"><b>Notifications</b><span className="muted small">{n.open} open{n.bad ? ` · ${n.bad} problem${n.bad > 1 ? 's' : ''}` : ''}</span>
            <span className="grow" /><button className="linkish" onClick={check} disabled={busy}>{busy ? 'Checking…' : 'Check now'}</button></div>
          <div className="bell-list">
            {!list && <p className="muted small">Loading…</p>}
            {list && !list.length && <p className="muted small bell-empty">All clear - no open alerts.</p>}
            {list?.slice(0, 8).map((a) => (
              <div key={a.alert_id} className={`bell-item sev-${a.severity}`}>
                <span className={`dot dot-${a.severity === 'bad' ? 'bad' : 'warn'}`} />
                <div className="grow">
                  <div className="bell-title">{a.title}</div>
                  {a.detail && <div className="muted small bell-detail">{a.detail}</div>}
                  <div className="row tight bell-acts">
                    <span className={`pill ${a.severity === 'bad' ? 'bad' : 'warn'}`}>{SEVL[a.severity]}</span>
                    <span className="grow" />
                    {a.link && <button className="linkish" onClick={() => { setOpen(false); go(a.link) }}>Open</button>}
                    <button className="linkish" onClick={() => ack(a)}>Acknowledge</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button className="bell-all" onClick={() => { setOpen(false); go('/admin/alerts') }}>View all alerts{list && list.length > 8 ? ` (${list.length})` : ''} ›</button>
        </div>
      )}
    </div>
  )
}

export default function Topbar({ title, onMenu, go, route }) {
  const { font, setFont } = useApp()
  return (
    <div className="topbar">
      <button className="top-btn menu-btn" onClick={onMenu} aria-label="Open menu">☰</button>
      <strong className="top-title">{title}</strong>
      <div className="top-actions">
        <ThemePicker />
        <button className="top-btn lang" data-no-tr onClick={() => setFont(font === 'ar' ? 'en' : 'ar')}
                title={font === 'ar' ? 'التبديل إلى الإنجليزية' : 'Switch the interface to Arabic'}>
          {font === 'ar' ? 'English' : 'العربية'}
        </button>
        <CompanyPicker />
        {route && <BookmarkButton route={route} title={title} />}
        {go && <AlertBell go={go} />}
        <UserMenu />
      </div>
    </div>
  )
}
