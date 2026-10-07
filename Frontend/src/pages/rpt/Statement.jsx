import { Fragment, useEffect, useState } from 'react'
import { MotionCard, CountUp, motion, rowMotion, useReducedMotion } from '../../components/motion'
import { amountsIn, api } from '../../api'
import { DashFrame, downloadCsv } from '../dash/common'
import { AdjNotice, BASIS_NOTE, BasisPicker, fsNum, ReportHead, ScopePicker, useReportScope } from './common'

const INFO = {
  IS: { title: 'Income Statement', long: 'Statement of profit or loss and other comprehensive income',
        sub: 'Profit or loss and other comprehensive income, laid out like the audited financial statements', dash: '#/dashboards/profit-loss' },
  BS: { title: 'Financial Position', long: 'Statement of financial position',
        sub: 'Assets, equity and liabilities at the end of the chosen month', dash: '#/dashboards/balance-sheet' },
}

function change(cur, prev) {
  if (!prev || Math.abs(prev) < 0.5) return ''
  const p = ((cur - prev) / Math.abs(prev)) * 100
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`
}

export default function Statement({ kind }) {
  const info = INFO[kind]
  const scope = useReportScope()
  const { tenant, co, year, month, ready, setError, basis } = scope
  const [d, setD] = useState(null)
  const [open, setOpen] = useState({})
  const reduce = useReducedMotion()

  useEffect(() => {
    if (!ready) return
    setD(null)
    api('fs/statement', { tenant, company: co, year, month, kind, basis }).then(setD).catch((e) => setError(e.message))
  }, [tenant, co, year, month, kind, basis]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }))
  const expandAll = (on) => setOpen(on ? Object.fromEntries(d.rows.filter((r) => r.kind === 'L').map((r) => [r.code, true])) : {})

  const exportCsv = () => {
    const out = []
    d.rows.forEach((r) => {
      out.push([r.kind === 'T' ? r.label.toUpperCase() : r.label, '', '', r.cur ?? '', r.prev ?? ''])
      ;(r.notes || []).forEach((n) => {
        out.push(['', n.note, '', n.cur, n.prev])
        n.accounts.forEach((a) => out.push(['', '', `${a.main_account} ${a.account_name}`, a.cur, a.prev]))
      })
    })
    downloadCsv(`${info.title.replace(/ /g, '_').toLowerCase()}_${co === '*' ? 'all' : co}_${year}_${month}.csv`,
      ['Line', 'Note', 'Account', d.headings[0], d.headings[1]], out)
  }

  return (
    <DashFrame title={info.title} subtitle={info.sub} scope={scope} withMonth loading={!d} extra={<><ScopePicker scope={scope} /><BasisPicker scope={scope} /></>}>
      {d && <>
        {kind === 'BS' && Math.abs(d.check.cur) > 1 && (
          <div className="alert bad">Assets and equity + liabilities differ by {fsNum(d.check.cur)}. Check the account mapping (Reports › Mapping).</div>
        )}
        <AdjNotice s={d.adj_summary} basis={basis} kind={kind} year={year} combined={co === '*'} />
        {d.has_adjustments && (
          <div className="alert good">Includes posted adjustments{co === '*' && basis === 'final' ? ' and eliminations' : ''} - see Adjustments › Adjusted Statements for the split.</div>
        )}
        {d.unmapped > 0 && (
          <div className="alert">{d.unmapped} account(s) are not in the FS mapping and sit on “not mapped” lines. Map them under Reports › Mapping.</div>
        )}
        <MotionCard as="section" hover={false} className="card fs-card">
          <div className="row fs-tools no-print">
            <button onClick={() => expandAll(true)}>Expand all</button>
            <button onClick={() => expandAll(false)}>Collapse all</button>
            <span className="grow" />
            <a className="link" href={info.dash}>Open the {kind === 'IS' ? 'Profit & Loss' : 'Balance Sheet'} dashboard ›</a>
            <button className="export-only" onClick={() => window.print()}>Print / PDF</button>
            <button className="export-only" onClick={exportCsv}>Export CSV</button>
          </div>
          <ReportHead scope={scope} title={`${info.long} ${kind === 'IS' ? `for the period ended ${d.headings[0]}` : `as at ${d.headings[0]}`}`}
                      note={`${amountsIn()} · ${BASIS_NOTE[basis]}`} />
          <div className="table-wrap">
            <table className="fs">
              <thead><tr><th /><th className="num">{d.headings[0]}</th><th className="num">{d.headings[1]}</th><th className="num">Change</th></tr></thead>
              <tbody>
                {d.rows.map((r, i) => {
                  if (r.kind === 'H') return <motion.tr key={r.code} className="fs-h" {...rowMotion(i, reduce)}><td colSpan={4}>{r.label}</td></motion.tr>
                  if (r.kind === 'T') {
                    return (
                      <motion.tr key={r.code} className={`fs-t ${['TCI', 'TEL', 'TA', 'PFY'].includes(r.code) ? 'fs-grand' : ''}`} {...rowMotion(i, reduce)}>
                        <td>{r.label}</td><td className="num"><CountUp value={fsNum(r.cur)} /></td><td className="num"><CountUp value={fsNum(r.prev)} /></td>
                        <td className="num muted">{change(r.cur, r.prev)}</td>
                      </motion.tr>
                    )
                  }
                  const has = r.notes?.length > 0
                  return (
                    <Fragment key={r.code}>
                      <motion.tr className={`fs-l ${has ? 'clickable' : ''}`} onClick={() => has && toggle(r.code)} {...rowMotion(i, reduce)}>
                        <td><span className="tw">{has ? (open[r.code] ? '▾' : '▸') : ''}</span>{r.label}</td>
                        <td className="num">{fsNum(r.cur)}</td><td className="num">{fsNum(r.prev)}</td>
                        <td className="num muted">{change(r.cur, r.prev)}</td>
                      </motion.tr>
                      {open[r.code] && r.notes.map((n) => (
                        <Fragment key={n.note}>
                          <motion.tr className="fs-n clickable" onClick={() => toggle(`${r.code}|${n.note}`)} initial={reduce ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
                            <td><span className="tw">{n.accounts.length ? (open[`${r.code}|${n.note}`] ? '▾' : '▸') : ''}</span>{n.note}</td>
                            <td className="num">{fsNum(n.cur)}</td><td className="num">{fsNum(n.prev)}</td><td />
                          </motion.tr>
                          {open[`${r.code}|${n.note}`] && n.accounts.map((a) => (
                            <motion.tr key={a.main_account} className="fs-a" initial={reduce ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}>
                              <td title={`Mapped by: ${a.source}`}><span data-no-tr>{a.main_account}</span> {a.account_name}</td>
                              <td className="num">{fsNum(a.cur)}</td><td className="num">{fsNum(a.prev)}</td><td />
                            </motion.tr>
                          ))}
                        </Fragment>
                      ))}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          {kind === 'BS' && <p className="muted small">Retained earnings include profit and OCI not yet closed by the D365 year-end close. Check: {fsNum(d.check.cur)}.</p>}
          <p className="muted small no-print">Click a line to see its notes, and a note to see the ledger accounts. Year-end closing entries are left out.</p>
        </MotionCard>
      </>}
    </DashFrame>
  )
}
