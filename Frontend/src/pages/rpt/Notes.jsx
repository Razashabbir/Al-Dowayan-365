import { Fragment, useEffect, useState } from 'react'
import { MotionCard, motion } from '../../components/motion'
import { api } from '../../api'
import { DashFrame, downloadCsv } from '../dash/common'
import { fsNum, ReportHead, ScopePicker, useReportScope } from './common'

/** Notes to the statements: every statement line broken down by its note lines (and accounts on click). */
export default function Notes() {
  const scope = useReportScope()
  const { tenant, co, year, month, ready, setError } = scope
  const [d, setD] = useState(null)
  const [open, setOpen] = useState({})

  useEffect(() => {
    if (!ready) return
    setD(null)
    const p = { tenant, company: co, year, month }
    Promise.all([api('fs/statement', { ...p, kind: 'BS' }), api('fs/statement', { ...p, kind: 'IS' })])
      .then(([bs, is]) => setD({ bs, is })).catch((e) => setError(e.message))
  }, [tenant, co, year, month]) // eslint-disable-line react-hooks/exhaustive-deps

  const notes = d ? [...d.bs.rows.map((r) => ({ ...r, st: d.bs })), ...d.is.rows.map((r) => ({ ...r, st: d.is }))]
    .filter((r) => r.kind === 'L' && r.notes?.length) : []

  const exportCsv = () => downloadCsv(`fs_notes_${co === '*' ? 'all' : co}_${year}_${month}.csv`,
    ['Note', 'Line', 'Account', 'Current', 'Comparative'],
    notes.flatMap((r, i) => r.notes.flatMap((n) => [[`${i + 1}. ${r.label}`, n.note, '', n.cur, n.prev],
      ...n.accounts.map((a) => [`${i + 1}. ${r.label}`, n.note, `${a.main_account} ${a.account_name}`, a.cur, a.prev])])))

  return (
    <DashFrame title="Notes to the Statements" subtitle="Breakdown of every statement line by note line and ledger account"
               scope={scope} withMonth loading={!d} extra={<ScopePicker scope={scope} />}>
      {d && <>
        <div className="row no-print" style={{ marginBottom: 12 }}>
          <span className="grow" />
          <button className="export-only" onClick={() => window.print()}>Print / PDF</button>
          <button className="export-only" onClick={exportCsv}>Export CSV</button>
        </div>
        <ReportHead scope={scope} title="Notes to the financial statements" />
        <div className="notes-grid">
          {notes.map((r, i) => (
            <MotionCard as="section" hover={false} key={`${r.st.kind}-${r.code}`} className="card fs-card">
              <h2><span className="note-no">{i + 1}</span> {r.label}</h2>
              <table className="fs">
                <thead><tr><th /><th className="num">{r.st.headings[0]}</th><th className="num">{r.st.headings[1]}</th></tr></thead>
                <tbody>
                  {r.notes.map((n) => {
                    const k = `${r.code}|${n.note}`
                    return (
                      <Fragment key={n.note}>
                        <tr className="fs-l clickable" onClick={() => setOpen((o) => ({ ...o, [k]: !o[k] }))}>
                          <td><span className="tw">{n.accounts.length ? (open[k] ? '▾' : '▸') : ''}</span>{n.note}</td>
                          <td className="num">{fsNum(n.cur)}</td><td className="num">{fsNum(n.prev)}</td>
                        </tr>
                        {open[k] && n.accounts.map((a) => (
                          <motion.tr key={a.main_account} className="fs-a" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}><td><span data-no-tr>{a.main_account}</span> {a.account_name}</td>
                            <td className="num">{fsNum(a.cur)}</td><td className="num">{fsNum(a.prev)}</td></motion.tr>
                        ))}
                      </Fragment>
                    )
                  })}
                  <tr className="fs-t"><td>Total</td><td className="num">{fsNum(r.cur)}</td><td className="num">{fsNum(r.prev)}</td></tr>
                </tbody>
              </table>
            </MotionCard>
          ))}
        </div>
      </>}
    </DashFrame>
  )
}
