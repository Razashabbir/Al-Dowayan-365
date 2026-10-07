import { useEffect, useState } from 'react'
import { call } from '../api'
import { useAuth } from '../auth'
import { useApp } from '../theme'
import { LogoMark, useConfig } from '../config'
import { Hero3D } from '../components/three'
import { motion } from '../components/motion'

/** Sign-in screen (also used for the forced first password change). */
export default function Login() {
  const { login, state, reload } = useAuth()
  const { font, setFont } = useApp()
  const { config } = useConfig()
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [demo, setDemo] = useState([])        // demo accounts - only listed while DEMO_USERS=1 on the server

  useEffect(() => { call('/api/auth/demo-users').then((d) => setDemo(Array.isArray(d) ? d : [])).catch(() => setDemo([])) }, [state])

  const signIn = async (name, pw) => {
    setBusy(name); setErr('')
    try { await login(name, pw) } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  const submit = (e) => { e.preventDefault(); signIn(u.trim(), p) }

  return (
    <div className="login-shell">
      <section className="login-brand hero hero-3d">
        <Hero3D />
        <div>
          <LogoMark big />
          <h1>{config.company_name}</h1>
          <p>{config.login_message}</p>
        </div>
      </section>
      <motion.form className="login-card card stack" onSubmit={submit}
                   initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="row"><h2 className="grow">Sign in</h2>
          <button type="button" className="top-btn lang" data-no-tr onClick={() => setFont(font === 'ar' ? 'en' : 'ar')}>
            {font === 'ar' ? 'English' : 'العربية'}</button></div>
        {state === 'error' && <div className="alert bad">Cannot reach the API. Is uvicorn running? <button type="button" className="linkish" onClick={reload}>Try again</button></div>}
        <label>Username<input autoFocus autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} /></label>
        <label>Password<input type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} /></label>
        {err && <div className="alert bad">{err}</div>}
        <button className="primary" disabled={!u || !p || !!busy}>{busy && busy === u.trim() ? 'Signing in…' : 'Sign in'}</button>
        {demo.length > 0 && (
          <div className="demo-box">
            <div className="row tight"><b className="grow">Demo accounts</b>
              <span className="muted small">password <code data-no-tr>{demo[0].password}</code></span></div>
            {demo.map((d) => (
              <button type="button" key={d.username} className="demo-user" disabled={!!busy} onClick={() => signIn(d.username, d.password)}
                      title={`Sign in as ${d.username}`}>
                <span className={`role-badge role-${d.role.toLowerCase()}`}>{d.role}</span>
                <span className="grow"><b data-no-tr>{d.username}</b><span className="muted small">{d.about}</span></span>
                <span className="demo-go">{busy === d.username ? 'Signing in…' : 'Sign in ›'}</span>
              </button>
            ))}
          </div>
        )}
      </motion.form>
    </div>
  )
}

/** Change password - forced after the first sign-in or a reset, or opened from the user menu. */
export function ChangePassword({ forced, onDone }) {
  const { changePassword, logout, user } = useAuth()
  const [cur, setCur] = useState('')
  const [n1, setN1] = useState('')
  const [n2, setN2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    if (n1 !== n2) { setErr('The new passwords are not the same.'); return }
    setBusy(true); setErr('')
    try { await changePassword(cur, n1); onDone?.() } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  const form = (
    <form className="card stack login-card" onSubmit={submit}>
      <h2>{forced ? 'Choose a new password' : 'Change password'}</h2>
      {forced && <p className="muted">Hello {user?.full_name || user?.username}. Please replace the temporary password before you continue.</p>}
      <label>Current password<input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></label>
      <label>New password<input type="password" autoComplete="new-password" value={n1} onChange={(e) => setN1(e.target.value)} /></label>
      <label>Repeat new password<input type="password" autoComplete="new-password" value={n2} onChange={(e) => setN2(e.target.value)} /></label>
      <p className="muted small">At least 8 characters with letters and numbers.</p>
      {err && <div className="alert bad">{err}</div>}
      <div className="row">
        <button className="primary" disabled={!cur || !n1 || !n2 || busy}>{busy ? 'Saving…' : 'Save password'}</button>
        {forced ? <button type="button" onClick={logout}>Sign out</button> : <button type="button" onClick={onDone}>Cancel</button>}
      </div>
    </form>
  )
  return forced ? <div className="login-shell single">{form}</div> : form
}
