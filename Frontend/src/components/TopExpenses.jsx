import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmt, fmtShort } from '../api'

export default function TopExpenses({ rows }) {
  const data = rows.map((r) => ({ ...r, label: r.account_name || r.main_account }))
  return (
    <>
      <h2>Top 10 expense accounts</h2>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
          <XAxis type="number" tickFormatter={fmtShort} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
          <YAxis type="category" dataKey="label" width={130} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
          <Tooltip formatter={(v) => fmt(v)} />
          <Bar dataKey="amount" name="Amount" fill="var(--c2)" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </>
  )
}
