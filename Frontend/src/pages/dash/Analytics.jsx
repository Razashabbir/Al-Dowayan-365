import { useEffect, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, ComposedChart, Label, Line, LineChart, Pie, PieChart, Cell, Tooltip, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { MONTHS, api, fmt, fmtShort } from '../../api'
import { MotionCard } from '../../components/motion'
import { ChartBox, Change, DashFrame, Tile, monthRows, useDashScope } from './common'

const PIE = ['#0d9488', '#d97706', '#6366f1', '#db2777', '#0891b2', '#65a30d', '#9333ea', '#ea580c', '#64748b', '#14b8a6', '#f59e0b', '#8b5cf6']

function useAnalytics(kind) {
  const scope = useDashScope()
  const { tenant, company, year, ready, setError } = scope
  const [d, setD] = useState(null)
  useEffect(() => {
    if (!ready) return
    setD(null)
    api(`analytics/${kind}`, { tenant, company, year }).then(setD).catch((e) => setError(e.message))
  }, [tenant, company, year]) // eslint-disable-line react-hooks/exhaustive-deps
  return [scope, d]
}

function Rank({ title, rows, valueKey = 'amount', label, empty }) {
  const data = rows.map((r) => ({ ...r, label: label(r) }))
  return (
    <MotionCard as="section" hover={false} className="card">
      <ChartBox title={title} height={Math.max(200, data.length * 27 + 40)} legend={false}>
        {(c) => (
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
            <XAxis type="number" tickFormatter={fmtShort} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
            <YAxis type="category" dataKey="label" width={180} tick={{ fill: 'var(--muted)', fontSize: 11.5 }} />
            {c.tip}
            <Bar dataKey={valueKey} name="Amount" fill="var(--c1)" radius={[0, 4, 4, 0]} />
          </BarChart>
        )}
      </ChartBox>
      {!data.length && <p className="muted small">{empty}</p>}
    </MotionCard>
  )
}

/** Total in the hole of a donut: amounts short (386M), counts in full (1,524) with what they count. */
function DonutTotal({ viewBox, value, label }) {
  const { cx, cy } = viewBox || {}
  if (cx == null) return null
  return (
    <g>
      <text x={cx} y={cy - 4} textAnchor="middle" dominantBaseline="central" className="donut-total">{value}</text>
      <text x={cx} y={cy + 16} textAnchor="middle" dominantBaseline="central" className="donut-total-label">{label}</text>
    </g>
  )
}

function Donut({ title, rows, note, unit }) {
  const data = (rows || []).map((r) => ({ name: r.name, value: Math.abs(r.amount ?? r.n) }))
  const counts = (rows || []).some((r) => r.amount == null && r.n != null)
  const total = data.reduce((a, r) => a + r.value, 0)
  return (
    <MotionCard as="section" hover={false} className="card">
      <h2>{title}</h2>
      {data.length ? (
        <div className="donut-wrap">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2} isAnimationActive>
                {data.map((r, i) => <Cell key={r.name} fill={PIE[i % PIE.length]} />)}
                <Label position="center" content={<DonutTotal value={counts ? fmt(total) : fmtShort(total)} label={counts ? unit || 'Total' : 'Total'} />} />
              </Pie>
              <Tooltip formatter={(v) => fmt(v)} contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }} />
            </PieChart>
          </ResponsiveContainer>
          <ul className="donut-legend">{data.slice(0, 8).map((r, i) => <li key={r.name}><span style={{ background: PIE[i % PIE.length] }} /><span data-no-tr>{r.name}</span><b>{fmt(r.value)}</b></li>)}</ul>
        </div>
      ) : <p className="muted small">{note}</p>}
    </MotionCard>
  )
}

const lastIdx = (arr) => arr.reduce((m, x, j) => (Math.abs(x) > 0.5 ? j : m), -1)

