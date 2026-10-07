import { useEffect, useState } from 'react'
import { MotionCard } from '../../components/motion'
import { Bar, ComposedChart, Line } from 'recharts'
import { api, MONTHS } from '../../api'
import { ChartBox, Change, DashFrame, downloadCsv, fmt, monthRows, Tile, useDashScope } from './common'

export default function ProfitLoss() {
  const scope = useDashScope()
  const { tenant, company, year, ready, setError } = scope
  const [d, setD] = useState(null)

  useEffect(() => {
    if (!ready) return
    setD(null)
    api('pnl', { tenant, company, year }).then(setD).catch((e) => setError(e.message))
  }, [tenant, company, year]) // eslint-disable-line react-hooks/exhaustive-deps

  const t = d?.totals
  // months after the last month with any posting are shown blank, not 0
  const lastM = d ? d.revenue.reduce((m, v, i) => (v || d.expenses[i] ? i : m), -1) : -1
  const upto = (arr) => arr.map((v, i) => (i <= lastM ? v : null))
  const exportCsv = () => downloadCsv(`profit_and_loss_${company}_${year}.csv`,
    ['Group', 'Account', 'Name', ...MONTHS, 'Total', `Total ${year - 1}`],
    d.lines.map((l) => [l.group, l.main_account, l.account_name, ...l.months.map((v) => v.toFixed(2)), l.total.toFixed(2), l.prev_total.toFixed(2)]))

  const section = (group, label) => {
    const lines = d.lines.filter((l) => l.group === group)
    const sum = (i) => lines.reduce((s, l) => s + l.months[i], 0)
    return (
      <>
        <tr className="group-row"><td colSpan={16}>{label}</td></tr>
        {lines.map((l) => (
          <tr key={l.main_account}>
            <td>{l.main_account}</td><td className="ellipsis" title={l.account_name}>{l.account_name}</td>
            {l.months.map((v, i) => <td key={i} className="num">{v ? fmt(v) : ''}</td>)}
            <td className="num strong">{fmt(l.total)}</td><td className="num muted">{fmt(l.prev_total)}</td>
          </tr>
        ))}
        <tr className="subtotal">
          <td colSpan={2}>Total {label.toLowerCase()}</td>
          {MONTHS.map((_, i) => <td key={i} className="num">{i <= lastM ? fmt(sum(i)) : ''}</td>)}
          <td className="num">{fmt(lines.reduce((s, l) => s + l.total, 0))}</td>
          <td className="num muted">{fmt(lines.reduce((s, l) => s + l.prev_total, 0))}</td>
        </tr>
      </>
    )
  }

  return (
    <DashFrame title="Profit & Loss" subtitle="Income statement by month" scope={scope} loading={!d}>
      {d && <>
        <div className="tiles">
          <Tile label={`Revenue ${year}`} value={fmt(t.revenue)} sub={<Change cur={t.revenue} prev={t.prev_revenue} />} />
          <Tile label={`Expenses ${year}`} value={fmt(t.expenses)} sub={<Change cur={t.expenses} prev={t.prev_expenses} invert />} />
          <Tile label={`Net profit ${year}`} value={fmt(t.net)} tone={t.net < 0 ? 'down' : ''} sub={<Change cur={t.net} prev={t.prev_net} />} />
          <Tile label="Net margin" value={t.revenue ? `${(t.net / t.revenue * 100).toFixed(1)}%` : '–'} />
        </div>
        <MotionCard as="section" hover={false} className="card">
          <ChartBox title="Monthly revenue, expenses and net profit" three={{ data: monthRows({ revenue: upto(d.revenue), expenses: upto(d.expenses) }), series: [{ key: 'revenue', name: 'Revenue' }, { key: 'expenses', name: 'Expenses' }] }}>
            {(c) => (
              <ComposedChart data={monthRows({ revenue: upto(d.revenue), expenses: upto(d.expenses), net: upto(d.net) })}>
                {c.grid}{c.x()}{c.y}{c.tip}{c.legend}
                <Bar dataKey="revenue" name="Revenue" fill="var(--c1)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" name="Expenses" fill="var(--c2)" radius={[4, 4, 0, 0]} />
                <Line dataKey="net" name="Net profit" stroke="var(--c3)" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            )}
          </ChartBox>
        </MotionCard>
        <MotionCard as="section" hover={false} className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <h2>Income statement {year}</h2>
            <span className="grow" />
            <a className="link" href="#/reports/income-statement">Statutory income statement (Reports) ›</a>
            <button className="export-only" onClick={exportCsv}>Export CSV</button>
          </div>
          <div className="table-wrap statement">
            <table>
              <thead><tr><th>Account</th><th>Name</th>{MONTHS.map((m) => <th key={m} className="num">{m}</th>)}
                <th className="num">Total</th><th className="num">{year - 1}</th></tr></thead>
              <tbody>
                {section('Revenue', 'Revenue')}
                {section('Expense', 'Expenses')}
              </tbody>
              <tfoot>
                <tr><td colSpan={2}>Net profit</td>{d.net.map((v, i) => <td key={i} className={`num ${v < 0 ? 'down' : ''}`}>{i <= lastM ? fmt(v) : ''}</td>)}
                  <td className={`num ${t.net < 0 ? 'down' : ''}`}>{fmt(t.net)}</td><td className="num muted">{fmt(t.prev_net)}</td></tr>
              </tfoot>
            </table>
          </div>
        </MotionCard>
      </>}
    </DashFrame>
  )
}
