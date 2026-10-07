import { useEffect, useMemo, useState } from 'react'
import { admin, fmt, fmtTime } from '../api'
import { TenantFilter } from './Jobs'

export default function Counts() {
  const [tenant, setTenant] = useState(null)
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = () => admin('counts', { params: { tenant } }).then(setRows).catch((e) => setMsg({ bad: true, text: e.message }))
  useEffect(() => { load() }, [tenant]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => (rows || []).filter((r) =>
    `${r.table} ${r.entity || ''}`.toLowerCase().includes(q.toLowerCase())), [rows, q])
  const total = shown.reduce((s, r) => s + Number(r.rows || 0), 0)
  const empty = rows?.length === 0

  const recount = async () => {
    setBusy(true); setMsg(null)
    try {
      const r = await admin('counts/recount', { method: 'POST', params: { tenant } })
      setMsg({ text: `Recounted — ${r.tables} tables with data.` })
      load()
    } catch (e) { setMsg({ bad: true, text: e.message }) }
    setBusy(false)
  }

  const exportCsv = () => {
    const lines = ['Tenant,SQL table,D365 table,Rows,Last loaded', ...shown.map((r) =>
      [r.tenant, r.table, r.entity || '', r.rows, r.last_loaded_at || ''].join(','))]
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    Object.assign(document.createElement('a'), { href: url, download: 'stg_row_counts.csv' }).click()
  }

  return (
    <div className="page">
      <div className="hero">
        <div><h1>Counts</h1><p>Rows per table in SQL (schema stg), per tenant.</p></div>
        <div className="filters">
          <TenantFilter value={tenant} onChange={setTenant} />
        </div>
      </div>

      <div className="tiles">
        <div className="tile"><span className="label">Tables</span><strong>{fmt(shown.length)}</strong></div>
        <div className="tile"><span className="label">Rows</span><strong>{fmt(total)}</strong></div>
        <div className="tile"><span className="label">Largest table</span>
          <strong style={{ fontSize: 18 }}>{shown[0]?.table?.replace('stg.', '') || '–'}</strong>
          <div className="sub">{shown[0] ? `${fmt(shown[0].rows)} rows` : ''}</div></div>
      </div>

      {msg && <div className={`alert ${msg.bad ? 'bad' : 'good'}`} style={{ marginBottom: 16 }}>{msg.text}</div>}
      {empty && (
        <div className="alert" style={{ marginBottom: 16 }}>
          Counts are recorded after each load. For data loaded before this page existed, pick a tenant and click Recount.
        </div>
      )}

      <section className="card stack">
        <div className="row">
          <input className="grow" placeholder="Search SQL or D365 table…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="row tight">
            <button onClick={recount} disabled={!tenant || busy} title={tenant ? '' : 'Pick a tenant first'}>
              {busy ? 'Counting…' : 'Recount'}
            </button>
            <button onClick={exportCsv} disabled={!shown.length}>Export CSV</button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Table</th><th>D365 Table</th>{!tenant && <th>Tenant</th>}<th className="num">Rows</th>
              <th className="num">Last load</th><th>Last loaded</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={`${r.tenant_key}-${r.table}`}>
                  <td>{r.table}</td><td className="small">{r.entity}</td>{!tenant && <td className="small">{r.tenant}</td>}
                  <td className="num">{fmt(r.rows)}</td>
                  <td className="num small muted">{r.last_loaded_rows == null ? '' : fmt(r.last_loaded_rows)}</td>
                  <td className="small">{fmtTime(r.last_loaded_at)}</td>
                </tr>
              ))}
            </tbody>
            {shown.length > 0 && (
              <tfoot><tr><td colSpan={tenant ? 2 : 3}>Total</td><td className="num">{fmt(total)}</td><td colSpan={2}></td></tr></tfoot>
            )}
          </table>
        </div>
      </section>
    </div>
  )
}
