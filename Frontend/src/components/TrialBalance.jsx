import TypeBadge from './TypeBadge'
import { useMemo, useState } from 'react'
import { fmt } from '../api'

export default function TrialBalance({ rows, year }) {
  const [q, setQ] = useState('')
  const shown = useMemo(
    () => rows.filter((r) => `${r.main_account} ${r.account_name}`.toLowerCase().includes(q.toLowerCase())),
    [rows, q]
  )
  const total = (k) => shown.reduce((s, r) => s + Number(r[k] || 0), 0)

  const exportCsv = () => {
    const head = 'Account,Name,Type,Debit,Credit,Balance'
    const body = shown.map((r) => [r.main_account, `"${r.account_name || ''}"`, r.account_type, r.debit, r.credit, r.balance].join(','))
    const url = URL.createObjectURL(new Blob([[head, ...body].join('\n')], { type: 'text/csv' }))
    Object.assign(document.createElement('a'), { href: url, download: `trial_balance_${year}.csv` }).click()
  }

  return (
    <>
      <div className="row">
        <h2>Trial balance — year to date {year}</h2>
        <div className="row">
          <input placeholder="Search account…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button onClick={exportCsv}>Export CSV</button>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Account</th><th>Name</th><th>Type</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.main_account}>
                <td>{r.main_account}</td><td>{r.account_name}</td><td><TypeBadge type={r.account_type} /></td>
                <td className="num">{fmt(r.debit)}</td><td className="num">{fmt(r.credit)}</td>
                <td className={`num ${r.balance < 0 ? 'down' : ''}`}>{fmt(r.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={3}>Total</td><td className="num">{fmt(total('debit'))}</td><td className="num">{fmt(total('credit'))}</td><td className="num">{fmt(total('balance'))}</td></tr>
          </tfoot>
        </table>
      </div>
    </>
  )
}
