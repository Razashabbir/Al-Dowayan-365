import { useEffect, useState } from 'react'
import { MotionCard } from '../../components/motion'
import { api } from '../../api'
import { Change, DashFrame, downloadCsv, fmt, Tile, useDashScope } from './common'

function Section({ title, rows, extra = [], total, prevTotal }) {
  return (
    <MotionCard as="section" hover={false} className="card">
      <h2>{title}</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Account</th><th>Name</th><th className="num">Balance</th><th className="num">Last year</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.main_account}><td>{r.main_account}</td><td className="ellipsis" title={r.account_name}>{r.account_name}</td>
                <td className="num">{fmt(r.balance)}</td><td className="num muted">{fmt(r.prev_balance)}</td></tr>
            ))}
            {extra.map((r) => (
              <tr key={r.label} className="computed"><td colSpan={2}>{r.label}</td>
                <td className="num">{fmt(r.value)}</td><td className="num muted">{fmt(r.prev)}</td></tr>
            ))}
            {!rows.length && !extra.length && <tr><td colSpan={4} className="muted">No balances.</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={2}>Total {title.toLowerCase()}</td><td className="num">{fmt(total)}</td><td className="num muted">{fmt(prevTotal)}</td></tr></tfoot>
        </table>
      </div>
    </MotionCard>
  )
}

export default function BalanceSheet() {
  const scope = useDashScope()
  const { tenant, company, year, month, ready, setError } = scope
  const [d, setD] = useState(null)

  useEffect(() => {
    if (!ready) return
    setD(null)
    api('balance-sheet', { tenant, company, year, month }).then(setD).catch((e) => setError(e.message))
  }, [tenant, company, year, month]) // eslint-disable-line react-hooks/exhaustive-deps

  const t = d?.totals
  const e = d?.earnings
  const liabTotal = t ? t.liabilities : 0
  const exportCsv = () => downloadCsv(`balance_sheet_${company}_${d.as_of}.csv`, ['Group', 'Account', 'Name', 'Balance', 'Last year'],
    Object.entries(d.groups).flatMap(([g, rows]) => rows.map((r) => [g, r.main_account, r.account_name, r.balance.toFixed(2), r.prev_balance.toFixed(2)])))

  return (
    <DashFrame title="Balance Sheet" subtitle="Assets, liabilities and equity at month end" scope={scope} withMonth loading={!d}>
      {d && <>
        <div className="tiles">
          <Tile label={`Total assets · ${d.as_of}`} value={fmt(t.assets)} sub={<Change cur={t.assets} prev={t.prev_assets} />} />
          <Tile label="Total liabilities" value={fmt(t.liabilities)} sub={<Change cur={t.liabilities} prev={t.prev_liabilities} invert />} />
          <Tile label="Total equity" value={fmt(t.equity)} sub={<Change cur={t.equity} prev={t.prev_equity} />} />
          <Tile label="Assets − liabilities − equity" value={fmt(t.difference)}
                tone={Math.abs(t.difference) > 1 ? 'down' : 'up'}
                sub={Math.abs(t.difference) > 1 ? 'Not balanced - check account types' : 'Balanced'} />
        </div>
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="muted small">Compared with {d.prev_as_of}. Profit and loss accounts are shown as earnings inside equity.</span>
          <a className="link" href="#/reports/balance-sheet">Statement of financial position (Reports) ›</a>
          <button className="export-only" onClick={exportCsv}>Export CSV</button>
        </div>
        <div className="grid-2">
          <Section title="Assets" rows={d.groups.Asset || []} total={t.assets} prevTotal={t.prev_assets} />
          <div>
            <Section title="Liabilities" rows={d.groups.Liability || []} total={liabTotal} prevTotal={t.prev_liabilities} />
            <Section title="Equity" rows={d.groups.Equity || []}
                     extra={[{ label: 'Retained earnings (earlier years)', value: e.retained, prev: e.prev_retained },
                       { label: 'Current year earnings', value: e.current, prev: e.prev_current }]}
                     total={t.equity} prevTotal={t.prev_equity} />
          </div>
        </div>
      </>}
    </DashFrame>
  )
}
