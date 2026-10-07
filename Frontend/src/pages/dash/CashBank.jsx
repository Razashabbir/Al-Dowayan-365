import { useEffect, useState } from 'react'
import { MotionCard } from '../../components/motion'
import { Area, AreaChart, Bar, BarChart, Line } from 'recharts'
import { api } from '../../api'
import { ChartBox, DashFrame, fmt, monthRows, Tile, useDashScope } from './common'

export default function CashBank() {
  const scope = useDashScope()
  const { tenant, company, year, ready, setError } = scope
  const [d, setD] = useState(null)

  useEffect(() => {
    if (!ready) return
    setD(null)
    api('cash', { tenant, company, year }).then(setD).catch((e) => setError(e.message))
  }, [tenant, company, year]) // eslint-disable-line react-hooks/exhaustive-deps

  const lastIdx = d ? Math.max(0, d.inflow.map((v, i) => (v || d.outflow[i] ? i : -1)).reduce((a, b) => Math.max(a, b), 0)) : 0
  const inT = d ? d.inflow.reduce((s, v) => s + v, 0) : 0
  const outT = d ? d.outflow.reduce((s, v) => s + v, 0) : 0

  return (
    <DashFrame title="Cash & Bank" subtitle="Cash position and money in / out" scope={scope} loading={!d}>
      {d && (!d.accounts.length
        ? <div className="alert">No cash or bank accounts found. This page uses ledger accounts whose name contains “bank” or “cash”.</div>
        : <>
          <div className="tiles">
            <Tile label="Cash & bank balance" value={fmt(d.balance[lastIdx])} sub={`end of ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][lastIdx]} ${year}`} />
            <Tile label={`Money in ${year}`} value={fmt(inT)} tone="up" />
            <Tile label={`Money out ${year}`} value={fmt(outT)} tone="down" />
            <Tile label="Net movement" value={fmt(inT - outT)} tone={inT - outT < 0 ? 'down' : 'up'} />
          </div>
          <div className="grid-2">
            <MotionCard as="section" hover={false} className="card">
              <ChartBox title="Cash & bank balance at month end" legend={false}>
                {(c) => (
                  <AreaChart data={monthRows({ balance: d.balance })}>
                    {c.grid}{c.x()}{c.y}{c.tip}
                    <Area dataKey="balance" name="Balance" stroke="var(--c1)" strokeWidth={2} fill="var(--c1)" fillOpacity={0.12} />
                  </AreaChart>
                )}
              </ChartBox>
            </MotionCard>
            <MotionCard as="section" hover={false} className="card">
              <ChartBox title="Money in vs money out" three={{ data: monthRows({ inflow: d.inflow, outflow: d.outflow }), series: [{ key: 'inflow', name: 'In' }, { key: 'outflow', name: 'Out' }] }}>
                {(c) => (
                  <BarChart data={monthRows({ inflow: d.inflow, outflow: d.outflow })}>
                    {c.grid}{c.x()}{c.y}{c.tip}{c.legend}
                    <Bar dataKey="inflow" name="In" fill="var(--c1)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="outflow" name="Out" fill="var(--c2)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                )}
              </ChartBox>
            </MotionCard>
          </div>
          <MotionCard as="section" hover={false} className="card">
            <h2>Cash & bank accounts</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Account</th><th>Name</th><th className="num">Balance end of {year}</th></tr></thead>
                <tbody>{d.accounts.map((a) => (
                  <tr key={a.main_account}><td>{a.main_account}</td><td>{a.account_name}</td><td className="num">{fmt(a.balance)}</td></tr>))}
                </tbody>
              </table>
            </div>
            <p className="muted small">{d.rule}.</p>
          </MotionCard>
        </>)}
    </DashFrame>
  )
}
