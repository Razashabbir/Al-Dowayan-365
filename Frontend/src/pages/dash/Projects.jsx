import { useEffect, useMemo, useState } from 'react'
import { MotionCard } from '../../components/motion'
import { Bar, BarChart, XAxis, YAxis } from 'recharts'
import { api, fmtShort } from '../../api'
import Pager, { paginate } from '../../components/Pager'
import { ChartBox, DashFrame, downloadCsv, fmt, pct, Tile, useDashScope } from './common'

export default function Projects() {
  const scope = useDashScope()
  const { tenant, company, year, ready, setError } = scope
  const [d, setD] = useState(null)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)

  useEffect(() => {
    if (!ready) return
    setD(null)
    api('projects', { tenant, company, year }).then(setD).catch((e) => setError(e.message))
  }, [tenant, company, year]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => (d?.projects || []).filter((p) => p.project.toLowerCase().includes(q.toLowerCase())), [d, q])
  const { pageRows, page: cur, pages } = paginate(shown, page, size)
  const t = d?.totals
  const top = (d?.projects || []).slice(0, 10)

  return (
    <DashFrame title="Projects" subtitle="Revenue, cost and margin per project (from ledger lines with a project id)" scope={scope} loading={!d}>
      {d && (!d.projects.length
        ? <div className="alert">No ledger lines with a project id in {year}.</div>
        : <>
          <div className="tiles">
            <Tile label="Projects with postings" value={fmt(d.projects.length)} />
            <Tile label="Project revenue" value={fmt(t.revenue)} />
            <Tile label="Project cost" value={fmt(t.cost)} />
            <Tile label="Project margin" value={fmt(t.revenue - t.cost)} tone={t.revenue - t.cost < 0 ? 'down' : 'up'}
                  sub={t.revenue ? pct((t.revenue - t.cost) / t.revenue * 100) : ''} />
          </div>
          <MotionCard as="section" hover={false} className="card">
            <ChartBox title="Top 10 projects - revenue vs cost" height={Math.max(260, top.length * 34 + 60)} three={{ data: top.map((p) => ({ ...p, name: p.project })), series: [{ key: 'revenue', name: 'Revenue' }, { key: 'cost', name: 'Cost' }] }}>
              {(c) => (
                <BarChart data={top} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <XAxis type="number" tickFormatter={fmtShort} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                  <YAxis type="category" dataKey="project" width={130} tick={{ fill: 'var(--muted)', fontSize: 11.5 }} />
                  {c.tip}{c.legend}
                  <Bar dataKey="revenue" name="Revenue" fill="var(--c1)" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="cost" name="Cost" fill="var(--c2)" radius={[0, 4, 4, 0]} />
                </BarChart>
              )}
            </ChartBox>
          </MotionCard>
          <MotionCard as="section" hover={false} className="card stack">
            <div className="row">
              <input className="grow" placeholder="Search project…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
              <button className="export-only" onClick={() => downloadCsv(`projects_${company}_${year}.csv`, ['Project', 'Revenue', 'Cost', 'Margin', 'Margin %'],
                shown.map((p) => [p.project, p.revenue, p.cost, p.margin, p.margin_pct]))}>Export CSV</button>
            </div>
            <div className="table-wrap paged">
              <table>
                <thead><tr><th>Project</th><th className="num">Revenue</th><th className="num">Cost</th>
                  <th className="num">Margin</th><th className="num">Margin %</th><th className="num">Lines</th></tr></thead>
                <tbody>{pageRows.map((p) => (
                  <tr key={p.project}><td><strong>{p.project}</strong></td><td className="num">{fmt(p.revenue)}</td>
                    <td className="num">{fmt(p.cost)}</td><td className={`num ${p.margin < 0 ? 'down' : ''}`}>{fmt(p.margin)}</td>
                    <td className={`num ${p.margin_pct < 0 ? 'down' : ''}`}>{pct(p.margin_pct)}</td><td className="num muted">{fmt(p.lines)}</td></tr>))}
                </tbody>
              </table>
            </div>
            <Pager total={shown.length} page={cur} pages={pages} size={size} label="projects"
                   onPage={setPage} onSize={(n) => { setSize(n); setPage(1) }} />
          </MotionCard>
        </>)}
    </DashFrame>
  )
}
