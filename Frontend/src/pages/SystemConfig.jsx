import { useEffect, useState } from 'react'
import { admin, fmtTime } from '../api'
import { useConfig } from '../config'
import { THEMES, resolveTheme } from '../theme'
import { MotionCard } from '../components/motion'
import { Hero3D } from '../components/three'

const SAMPLE = [1234567.891, -98765.4]

/** Read a picked image, shrink it to at most 256 px and return a data: URL (SVG is kept as it is). */
function readLogo(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) { reject(new Error('Choose a PNG, JPG, WEBP or SVG image.')); return }
    const r = new FileReader()
    r.onerror = () => reject(new Error('Cannot read the file.'))
    r.onload = () => {
      if (file.type === 'image/svg+xml') {
        if (r.result.length > 280000) reject(new Error('The SVG is too large (max 200 KB).')); else resolve(r.result)
        return
      }
      const img = new Image()
      img.onload = () => {
        const k = Math.min(1, 256 / Math.max(img.width, img.height))
        const c = document.createElement('canvas')
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
        resolve(c.toDataURL('image/png'))
      }
      img.onerror = () => reject(new Error('This image cannot be opened.'))
      img.src = r.result
    }
    r.readAsDataURL(file)
  })
}

function preview(v, c) {
  const s = new Intl.NumberFormat('en-AE', { minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals })
  return v < 0 && c.negatives === 'brackets' ? `(${s.format(-v)})` : s.format(v)
}

export default function SystemConfig() {
  const { apply } = useConfig()
  const [d, setD] = useState(null)
  const [v, setV] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => admin('config').then((r) => { setD(r); setV(r.values) }).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])

  const set = (k) => (e) => {
    const x = e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e
    setV((o) => ({ ...o, [k]: k === 'decimals' ? Number(x) : x })); setMsg('')
  }
  const changed = d && v && Object.keys(v).some((k) => String(v[k]) !== String(d.values[k]))

  const pickLogo = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try { set('logo')(await readLogo(f)); setErr('') } catch (ex) { setErr(ex.message) }
  }

  const save = async () => {
    setBusy(true); setErr(''); setMsg('')
    try {
      const r = await admin('config', { method: 'PUT', body: v })
      // the server answers with what it stored - make sure it is what was sent (an old API would ignore it)
      const lost = ['company_name', 'short_name', 'tagline', 'logo', 'currency'].filter((k) => String(r.values[k] ?? '') !== String(v[k] ?? ''))
      setD(r); setV(r.values)
      apply(r.values, true)                       // name, logo and number format change everywhere at once
      if (lost.length) setErr(`The API did not store: ${lost.join(', ')}. Restart uvicorn (the API must be the latest version) and save again.`)
      else setMsg('Saved - the sidebar, sign-in page, browser tab and reports now use the new settings. Other users see them at their next page load.')
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  return (
    <div className="page">
      <header className="hero hero-3d">
        <Hero3D />
        <div>
          <h1>System Configuration</h1>
          <p>Company name and logo, default theme and language, currency and number format</p>
        </div>
        <div className="row tight">
          <button onClick={() => setV(d.values)} disabled={!changed || busy}>Undo changes</button>
          <button className="hero-cta" onClick={save} disabled={!changed || busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </header>
      {err && <div className="alert bad">{err}</div>}
      {msg && <div className="alert good">{msg}</div>}
      {!v && !err && <div className="card muted">Loading…</div>}
      {v && <div className="cfg-grid">
        <MotionCard as="section" hover={false} className="card">
          <h2>General &amp; branding</h2>
          <div className="form-grid">
            <label className="full">Company name<input value={v.company_name} maxLength={100} onChange={set('company_name')} /></label>
            <label>Logo letters<input value={v.short_name} maxLength={4} onChange={set('short_name')} /></label>
            <label>Tagline (under the name)<input value={v.tagline} maxLength={80} onChange={set('tagline')} /></label>
            <label className="full">Sign-in page message<textarea rows={3} value={v.login_message} maxLength={300} onChange={set('login_message')} /></label>
            <div className="full cfg-logo">
              <div className="cfg-logo-prev" style={{ background: resolveTheme(v.default_theme, {}).side?.[1] || 'var(--accent)' }}>
                {v.logo ? <img className="logo-img" src={v.logo} alt="" /> : <div className="logo-mark" data-no-tr>{v.short_name || 'AD'}</div>}
                <div><b data-no-tr>{v.company_name}</b><span>{v.tagline}</span></div>
              </div>
              <div className="stack tight-stack">
                <label className="file-btn">Upload logo…<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={pickLogo} /></label>
                {v.logo && <button onClick={() => set('logo')('')}>Remove logo (use letters)</button>}
                <span className="muted small">PNG, JPG, WEBP or SVG. Square images look best; large pictures are shrunk to 256 px.</span>
              </div>
            </div>
          </div>
        </MotionCard>

        <MotionCard as="section" hover={false} className="card">
          <h2>Theme &amp; language</h2>
          <p className="muted small">Saving a new theme switches everyone to it (each user can still pick another in the top bar). The language is used until a user picks their own.</p>
          <div className="form-grid">
            <label>Theme
              <select value={v.default_theme} onChange={set('default_theme')}>
                {THEMES.filter((t) => t.id !== 'custom').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label>Language
              <select value={v.default_language} onChange={set('default_language')}>
                <option value="en">English</option><option value="ar">العربية (Arabic, right-to-left)</option>
              </select>
            </label>
          </div>
          <div className="cfg-swatches">
            {THEMES.filter((t) => t.id !== 'custom').map((t) => (
              <button key={t.id} title={t.name} aria-label={t.name} className={`cfg-swatch ${v.default_theme === t.id ? 'on' : ''}`}
                      style={{ background: `linear-gradient(135deg, ${t.start}, ${t.mid}, ${t.end})` }} onClick={() => set('default_theme')(t.id)} />
            ))}
          </div>

          <h2 className="cfg-sub">Currency &amp; numbers</h2>
          <div className="form-grid">
            <label>Currency code<input value={v.currency} maxLength={3} onChange={set('currency')} /></label>
            <label>Decimals
              <select value={v.decimals} onChange={set('decimals')}><option value={0}>0 - 1,234,568</option><option value={2}>2 - 1,234,567.89</option></select>
            </label>
            <label>Negative numbers
              <select value={v.negatives} onChange={set('negatives')}><option value="minus">Minus (-98,765)</option><option value="brackets">Brackets (98,765)</option></select>
            </label>
            <div className="cfg-num">
              <span className="muted small">Preview</span>
              <span className="num">{preview(SAMPLE[0], v)} {v.currency}</span>
              <span className="num">{preview(SAMPLE[1], v)} {v.currency}</span>
            </div>
          </div>
          <p className="muted small">Financial statements always show negatives in brackets, as in the audited accounts.</p>
        </MotionCard>

      </div>}
      {changed && (
        <div className="cfg-unsaved" role="status">
          <span>You have unsaved changes - they are not applied until you save.</span>
          <button onClick={() => setV(d.values)} disabled={busy}>Undo</button>
          <button className="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      )}
      {d?.last_change && <p className="muted small">Last changed {fmtTime(d.last_change.updated_at)} by {d.last_change.updated_by || '–'}.</p>}
    </div>
  )
}
