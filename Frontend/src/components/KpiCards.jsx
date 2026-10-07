import { fmt } from '../api'
import { Tile } from '../pages/dash/common'

/* Overview KPI row - uses the same Tile as every other dashboard, so size, font and animation match. */
function Delta({ cur, prev }) {
  if (!prev) return <span className="muted">no prior year</span>
  const pct = ((cur - prev) / Math.abs(prev)) * 100
  return <span className={pct >= 0 ? 'up' : 'down'}>{pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}% vs last year</span>
}

export default function KpiCards({ k, year }) {
  return (
    <div className="tiles">
      <Tile label={`Revenue ${year}`} value={fmt(k.revenue)} sub={<Delta cur={k.revenue} prev={k.revenue_prev} />} />
      <Tile label={`Expenses ${year}`} value={fmt(k.expenses)} />
      <Tile label={`Net profit ${year}`} value={fmt(k.net_profit)} tone={k.net_profit < 0 ? 'down' : ''}
            sub={<Delta cur={k.net_profit} prev={k.net_profit_prev} />} />
      <Tile label="Net margin" value={k.margin_pct == null ? '–' : `${k.margin_pct}%`} />
    </div>
  )
}