export function Sales() {
  const [scope, d] = useAnalytics('sales')
  const { year } = scope
  const dims = d && (d.by_dim2.some((r) => r.name !== '(none)') || d.by_dim3.some((r) => r.name !== '(none)'))
  const li = d ? lastIdx(d.months) : -1
  return (
    <DashFrame title="Sales Analytics" subtitle="Revenue by month, account, financial dimension and project, with customers" scope={scope} loading={!d}>
      {d && <>
        <div className="tiles">
          <Tile label={`Revenue ${year}`} value={fmt(d.total)} sub={<Change cur={d.total} prev={d.last_month < 12 ? d.prev_ytd : d.prev_total} />} />
          <Tile label="Average per month" value={fmt(d.total / Math.max(1, d.last_month))} sub={d.last_month ? `Jan–${MONTHS[d.last_month - 1]}` : ''} />
          <Tile label="Customers" value={d.customers ? String(d.customers.total) : '–'} sub={d.customers ? `${d.customers.groups.length} customer groups` : 'customer master not loaded'} />
          <Tile label="Receivables" value={d.receivables ? fmt(d.receivables.balance) : '–'} sub={d.receivables?.dso != null ? `DSO ${d.receivables.dso.toFixed(0)} days` : ''} />
        </div>
        <MotionCard as="section" hover={false} className="card">
          <ChartBox title={`Revenue by month - ${year} vs ${year - 1}`} three={{ data: monthRows({ cur: d.months, prev: d.prev_months }), series: [{ key: 'cur', name: String(year), color: '#0d9488' }, { key: 'prev', name: String(year - 1), color: '#6366f1' }] }}>
            {(c) => (
              <AreaChart data={monthRows({ cur: d.months.map((v, i) => (i <= li ? v : null)), prev: d.prev_months })}>
                <defs><linearGradient id="salesG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--c1)" stopOpacity={0.4} /><stop offset="1" stopColor="var(--c1)" stopOpacity={0} /></linearGradient></defs>
                {c.grid}{c.x()}{c.y}{c.tip}{c.legend}
                <Area dataKey="cur" name={String(year)} stroke="var(--c1)" strokeWidth={2} fill="url(#salesG)" />
                <Line dataKey="prev" name={String(year - 1)} stroke="var(--c3)" strokeDasharray="5 4" dot={false} />
              </AreaChart>
            )}
          </ChartBox>
        </MotionCard>
        <div className="grid-2">
          <Rank title="Top revenue accounts" rows={d.accounts} label={(r) => `${r.main_account} ${r.account_name || ''}`.slice(0, 30)} empty="No revenue this year." />
          <Donut title="Revenue by project" rows={d.by_project} note="No revenue lines carry a project id." />
        </div>
        <div className="grid-2">
          {dims ? <Donut title="Revenue by dimension 2" rows={d.by_dim2} /> : <MotionCard as="section" hover={false} className="card"><h2>By financial dimension</h2><p className="muted">Revenue lines carry no dimension segments.</p></MotionCard>}
          <Donut title="Customers by group" unit="customers" rows={d.customers?.groups} note="Load CustomersV3 (ETL) to see customer groups." />
        </div>
        <p className="muted small">{d.note} Ledger lines have no customer number, so revenue per customer needs the sales invoice tables (ETL › Jobs › Choose D365 tables).</p>
      </>}
    </DashFrame>
  )
}

export function Purchasing() {
  const [scope, d] = useAnalytics('purchasing')
  const { year } = scope
  const li = d ? lastIdx(d.months) : -1
  return (
    <DashFrame title="Purchasing Analytics" subtitle="Costs and direct purchases by month and account, payables and vendors" scope={scope} loading={!d}>
      {d && <>
        <div className="tiles">
          <Tile label={`Costs ${year}`} value={fmt(d.total)} sub={<Change cur={d.total} prev={d.last_month < 12 ? d.prev_ytd : d.prev_total} invert />} />
          <Tile label="Direct costs / purchases" value={fmt(d.direct_total)} sub={d.total ? `${((d.direct_total / d.total) * 100).toFixed(1)}% of costs` : ''} />
          <Tile label="Vendors" value={d.vendors ? String(d.vendors.total) : '–'} sub={d.vendors ? `${d.vendors.groups.length} vendor groups` : 'vendor master not loaded'} />
          <Tile label="Payables" value={d.payables ? fmt(d.payables.balance) : '–'} sub={d.payables?.dpo != null ? `DPO ${d.payables.dpo.toFixed(0)} days` : ''} />
        </div>
        <MotionCard as="section" hover={false} className="card">
          <ChartBox title={`Costs by month - ${year} vs ${year - 1}`}>
            {(c) => (
              <ComposedChart data={monthRows({ cur: d.months.map((v, i) => (i <= li ? v : null)), direct: d.direct.map((v, i) => (i <= li ? v : null)), prev: d.prev_months })}>
                {c.grid}{c.x()}{c.y}{c.tip}{c.legend}
                <Bar dataKey="cur" name={`All costs ${year}`} fill="var(--c2)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="direct" name="Direct / purchases" fill="var(--c1)" radius={[4, 4, 0, 0]} />
                <Line dataKey="prev" name={String(year - 1)} stroke="var(--c3)" strokeDasharray="5 4" dot={false} />
              </ComposedChart>
            )}
          </ChartBox>
        </MotionCard>
        <div className="grid-2">
          <Rank title="Top cost accounts" rows={d.accounts} label={(r) => `${r.direct ? '● ' : ''}${r.main_account} ${r.account_name || ''}`.slice(0, 32)} empty="No costs this year." />
          <div>
            {d.payables?.trend && (
              <MotionCard as="section" hover={false} className="card">
                <ChartBox title="Payables at month end" legend={false} height={200}>
                  {(c) => (
                    <LineChart data={monthRows({ ap: d.payables.trend })}>{c.grid}{c.x()}{c.y}{c.tip}
                      <Line dataKey="ap" name="Payables" stroke="var(--c3)" strokeWidth={2} dot={{ r: 2 }} /></LineChart>
                  )}
                </ChartBox>
              </MotionCard>
            )}
            <Donut title="Vendors by group" unit="vendors" rows={d.vendors?.groups} note="Load VendorsV2 (ETL) to see vendor groups." />
          </div>
        </div>
        <p className="muted small">{d.note} ● = direct cost account.</p>
      </>}
    </DashFrame>
  )
}

