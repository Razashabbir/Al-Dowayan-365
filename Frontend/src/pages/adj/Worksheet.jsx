import { Fragment, useEffect, useState } from 'react'
import { api } from '../../api'
import { MotionCard, motion, rowMotion, useReducedMotion } from '../../components/motion'
import { DashFrame, downloadCsv } from '../dash/common'
import { AdjNotice, fsNum, ReportHead, ScopePicker, useReportScope } from '../rpt/common'

const TABS = [['IS', 'Profit & Loss'], ['BS', 'Financial Position'], ['CF', 'Cash Flow']]

/** Consolidation-style worksheet: D365 ledger, adjustments, eliminations and final figure for every line of
    the Profit & Loss, Financial Position and Cash Flow (like the CONSO mapping workbook). */
export default function Worksheet() {
  const scope = useReportScope()
  const { tenant, co, year, month, ready, setError, combined } = scope
  const [tab, setTab] = useState('IS')
  const [d, setD] = useState(null)
  const [open, setOpen] = useState({})
  const [only, setOnly] = useState(false)
  const reduce = useReducedMotion()

  useEffect(() => {
    if (!ready) return
    setD(null); setOpen({})
    const p = { tenant, company: co, year, month, basis: 'final' }
    const req = tab === 'CF' ? api('fs/cashflow', p) : api('fs/statement', { ...p, kind: tab })
    req.then(setD).catch((e) => setError(e.message))
  }, [tenant, co, year, month, tab]) // eslint-disable-line react-hooks/exhaustive-deps

  const showElim = combined
  const cols = ['ledger', 'adj', ...(showElim ? ['elim'] : [])]
  const changed = (r) => r.parts && (Math.abs(r.parts.adj) > 0.5 || Math.abs(r.parts.elim || 0) > 0.5)
  const rows = d ? d.rows.filter((r) => !only || r.kind !== 'L' || changed(r)) : []
  const exportCsv = () => downloadCsv(`adjusted_${tab}_${co === '*' ? 'all' : co}_${year}_${month}.csv`,
    ['Line', 'D365 ledger', 'Adjustments', ...(showElim ? ['Eliminations'] : []), 'Final', `Final ${d.headings[1]}`],
    d.rows.filter((r) => r.kind !== 'H').map((r) => [r.label, ...cols.map((c) => r.parts[c]), r.cur, r.prev]))

  return (
    <DashFrame title="Adjusted Statements" subtitle="D365 ledger + adjustments (+ eliminations for all companies) = final, line by line"
               scope={scope} withMonth loading={false} extra={<ScopePicker scope={scope} />}>
      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {!d && <div className="card muted">Loading…</div>}
      {d && <AdjNotice s={d.adj_summary} basis="final" kind={tab} year={year} combined={combined} />}
      {d && (
        <MotionCard as="section" hover={false} className="card fs-card">
          <div className="row fs-tools no-print">
            <label className="check"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Only lines with adjustments</label>
            <span className="grow" />
            <button className="export-only" onClick={() => window.print()}>Print / PDF</button>
            <button className="export-only" onClick={exportCsv}>Export CSV</button>
          </div>
          <ReportHead scope={scope} title={`${TABS.find((t) => t[0] === tab)[1]} worksheet - ${d.headings[0]}`}
                      note={`Posted entries only. Ledger, adjustments${showElim ? ', eliminations' : ''} and final are ${d.headings[0]}; the last column is the same period of the previous year (final figures).`} />
          <div className="table-wrap">
            <table className="fs worksheet">
              <thead>
                <tr className="ws-group">
                  <th />
                  <th colSpan={cols.length + 1} className="center">Current period · {d.headings[0]}</th>
                  <th className="center ws-comp">Comparative</th>
                </tr>
                <tr><th /><th className="num">D365 ledger</th><th className="num">Adjustments</th>
                  {showElim && <th className="num">Eliminations</th>}<th className="num">Final</th>
                  <th className="num ws-comp">{d.headings[1]}</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  if (r.kind === 'H') return <motion.tr key={r.code} className="fs-h" {...rowMotion(i, reduce)}><td colSpan={cols.length + 3}>{r.label}</td></motion.tr>
                  const accts = (r.notes || []).flatMap((n) => n.accounts.filter((a) => Math.abs(a.parts.adj) > 0.5 || Math.abs(a.parts.elim) > 0.5))
                  const can = r.kind === 'L' && accts.length > 0
                  return (
                    <Fragment key={r.code}>
                      <motion.tr className={`${r.kind === 'T' ? 'fs-t' : 'fs-l'} ${can ? 'clickable' : ''} ${changed(r) ? 'ws-changed' : ''}`}
                                 onClick={() => can && setOpen((o) => ({ ...o, [r.code]: !o[r.code] }))} {...rowMotion(i, reduce)}>
                        <td>{r.kind === 'L' && <span className="tw">{can ? (open[r.code] ? '▾' : '▸') : ''}</span>}{r.label}</td>
                        {cols.map((c) => <td key={c} className={`num ${c !== 'ledger' && Math.abs(r.parts[c]) > 0.5 ? 'ws-adj' : ''}`}>{fsNum(r.parts[c])}</td>)}
                        <td className="num strong">{fsNum(r.cur)}</td><td className="num muted ws-comp">{fsNum(r.prev)}</td>
                      </motion.tr>
                      {open[r.code] && accts.map((a) => (
                        <tr key={a.main_account} className="fs-a">
                          <td><span data-no-tr>{a.main_account}</span> {a.account_name}</td>
                          {cols.map((c) => <td key={c} className="num">{fsNum(a.parts[c])}</td>)}
                          <td className="num">{fsNum(a.cur)}</td><td className="ws-comp" />
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          {d.check && Math.abs(d.check.cur) > 1 && <div className="alert bad">Out of balance by {fsNum(d.check.cur)}.</div>}
          <p className="muted small">Click a line to see the accounts and entries behind its adjustments. Entries are made under Adjustments › Adjustments & Eliminations.</p>
        </MotionCard>
      )}
    </DashFrame>
  )
}
