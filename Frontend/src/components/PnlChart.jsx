import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useState } from 'react'
import { fmt, fmtShort, MONTHS } from '../api'
import { Reveal } from './motion'
import { Chart3D } from './three'

export default function PnlChart({ rows }) {
  const data = rows.map((r) => ({ ...r, name: MONTHS[r.month - 1] }))
  const [mode, setMode] = useState('2d')
  const flat = (
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="name" tick={{ fill: 'var(--muted)', fontSize: 12 }} />
          <YAxis tickFormatter={fmtShort} tick={{ fill: 'var(--muted)', fontSize: 12 }} width={56} />
          <Tooltip formatter={(v) => fmt(v)} />
          <Legend />
          <Bar dataKey="revenue" name="Revenue" fill="var(--c1)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="expenses" name="Expenses" fill="var(--c2)" radius={[4, 4, 0, 0]} />
          <Line dataKey="net_profit" name="Net profit" stroke="var(--c3)" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
  )
  return (
    <>
      <div className="chart-head">
        <h2>Monthly revenue, expenses and net profit</h2>
        <div className="seg no-print" role="group" aria-label="Chart view">
          <button className={mode === '2d' ? 'on' : ''} onClick={() => setMode('2d')}>2D</button>
          <button className={mode === '3d' ? 'on' : ''} onClick={() => setMode('3d')}>3D</button>
        </div>
      </div>
      <Reveal y={16}>
        {mode === '3d'
          ? <Chart3D data={data} series={[{ key: 'revenue', name: 'Revenue' }, { key: 'expenses', name: 'Expenses' }]} height={320} fallback={flat} />
          : flat}
      </Reveal>
    </>
  )
}
