import { useEffect, useState } from 'react'
import { MotionCard } from '../../components/motion'
import { Bar, BarChart, Line, LineChart, XAxis, YAxis } from 'recharts'
import { api, fmtShort } from '../../api'
import { ChartBox, Change, DashFrame, fmt, monthRows, Tile, useDashScope } from './common'

function RankBars({ title, rows, nameKey, labelOf }) {
  const data = rows.map((r) => ({ ...r, label: labelOf ? labelOf(r) : r[nameKey] }))
  return (
    <MotionCard as="section" hover={false} className="card">
      <ChartBox title={title} height={Math.max(220, data.length * 28 + 40)} legend={false}>
        {(c) => (
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
            <XAxis type="number" tickFormatter={fmtShort} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
            <YAxis type="category" dataKey="label" width={170} tick={{ fill: 'var(--muted)', fontSize: 11.5 }} />
            {c.tip}
            <Bar dataKey="amount" name="Amount" fill="var(--c2)" radius={[0, 4, 4, 0]} />
          </BarChart>
        )}
      </ChartBox>
      {!data.length && <p className="muted small">No expenses for this year.</p>}
    </MotionCard>
  )
}

export default function Expenses() {
  const scope = useDashScope()
  const { tenant, company, year, ready, setError } = scope
  const [d, setD] = useState(null)

  useEffect(() => {
    if (!ready) return
    setD(null)
    api('expenses', { tenant, company, year }).then(setD).catch((e) => setError(e.message))
  }, [tenant, company, year]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasDims = d && (d.dim2.some((r) => r.name !== '(none)') || d.dim3.some((r) => r.name !== '(none)'))
  const peak = d ? d.by_month.indexOf(Math.max(...d.by_month)) : 0

  return (
    <DashFrame title="Expense Analysis" subtitle="Where the money goes - by account, financial dimension and month" scope={scope} loading={!d}>
      {d && <>
        <div className="tiles">
          <Tile label={`Expenses ${year}`} value={fmt(d.total)} sub={<Change cur={d.total} prev={d.prev_total} invert />} />
          <Tile label="Monthly average" value={fmt(d.total / Math.max(1, d.by_month.filter((v) => v).length))} />
          <Tile label="Highest month" value={fmt(d.by_month[peak])} sub={['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][peak]} />
          <Tile label="Largest account" value={d.accounts[0] ? fmt(d.accounts[0].amount) : '–'} sub={d.accounts[0]?.account_name} />
        </div>
        <MotionCard as="section" hover={false} className="card">
          <ChartBox title={`Expenses by month - ${year} vs ${year - 1}`} three={{ data: monthRows({ cur: d.by_month, prev: d.prev_by_month }), series: [{ key: 'cur', name: String(year), color: '#d97706' }, { key: 'prev', name: String(year - 1), color: '#6366f1' }] }}>
            {(c) => (
              <LineChart data={monthRows({ cur: d.by_month.map((v, i) => (i <= d.by_month.reduce((m, x, j) => (x ? j : m), -1) ? v : null)), prev: d.prev_by_month })}>
                {c.grid}{c.x()}{c.y}{c.tip}{c.legend}
                <Line dataKey="cur" name={String(year)} stroke="var(--c2)" strokeWidth={2} dot={{ r: 3 }} />
                <Line dataKey="prev" name={String(year - 1)} stroke="var(--c3)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
              </LineChart>
            )}
          </ChartBox>
        </MotionCard>
        <div className="grid-2">
          <RankBars title="Top 15 expense accounts" rows={d.accounts} labelOf={(r) => `${r.main_account} ${r.account_name || ''}`.slice(0, 28)} />
          {hasDims
            ? <div>
                <RankBars title="By dimension 2 (e.g. cost centre)" rows={d.dim2} nameKey="name" />
                <RankBars title="By dimension 3 (e.g. department)" rows={d.dim3} nameKey="name" />
              </div>
            : <MotionCard as="section" hover={false} className="card"><h2>By financial dimension</h2>
                <p className="muted">Your ledger accounts carry no dimension segments (e.g. 600100-CC01-DEP02), so there is no cost-centre split.</p></MotionCard>}
        </div>
      </>}
    </DashFrame>
  )
}
