import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth'
import { useConfig } from '../config'
import { Hero3D } from '../components/three'
import Markdown from '../components/Markdown'
import { GROUPS, SECTIONS } from './manual/content'
import { downloadManual } from './manual/export'

const plain = (s) => s.toLowerCase().replace(/[*`_|#>]/g, ' ')

/** System Manual: the whole project explained, with a contents list, search and print. */
export default function Manual({ go }) {
  const { user, can } = useAuth()
  const { config } = useConfig()
  const tech = can('etl.view') || can('users.manage')
  const [q, setQ] = useState('')
  const [active, setActive] = useState('introduction')
  const body = useRef(null)
  const [dl, setDl] = useState('')          // '' | 'busy' | error text

  const visible = useMemo(() => SECTIONS.filter((s) => !s.tech || tech), [tech])
  const found = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return visible
    return visible.filter((s) => words.every((w) => plain(`${s.title} ${s.md}`).includes(w)))
  }, [q, visible])

  // highlight the section being read in the contents list
  useEffect(() => {
    const els = [...(body.current?.querySelectorAll('section[data-id]') || [])]
    if (!els.length || !('IntersectionObserver' in window)) return undefined
    const io = new IntersectionObserver((ents) => {
      const top = ents.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (top) setActive(top.target.dataset.id)
    }, { rootMargin: '-80px 0px -70% 0px' })
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
  }, [found])

  const jump = (id) => {
    setActive(id)
    document.getElementById(`man-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="page manual">
      <header className="hero hero-3d no-print">
        <Hero3D />
        <div>
          <h1>System Manual</h1>
          <p>Everything about the {config.company_name} financial reporting system - how to use it, how it works, and what to do when something goes wrong</p>
        </div>
        <div className="row tight">
          <input className="man-search" type="search" placeholder="Search the manual…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button onClick={() => window.print()}>Print / PDF</button>
          <select className="man-download" value="" aria-label="Download the manual" title="Download the whole manual"
                  disabled={dl === 'busy'}
                  onChange={async (e) => {
                    setDl('busy')
                    try { await downloadManual(e.target.value, { sections: visible, groups: GROUPS, company: config.company_name }); setDl('') }
                    catch (err) { setDl(`PDF not created: ${err.message}`) }
                  }}>
            <option value="" hidden>{dl === 'busy' ? 'Preparing…' : 'Download…'}</option>
            <option value="pdf">PDF (.pdf)</option>
            <option value="word">Word (.docx)</option>
            <option value="html">Web page (.html)</option>
            <option value="md">Markdown (.md)</option>
            <option value="txt">Plain text (.txt)</option>
          </select>
        </div>
      </header>

      {dl && dl !== 'busy' && <div className="alert bad no-print">{dl}</div>}
      <div className="man-layout">
        <nav className="man-toc card no-print" aria-label="Contents">
          {GROUPS.map((g) => {
            const items = found.filter((s) => s.group === g)
            if (!items.length) return null
            return (
              <div key={g} className="man-group">
                <b>{g}</b>
                {items.map((s) => (
                  <button key={s.id} className={active === s.id ? 'on' : ''} onClick={() => jump(s.id)}>{s.title}</button>
                ))}
              </div>
            )
          })}
          {!found.length && <p className="muted small">Nothing found for “{q}”.</p>}
        </nav>

        <div className="man-body" ref={body}>
          <div className="print-only man-print-head"><h1>{config.company_name} - System Manual</h1></div>
          {!q && (
            <section className="card man-you">
              <h2>Your access</h2>
              <p>You are signed in as <b data-no-tr>{user?.full_name || user?.username}</b> with the role <b>{user?.role}</b>
                {user?.all_companies ? ', for all companies' : `, for ${user?.companies?.length || 0} compan${user?.companies?.length === 1 ? 'y' : 'ies'}`}
                {user?.all_pages === false ? `, limited to ${user?.pages?.length || 0} dashboards / reports` : ''}.</p>
              <div className="man-perms">
                {(user?.permissions || []).map((p) => <span key={p} className="ai-chip" data-no-tr>{p}</span>)}
              </div>
              <div className="row tight man-links">
                <button onClick={() => go('/ai/assistant')} disabled={!can('ai.use')}>Ask the AI Assistant</button>
                <button onClick={() => jump('troubleshooting')}>Troubleshooting</button>
                {!tech && <span className="muted small">Technical sections are shown to users who run ETL or manage users.</span>}
              </div>
            </section>
          )}
          {found.map((s) => (
            <section key={s.id} id={`man-${s.id}`} data-id={s.id} className="card man-sec">
              <div className="man-sec-head"><span className="muted small">{s.group}</span><h2>{s.title}</h2></div>
              <Markdown text={s.md} />
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
