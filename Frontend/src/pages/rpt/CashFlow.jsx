import { useEffect, useState } from 'react'
import { amountsIn, api } from '../../api'
import { CountUp, MotionCard, motion, rowMotion, useReducedMotion } from '../../components/motion'
import { DashFrame, downloadCsv } from '../dash/common'
import { AdjNotice, BASIS_NOTE, BasisPicker, fsNum, ReportHead, ScopePicker, useReportScope } from './common'

/** Statement of cash flows (indirect method), from the same data as the Income Statement and Financial Position. */
export default function CashFlow() {
  const scope = useReportScope()
  const { tenant, co, year, month, ready, setError, basis } = scope
  const [d, setD] = useState(null)
  const reduce = useReducedMotion()

  useEffect(() => {
    if (!ready) return
    setD(null)
    api('fs/cashflow', { tenant, company: co, year, month, basis }).then(setD).catch((e) => setError(e.message))
  }, [tenant, co, year, month, basis]) // eslint-disable-line react-hooks/exhaustive-deps

  const exportCsv = () => downloadCsv(`cash_flow_${co === '*' ? 'all' : co}_${year}_${month}.csv`, ['Line', d.headings[0], d.headings[1]],
    d.rows.map((r) => [r.kind === 'T' ? r.label.toUpperCase() : r.label, r.cur ?? '', r.prev ?? '']))

  return (
    <DashFrame title="Cash Flow" subtitle="Statement of cash flows - indirect method, from the movement of every balance-sheet line"
               scope={scope} withMonth loading={!d} extra={<><ScopePicker scope={scope} /><BasisPicker scope={scope} /></>}>
      {d && <>
        {Math.abs(d.check.cur) > 1 && (
          <div className="alert bad">Cash at the end differs from the balance sheet by {fsNum(d.check.cur)} - the balance sheet is not balanced. Check Reports › FS Mapping.</div>
        )}
        <AdjNotice s={d.adj_summary} basis={basis} kind={'CF'} year={year} combined={co === '*'} />
        {d.has_adjustments && <div className="alert good">Includes posted adjustments{co === '*' && basis === 'final' ? ' and eliminations' : ''}.</div>}
        <MotionCard as="section" hover={false} className="card fs-card">
          <div className="row fs-tools no-print">
            <span className="grow" />
            <button className="export-only" onClick={() => window.print()}>Print / PDF</button>
            <button className="export-only" onClick={exportCsv}>Export CSV</button>
          </div>
          <ReportHead scope={scope} title={`Statement of cash flows for the period ended ${d.headings[0]}`}
                      note={`${amountsIn()} · ${BASIS_NOTE[basis]}`} />
          <div className="table-wrap">
            <table className="fs">
              <thead><tr><th /><th className="num">{d.headings[0]}</th><th className="num">{d.headings[1]}</th></tr></thead>
              <tbody>
                {d.rows.map((r, i) => {
                  if (r.kind === 'H') return <motion.tr key={r.code} className="fs-h" {...rowMotion(i, reduce)}><td colSpan={3}>{r.label}</td></motion.tr>
                  const grand = ['CF_NET_OP', 'CF_NET_INV', 'CF_NET_FIN', 'CF_END'].includes(r.code)
                  return (
                    <motion.tr key={r.code} className={r.kind === 'T' ? `fs-t ${grand ? 'fs-grand' : ''}` : 'fs-l'} {...rowMotion(i, reduce)}>
                      <td>{r.label}</td>
                      <td className="num">{r.kind === 'T' ? <CountUp value={fsNum(r.cur)} /> : fsNum(r.cur)}</td>
                      <td className="num">{fsNum(r.prev)}</td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">Indirect method: profit before zakat, non-cash items, then the change of every balance-sheet line between
            31 Dec {year - 1} and the end of the chosen month. Cash at the end agrees to the Financial Position{Math.abs(d.check.cur) <= 1 ? ' ✓' : ''}.</p>
        </MotionCard>
      </>}
    </DashFrame>
  )
}
