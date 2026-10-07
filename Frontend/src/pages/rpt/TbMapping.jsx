import { useEffect, useMemo, useState } from 'react'
import { MotionCard, motion, rowMotion, useReducedMotion } from '../../components/motion'
import { api } from '../../api'
import Pager, { paginate } from '../../components/Pager'
import { DashFrame, downloadCsv } from '../dash/common'
import { fsNum, ReportHead, ScopePicker, useReportScope } from './common'

/** Trial balance with the FS mapping - the same layout as the "TB25 Dec" working sheet. */
export default function TbMapping() {
  const scope = useReportScope()
  const { tenant, co, year, month, ready, setError } = scope
  const [rows, setRows] = useState(null)
  const reduce = useReducedMotion()
  const [q, setQ] = useState('')
  const [st, setSt] = useState('')
  const [line, setLine] = useState('')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(50)

  useEffect(() => {
    if (!ready) return
    setRows(null)
    api('fs/tb', { tenant, company: co, year, month }).then(setRows).catch((e) => setError(e.message))
  }, [tenant, co, year, month]) // eslint-disable-line react-hooks/exhaustive-deps

  const lines = useMemo(() => [...new Set((rows || []).map((r) => r.line))].sort(), [rows])
  const shown = useMemo(() => (rows || []).filter((r) =>
    (!st || r.statement === st) && (!line || r.line === line) &&
    `${r.main_account} ${r.account_name} ${r.line} ${r.note}`.toLowerCase().includes(q.toLowerCase())), [rows, q, st, line])
  const { pageRows, page: cur, pages } = paginate(shown, page, size)
  const sum = (k) => shown.reduce((s, r) => s + r[k], 0)
  const reset = (f) => (e) => { f(e.target.value); setPage(1) }

  return (
    <DashFrame title="Trial Balance Mapping" subtitle="Every ledger account with its opening, movements, closing balance and financial-statement line"
               scope={scope} withMonth loading={!rows} extra={<ScopePicker scope={scope} />}>
      {rows && (
        <MotionCard as="section" hover={false} className="card stack">
          <ReportHead scope={scope} title={`Trial balance and FS mapping - ${year}, to end of month ${month}`} />
          <div className="row no-print">
            <input className="grow" placeholder="Search account, line or note…" value={q} onChange={reset(setQ)} />
            <select value={st} onChange={reset(setSt)}>
              <option value="">Both statements</option><option value="BS">Balance sheet</option><option value="IS">Income statement</option>
            </select>
            <select value={line} onChange={reset(setLine)}>
              <option value="">All FS lines</option>{lines.map((l) => <option key={l}>{l}</option>)}
            </select>
            <button className="export-only" onClick={() => downloadCsv(`tb_mapping_${co === '*' ? 'all' : co}_${year}_${month}.csv`,
              ['Account', 'Description', 'Statement', 'FS line', 'Note', 'Mapped by', 'Opening', 'Debit', 'Credit', 'Closing'],
              shown.map((r) => [r.main_account, r.account_name, r.statement, r.line, r.note, r.source, r.opening, r.debit, r.credit, r.closing]))}>
              Export CSV</button>
          </div>
          <div className="table-wrap paged">
            <table>
              <thead><tr><th>Account</th><th>Description</th><th>FS line</th><th>Note</th><th>Mapped by</th>
                <th className="num">Opening</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Closing</th></tr></thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <motion.tr key={r.main_account} {...rowMotion(i, reduce)}>
                    <td data-no-tr>{r.main_account}</td><td className="ellipsis" title={r.account_name}>{r.account_name}</td>
                    <td><span className={`chip ${r.statement === 'IS' ? 'chip-is' : 'chip-bs'}`}>{r.statement}</span> {r.line}</td>
                    <td className="muted small">{r.note}</td>
                    <td className={`small ${r.source === 'Account range' ? 'warn-text' : 'muted'}`}>{r.source}</td>
                    <td className="num">{fsNum(r.opening)}</td><td className="num">{fsNum(r.debit)}</td>
                    <td className="num">{fsNum(r.credit)}</td><td className="num strong">{fsNum(r.closing)}</td>
                  </motion.tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={5}>Total ({shown.length} accounts) - should be zero for the whole TB</td>
                <td className="num">{fsNum(sum('opening'))}</td><td className="num">{fsNum(sum('debit'))}</td>
                <td className="num">{fsNum(sum('credit'))}</td><td className="num">{fsNum(sum('closing'))}</td></tr></tfoot>
            </table>
          </div>
          <Pager total={shown.length} page={cur} pages={pages} size={size} label="accounts"
                 onPage={setPage} onSize={(n) => { setSize(n); setPage(1) }} />
        </MotionCard>
      )}
    </DashFrame>
  )
}