export function FixedAssets() {
  const [scope, d] = useAnalytics('fixed-assets')
  const { year } = scope
  return (
    <DashFrame title="Fixed Assets Analytics" subtitle="Cost, accumulated depreciation, net book value, additions, disposals and depreciation" scope={scope} loading={!d}>
      {d && <>
        <div className="tiles">
          <Tile label="Gross cost" value={fmt(d.gross)} sub={`${d.cost.length} asset accounts`} />
          <Tile label="Accumulated depreciation" value={fmt(d.accumulated_total)} sub={d.gross ? `${((d.accumulated_total / d.gross) * 100).toFixed(1)}% of cost` : ''} />
          <Tile label={`Net book value 31 Dec ${year}`} value={fmt(d.nbv)} sub={<Change cur={d.nbv} prev={d.opening_nbv} />} />
          <Tile label={`Depreciation ${year}`} value={fmt(d.depreciation_total)} sub={`additions ${fmt(d.additions_total)} · disposals ${fmt(d.disposals_total)}`} />
        </div>
        <MotionCard as="section" hover={false} className="card">
          <ChartBox title={`Additions, disposals and depreciation by month - ${year}`}>
            {(c) => (
              <ComposedChart data={monthRows({ add: d.additions, disp: d.disposals.map((v) => -v), dep: d.depreciation })}>
                {c.grid}{c.x()}{c.y}{c.tip}{c.legend}
                <Bar dataKey="add" name="Additions" fill="var(--c1)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="disp" name="Disposals" fill="var(--down)" radius={[0, 0, 4, 4]} />
                <Line dataKey="dep" name="Depreciation expense" stroke="var(--c2)" strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            )}
          </ChartBox>
        </MotionCard>
        <MotionCard as="section" hover={false} className="card">
          <h2>Asset register by ledger account</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Account</th><th className="num">Opening</th><th className="num">Additions (Dr)</th><th className="num">Disposals (Cr)</th><th className="num">Closing</th></tr></thead>
              <tbody>
                {[['Cost', d.cost], ['Accumulated depreciation / amortisation', d.accumulated]].map(([g, list]) => list.length > 0 && [
                  <tr key={g} className="fs-h"><td colSpan={5}>{g}</td></tr>,
                  ...list.map((a) => (
                    <tr key={a.main_account}><td><span data-no-tr>{a.main_account}</span> {a.account_name}</td><td className="num">{fmt(a.opening)}</td>
                      <td className="num">{fmt(a.debit)}</td><td className="num">{fmt(a.credit)}</td><td className="num strong">{fmt(a.closing)}</td></tr>)),
                ])}
                <tr className="fs-t fs-grand"><td>Net book value</td><td className="num">{fmt(d.opening_nbv)}</td><td /><td /><td className="num">{fmt(d.nbv)}</td></tr>
              </tbody>
            </table>
          </div>
          {!d.cost.length && <div className="alert">No fixed-asset accounts found by name for this company.</div>}
          <p className="muted small">{d.note}</p>
        </MotionCard>
      </>}
    </DashFrame>
  )
}
