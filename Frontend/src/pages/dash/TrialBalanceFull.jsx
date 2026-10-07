import { useEffect, useMemo, useState } from 'react'
import { MotionCard, motion, rowMotion, useReducedMotion } from '../../components/motion'
import { api } from '../../api'
import Pager, { paginate } from '../../components/Pager'
import TypeBadge from '../../components/TypeBadge'
import { DashFrame, downloadCsv, fmt, Tile, useDashScope } from './common'

export default function TrialBalanceFull() {
  const scope = useDashScope()
  const { tenant, company, year, month, ready, setError } = scope
  const [rows, setRows] = useState(null)
  const reduce = useReducedMotion()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(50)

  useEffect(() => {
    if (!ready) return
    setRows(null)
    api('trial-balance-full', { tenant, company, year, month }).then(setRows).catch((e) => setError(e.message))
  }, [tenant, company, year, month]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => (rows || []).filter((r) =>
    `${r.main_account} ${r.account_name || ''}`.toLowerCase().includes(q.toLowerCase())), [rows, q])
  const sum = (k) => shown.reduce((s, r) => s + Number(r[k] || 0), 0)
  const { pageRows, page: cur, pages } = paginate(shown, page, size)
  const debit = sum('debit'), credit = sum('credit')

  return (
    <DashFrame title="Trial Balance" subtitle="Opening balance, movements this year and closing balance per account"
               scope={scope} withMonth loading={!rows}>
      {rows && <>
        <div className="tiles">
          <Tile label="Accounts with balances" value={fmt(rows.length)} />
          <Tile label="Debits (year to date)" value={fmt(debit)} />
          <Tile label="Credits (year to date)" value={fmt(credit)} />
          <Tile label="Debits − credits" value={fmt(debit - credit)} tone={Math.abs(debit - credit) > 1 ? 'down' : 'up'}
                sub={Math.abs(debit - credit) > 1 ? 'Out of balance' : 'In balance'} />
        </div>
        <MotionCard as="section" hover={false} className="card stack">
          <div className="row">
            <input className="grow" placeholder="Search account…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
            <button className="export-only" onClick={() => downloadCsv(`trial_balance_${company}_${year}_${month}.csv`,
              ['Account', 'Name', 'Type', 'Opening', 'Debit', 'Credit', 'Closing'],
              shown.map((r) => [r.main_account, r.account_name, r.account_type, r.opening, r.debit, r.credit, r.closing]))}>Export CSV</button>
          </div>
          <div className="table-wrap paged">
            <table>
              <thead><tr><th>Account</th><th>Name</th><th>Type</th><th className="num">Opening</th>
                <th className="num">Debit</th><th className="num">Credit</th><th className="num">Closing</th></tr></thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <motion.tr key={r.main_account} {...rowMotion(i, reduce)}>
                    <td>{r.main_account}</td><td className="ellipsis" title={r.account_name}>{r.account_name}</td>
                    <td><TypeBadge type={r.account_type} /></td>
                    <td className="num">{fmt(r.opening)}</td><td className="num">{fmt(r.debit)}</td>
                    <td className="num">{fmt(r.credit)}</td><td className={`num strong ${r.closing < 0 ? 'down' : ''}`}>{fmt(r.closing)}</td>
                  </motion.tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3}>Total ({shown.length} accounts)</td><td className="num">{fmt(sum('opening'))}</td>
                <td className="num">{fmt(debit)}</td><td className="num">{fmt(credit)}</td><td className="num">{fmt(sum('closing'))}</td></tr></tfoot>
            </table>
          </div>
          <Pager total={shown.length} page={cur} pages={pages} size={size} label="accounts"
                 onPage={setPage} onSize={(n) => { setSize(n); setPage(1) }} />
        </MotionCard>
      </>}
    </DashFrame>
  )
}
