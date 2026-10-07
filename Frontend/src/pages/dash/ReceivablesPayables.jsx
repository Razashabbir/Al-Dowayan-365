import { useEffect, useState } from 'react'
import { MotionCard } from '../../components/motion'
import { Line, LineChart } from 'recharts'
import { api } from '../../api'
import { ChartBox, DashFrame, fmt, monthRows, Tile, useDashScope } from './common'

function AccountTable({ title, rows }) {
  return (
    <MotionCard as="section" hover={false} className="card">
      <h2>{title}</h2>
      {rows.length
        ? <div className="table-wrap"><table>
            <thead><tr><th>Account</th><th>Name</th><th className="num">Balance</th></tr></thead>
            <tbody>{rows.map((a) => <tr key={a.main_account}><td>{a.main_account}</td><td>{a.account_name}</td><td className="num">{fmt(a.balance)}</td></tr>)}</tbody>
          </table></div>
        : <p className="muted small">No matching ledger accounts.</p>}
    </MotionCard>
  )
}

export default function ReceivablesPayables() {
  const scope = useDashScope()
  const { tenant, company, year, ready, setError } = scope
  const [d, setD] = useState(null)

  useEffect(() => {
    if (!ready) return
    setD(null)
    api('ar-ap', { tenant, company, year }).then(setD).catch((e) => setError(e.message))
  }, [tenant, company, year]) // eslint-disable-line react-hooks/exhaustive-deps

  const last = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null }

  return (
    <DashFrame title="Receivables & Payables" subtitle="What customers owe us and what we owe vendors" scope={scope} loading={!d}>
      {d && <>
        <div className="tiles">
          <Tile label="Receivables (AR)" value={fmt(last(d.ar_balance))} sub={`end of ${year}`} />
          <Tile label="Days sales outstanding" value={last(d.dso) == null ? '–' : `${last(d.dso)} days`} sub="AR ÷ 12-month revenue × 365" />
          <Tile label="Payables (AP)" value={fmt(last(d.ap_balance))} sub={`end of ${year}`} />
          <Tile label="Days payables outstanding" value={last(d.dpo) == null ? '–' : `${last(d.dpo)} days`} sub="AP ÷ 12-month expenses × 365" />
        </div>
        <div className="grid-2">
          <MotionCard as="section" hover={false} className="card">
            <ChartBox title="Receivables vs payables at month end">
              {(c) => (
                <LineChart data={monthRows({ ar: d.ar_balance, ap: d.ap_balance })}>
                  {c.grid}{c.x()}{c.y}{c.tip}{c.legend}
                  <Line dataKey="ar" name="Receivables" stroke="var(--c1)" strokeWidth={2} dot={{ r: 3 }} />
                  <Line dataKey="ap" name="Payables" stroke="var(--c2)" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              )}
            </ChartBox>
          </MotionCard>
          <MotionCard as="section" hover={false} className="card">
            <ChartBox title="Days outstanding (DSO vs DPO)">
              {(c) => (
                <LineChart data={monthRows({ dso: d.dso, dpo: d.dpo })}>
                  {c.grid}{c.x()}{c.y}{c.tip}{c.legend}
                  <Line dataKey="dso" name="DSO (days)" stroke="var(--c1)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  <Line dataKey="dpo" name="DPO (days)" stroke="var(--c2)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                </LineChart>
              )}
            </ChartBox>
          </MotionCard>
        </div>
        <div className="grid-2">
          <AccountTable title="Receivable accounts" rows={d.ar_accounts} />
          <AccountTable title="Payable accounts" rows={d.ap_accounts} />
        </div>
        <p className="muted small">{d.rule}. Ageing by customer / vendor needs the D365 customer and vendor transaction tables.</p>
      </>}
    </DashFrame>
  )
}
