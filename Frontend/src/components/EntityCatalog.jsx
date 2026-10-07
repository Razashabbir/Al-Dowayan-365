import { useEffect, useMemo, useState } from 'react'
import { admin, fmtTime } from '../api'

import Pager, { paginate } from './Pager'

/** Browse every public entity of a D365 environment and choose which ones this connection syncs. */
export default function EntityCatalog({ tenant, onClose, onSaved }) {
  const k = tenant.tenant_key
  const [cat, setCat] = useState(null)        // { info, entities }
  const [picks, setPicks] = useState({})      // name -> { mode, date_field }
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [show, setShow] = useState('all')     // all | selected | unselected
  const [open, setOpen] = useState(null)      // entity whose fields are shown
  const [fields, setFields] = useState({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = (refresh = false) => {
    setBusy(refresh ? 'refresh' : 'load'); setError('')
    admin(`tenants/${k}/catalog`, { params: refresh ? { refresh: true } : undefined, timeoutMs: 300000 })
      .then((c) => {
        setCat(c)
        const p = {}
        c.entities.filter((e) => e.selected).forEach((e) => { p[e.name] = { mode: e.mode, date_field: e.date_field } })
        setPicks(p)
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(''))
  }
  useEffect(() => { load(false) }, [k]) // eslint-disable-line react-hooks/exhaustive-deps

  const matches = useMemo(() => {
    if (!cat) return []
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return cat.entities.filter((e) => {
      if (show === 'selected' && !picks[e.name]) return false
      if (show === 'unselected' && picks[e.name]) return false
      const n = e.name.toLowerCase()
      return words.every((w) => n.includes(w))
    })
  }, [cat, q, show, picks])

  const count = Object.keys(picks).length
  const toggle = (e) => setPicks((p) => {
    const n = { ...p }
    if (n[e.name]) delete n[e.name]
    else n[e.name] = { mode: 'full', date_field: null }
    return n
  })
  const setMode = (e, mode, date_field) => setPicks((p) => ({ ...p, [e.name]: { mode, date_field } }))

  const selectMatches = () => {
    const add = matches.filter((e) => !picks[e.name])
    if (add.length > 50 && !window.confirm(
      `Add ${add.length} D365 tables?\n\nEvery sync will download all of them from D365. Hundreds of tables can take ` +
      `several hours, load the D365 environment, and some tables fail by design (they need parameters). ` +
      `Usually it is better to pick the tables your reports need.`)) return
    setPicks((p) => {
      const n = { ...p }
      add.forEach((e) => { n[e.name] = { mode: 'full', date_field: null } })
      return n
    })
  }
  const clearMatches = () => setPicks((p) => {
    const n = { ...p }
    matches.forEach((e) => delete n[e.name])
    return n
  })

  const showFields = async (name) => {
    if (open === name) { setOpen(null); return }
    setOpen(name)
    if (!fields[name]) {
      try { const f = await admin(`tenants/${k}/catalog/${encodeURIComponent(name)}`); setFields((x) => ({ ...x, [name]: f })) }
      catch (e) { setFields((x) => ({ ...x, [name]: { error: e.message } })) }
    }
  }

  const save = async () => {
    setBusy('save'); setError('')
    try {
      const body = Object.entries(picks).map(([name, p]) => ({
        name, mode: p.mode === 'incremental' && p.date_field ? 'incremental' : 'full',
        date_field: p.mode === 'incremental' ? p.date_field : null, enabled: true,
      }))
      await admin(`tenants/${k}/entities`, { method: 'PUT', body })
      onSaved?.()
      onClose()
    } catch (e) { setError(e.message); setBusy('') }
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="D365 tables">
        <div className="row">
          <div>
            <h2>D365 tables — {tenant.name}</h2>
            <p className="muted small">
              {cat ? `${cat.entities.length.toLocaleString()} D365 tables published by this environment · read ${fmtTime(cat.info?.fetched_at)}` : ''}
            </p>
          </div>
          <div className="row tight">
            <button onClick={() => load(true)} disabled={!!busy}>{busy === 'refresh' ? 'Reading D365…' : 'Refresh from D365'}</button>
            <button onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        {!cat && !error && (
          <div className="alert">Reading all D365 tables from the environment. The first time takes about a minute…</div>
        )}
        {error && <div className="alert bad">{error}</div>}

        {cat && (
          <>
            <div className="row">
              <div className="row tight grow">
                <input className="grow" placeholder="Search D365 tables, e.g. sales invoice, ledger, vendor trans…" value={q}
                       onChange={(e) => { setQ(e.target.value); setPage(1) }} autoFocus />
                <select value={show} onChange={(e) => { setShow(e.target.value); setPage(1) }}>
                  <option value="all">All</option>
                  <option value="selected">Selected ({count})</option>
                  <option value="unselected">Not selected</option>
                </select>
              </div>
              <div className="row tight">
                <button onClick={selectMatches} disabled={!matches.length}>Select {matches.length.toLocaleString()} shown</button>
                <button onClick={clearMatches} disabled={!matches.length}>Clear shown</button>
              </div>
            </div>

            <div className="table-wrap catalog paged">
              <table>
                <thead>
                  <tr><th></th><th>D365 Table</th><th className="num">Fields</th><th>Key</th><th>Load mode</th><th></th></tr>
                </thead>
                <tbody>
                  {paginate(matches, page, size).pageRows.map((e) => {
                    const p = picks[e.name]
                    return (
                      <FragmentRow key={e.name} e={e} p={p} open={open === e.name} fields={fields[e.name]}
                                   onToggle={() => toggle(e)} onMode={setMode} onFields={() => showFields(e.name)} />
                    )
                  })}
                </tbody>
              </table>
              <div className="pad">
                <Pager total={matches.length} page={paginate(matches, page, size).page} pages={paginate(matches, page, size).pages}
                       size={size} onPage={setPage} onSize={(n) => { setSize(n); setPage(1) }} />
              </div>
              {!matches.length && <p className="muted small pad">No D365 tables match.</p>}
            </div>
          </>
        )}

        <div className="row">
          <span className="muted small">{count} D365 tables selected for this tenant</span>
          <div className="row tight">
            <button onClick={onClose}>Cancel</button>
            <button className="primary" onClick={save} disabled={!cat || !!busy}>{busy === 'save' ? 'Saving…' : 'Save selection'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function FragmentRow({ e, p, open, fields, onToggle, onMode, onFields }) {
  return (
    <>
      <tr className={p ? 'picked' : ''}>
        <td><input type="checkbox" checked={!!p} onChange={onToggle} aria-label={`Sync ${e.name}`} /></td>
        <td><strong>{e.name}</strong></td>
        <td className="num">{e.fields}</td>
        <td className="small muted ellipsis" title={e.keys.join(', ')}>{e.keys.join(', ') || '—'}</td>
        <td>
          {p && (
            <div className="row tight">
              <select value={p.mode} onChange={(ev) => onMode(e, ev.target.value, ev.target.value === 'incremental' ? (p.date_field || e.date_fields[0] || null) : null)}>
                <option value="full">Full</option>
                <option value="incremental" disabled={!e.date_fields.length}>Incremental</option>
              </select>
              {p.mode === 'incremental' && (
                <select value={p.date_field || ''} onChange={(ev) => onMode(e, 'incremental', ev.target.value)}>
                  {e.date_fields.map((d) => <option key={d}>{d}</option>)}
                </select>
              )}
            </div>
          )}
        </td>
        <td><button className="linkish" onClick={onFields}>{open ? 'Hide fields' : 'Fields'}</button></td>
      </tr>
      {open && (
        <tr className="fields-row">
          <td></td>
          <td colSpan={5}>
            {!fields ? <span className="muted small">Loading…</span>
              : fields.error ? <span className="down small">{fields.error}</span>
              : (
                <div className="field-list">
                  {fields.fields.map((f) => (
                    <span key={f.name} className={f.key ? 'field key' : 'field'} title={f.type}>
                      {f.name}<span className="muted"> {f.type}</span>
                    </span>
                  ))}
                </div>
              )}
          </td>
        </tr>
      )}
    </>
  )
}
